import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createHash } from 'node:crypto';
import { get } from 'node:http';
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { createHimaHome } from './support/dsh-home.ts';
import { bootHimaHost } from './support/boot-host.ts';
import { api,openSession,createLiveSession } from './support/hima-api.ts';
import { teamFixture } from './support/himateam.ts';
import { waitUntil } from './support/fabric.ts';

test('disconnecting a slow original download closes its actual native file descriptor', {timeout:60000},async t=>{
  if(process.platform!=='darwin'||!existsSync('/usr/sbin/lsof')){t.skip('Native file-descriptor observation requires the qualified Mac lsof seam.');return;}
  const home=await createHimaHome();const host=await bootHimaHost(home);t.after(async()=>{await host.stop();await home.dispose();});
  const cookie=await openSession(host),sessionId=await createLiveSession(host,cookie,home.workspace);
  const op=async(request:unknown)=>{const response=await api(host,cookie,'/hima/api/teams',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({sessionId,request})});assert.equal(response.status,200);return response.json() as Promise<any>;};
  const team=await op({action:'save',definition:teamFixture,expectedVersion:null});
  const task=await op({action:'startTask',teamId:team.teamId,request:{requestId:'download-task',teamId:team.teamId,expectedVersion:1,goal:'Retain a binary original',input:{},deadlineAt:new Date(Date.now()+120000).toISOString(),closure:'Close the owned download'}});
  const ref={teamId:team.teamId,taskId:task.taskId};
  const bytes=Buffer.alloc(8*1024*1024,0x6d),sha256=createHash('sha256').update(bytes).digest('hex');
  const upload=await api(host,cookie,`/api/session/uploadFileBinary?${new URLSearchParams({sessionId,name:'slow-original.bin'})}`,{method:'POST',headers:{'content-type':'application/octet-stream'},body:bytes});assert.equal(upload.status,200);
  const receipt=await upload.json() as any;assert.equal(receipt.ok,true);
  const staged=await op({action:'stage-attachment',...ref,request:{requestId:'download-stage',receiptId:receipt.value.receiptId}});
  await op({action:'send-message',...ref,request:{requestId:'download-send',recipientMemberIds:['lead'],text:'Use the retained original.',stagedAttachmentIds:[staged.stageId]}});
  const url=new URL(`/hima/api/team-material?${new URLSearchParams({sessionId,...ref,stageId:staged.stageId})}`,host.url);
  const request=get(url,{headers:{cookie}});t.after(()=>request.destroy());
  const response=await new Promise<import('node:http').IncomingMessage>((resolve,reject)=>{request.once('response',resolve);request.once('error',reject);});response.pause();assert.equal(response.statusCode,200);
  const fileOpen=()=>{try{return execFileSync('/usr/sbin/lsof',['-p',String(host.child.pid),'-Fn'],{encoding:'utf8',stdio:['ignore','pipe','ignore']}).includes(sha256);}catch{return false;}};
  await waitUntil('actual original descriptor opened during backpressure',async()=>fileOpen(),5000,50);
  request.destroy();response.destroy();
  await waitUntil('original descriptor closed after browser disconnect',async()=>!fileOpen(),2000,50);
});
