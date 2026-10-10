import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { createHimaHome } from './support/dsh-home.ts';
import { bootHimaHost } from './support/boot-host.ts';
import { api, openSession, createLiveSession } from './support/hima-api.ts';
import { teamFixture } from './support/himateam.ts';

test('authenticated project entry saves immutable Team versions and exports only definitions',async t=>{
  const home=await createHimaHome();
  const host=await bootHimaHost(home);t.after(async()=>{await host.stop();await home.dispose();});
  const cookie=await openSession(host),sessionId=await createLiveSession(host,cookie,home.workspace);
  const call=async(request:unknown,session=sessionId)=>{
    const response=await api(host,cookie,'/hima/api/teams',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({sessionId:session,request})});
    return {status:response.status,body:await response.json() as any};
  };
  const context=await call({action:'context'});assert.equal(context.status,200);assert.equal(context.body.actor.kind,'human');
  const samePerson=await createLiveSession(host,cookie,home.workspace);
  assert.equal((await call({action:'context'},samePerson)).body.actor.actorId,context.body.actor.actorId,'tabs/sessions share the persisted operator identity');
  const created=await call({action:'save',definition:teamFixture,expectedVersion:null});assert.equal(created.status,200,JSON.stringify(created.body));
  const first=created.body;assert.equal(first.version,1);
  const changed=await call({action:'save',teamId:first.teamId,expectedVersion:1,definition:{...teamFixture,title:'Revised team'}});
  assert.equal(changed.status,200);assert.equal(changed.body.version,2);
  assert.equal((await call({action:'save',teamId:first.teamId,expectedVersion:1,definition:teamFixture})).status,409);
  assert.equal((await call({action:'read',teamId:first.teamId,version:1})).body.definition.title,'Research team');
  assert.equal((await call({action:'save',definition:{...teamFixture,credential:'secret'},expectedVersion:null})).status,409);
  assert.equal((await call({action:'context',actor:{kind:'human',actorId:'forged'}})).status,400);
  const clone=(await call({action:'clone',teamId:first.teamId,version:1})).body;
  assert.notEqual(clone.teamId,first.teamId);assert.notEqual(clone.definition.members[0].id,first.definition.members[0].id);
  assert.equal(clone.definition.leaderMemberId,clone.definition.members[0].id);
  assert.deepEqual((await call({action:'export',teamId:first.teamId,version:1})).body,teamFixture);
  const elsewhere=path.join(home.workspace,'other');await mkdir(elsewhere);
  const unrelated=await createLiveSession(host,cookie,elsewhere);
  assert.equal((await call({action:'read',teamId:first.teamId},unrelated)).status,404);
  assert.equal((await call({action:'save',teamId:first.teamId,definition:teamFixture,expectedVersion:2,applyToRunning:true})).status,409);
  const anonymous=await fetch(new URL('/hima/api/teams',host.url),{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({sessionId,request:{action:'list'}})});
  assert.equal(anonymous.status,401);
});
