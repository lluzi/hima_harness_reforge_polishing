import {test} from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {dbosHome,cleanDbosHome} from './support/dbos-process.ts';
test('ordinary Host HTTP reads PG Campaign facts while history is delayed',{timeout:90000},async()=>{
 const home=await dbosHome();
 const child=spawn(process.execPath,[fileURLToPath(new URL('./support/durable-views-worker.ts',import.meta.url)),home],{env:process.env,stdio:['ignore','pipe','pipe','ipc']});
 let output='';child.stdout!.on('data',value=>output+=String(value));child.stderr!.on('data',value=>output+=String(value));
 const result=new Promise<any>((resolve,reject)=>{child.once('message',resolve);child.once('error',reject);child.once('exit',code=>{if(code)reject(new Error(output));});});
 try {const observed=await result;assert.equal(observed.ok,true,JSON.stringify(observed)+'\n'+output);}finally {if(child.exitCode===null){child.kill('SIGTERM');const timer=setTimeout(()=>child.kill('SIGKILL'),5000);try{await new Promise(resolve=>child.once('exit',resolve));}finally{clearTimeout(timer);}}await cleanDbosHome(home);}
});
