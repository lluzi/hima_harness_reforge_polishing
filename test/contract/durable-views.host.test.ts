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

test('DBOS automatically delivers generic reports and binary archives across restart',{timeout:120000},async()=>{
 const home=await dbosHome();
 async function run(mode:string){const child=spawn(process.execPath,[fileURLToPath(new URL('./support/durable-views-worker.ts',import.meta.url)),home,mode],{env:process.env,stdio:['ignore','pipe','pipe','ipc']});
 let output='';child.stdout!.on('data',value=>output+=String(value));child.stderr!.on('data',value=>output+=String(value));
 const result=new Promise<any>((resolve,reject)=>{child.once('message',resolve);child.once('error',reject);child.once('exit',code=>{if(code)reject(new Error(output));});});
 try{const observed=await result;assert.equal(observed.ok,true,JSON.stringify(observed)+'\n'+output);}finally{if(child.exitCode===null){child.kill('SIGTERM');const timer=setTimeout(()=>child.kill('SIGKILL'),5000);try{await new Promise(resolve=>child.once('exit',resolve));}finally{clearTimeout(timer);}}}}
 try{await run('delivery');await run('delivery-restart');}finally{await cleanDbosHome(home);}
});

test('DBOS resumes actual interruption between archive publication and PG completion',{timeout:120000},async()=>{
 const home=await dbosHome();
 async function run(mode:string){const child=spawn(process.execPath,[fileURLToPath(new URL('./support/durable-views-worker.ts',import.meta.url)),home,mode],{env:process.env,stdio:['ignore','pipe','pipe','ipc']});let output='';child.stdout!.on('data',value=>output+=String(value));child.stderr!.on('data',value=>output+=String(value));
 const result=new Promise<any>((resolve,reject)=>{child.once('message',resolve);child.once('error',reject);child.once('exit',code=>{if(code)reject(new Error(output));});});
 try{const observed=await result;assert.equal(observed.ok,true,JSON.stringify(observed)+'\n'+output);}finally{if(child.exitCode===null){child.kill(mode==='delivery-interrupted'?'SIGKILL':'SIGTERM');await new Promise(resolve=>child.once('exit',resolve));}}}
 try{await run('delivery-interrupted');await run('delivery-restart');}finally{await cleanDbosHome(home);}
});

test('App drain waits for actual report and archive file publication',{timeout:90000},async()=>{
 const home=await dbosHome();const child=spawn(process.execPath,[fileURLToPath(new URL('./support/durable-views-worker.ts',import.meta.url)),home,'delivery-drain'],{env:process.env,stdio:['ignore','pipe','pipe','ipc']});let output='';child.stdout!.on('data',value=>output+=String(value));child.stderr!.on('data',value=>output+=String(value));
 const result=new Promise<any>((resolve,reject)=>{child.once('message',resolve);child.once('error',reject);child.once('exit',code=>{if(code)reject(new Error(output));});});
 try{const observed=await result;assert.equal(observed.ok,true,JSON.stringify(observed)+'\n'+output);}finally{if(child.exitCode===null){child.kill('SIGTERM');const timer=setTimeout(()=>child.kill('SIGKILL'),5000);try{await new Promise(resolve=>child.once('exit',resolve));}finally{clearTimeout(timer);}}await cleanDbosHome(home);}
});

for(const [label,mode,restart] of [
 ['DBOS resumes rename before IO receipt','delivery-rename-interrupted','delivery-restart'],
 ['DBOS resumes generated no-artifact archive rename with Site report refused','delivery-generated-rename','delivery-generated-restart'],
 ['DBOS rejects wrong missing and extra published source identities','delivery-rename-wrong','delivery-reject-restart'],
] as const)test(label,{timeout:120000},async()=>{
 const home=await dbosHome();
 async function run(mode:string){const child=spawn(process.execPath,[fileURLToPath(new URL('./support/durable-views-worker.ts',import.meta.url)),home,mode],{env:process.env,stdio:['ignore','pipe','pipe','ipc']});let output='';child.stdout!.on('data',value=>output+=String(value));child.stderr!.on('data',value=>output+=String(value));
 const result=new Promise<any>((resolve,reject)=>{child.once('message',resolve);child.once('error',reject);child.once('exit',code=>{if(code)reject(new Error(output));});});
 try{const observed=await result;assert.equal(observed.ok,true,JSON.stringify(observed)+'\n'+output);}finally{if(child.exitCode===null){child.kill(mode.startsWith('delivery-rename')||mode==='delivery-generated-rename'?'SIGKILL':'SIGTERM');const timer=setTimeout(()=>child.kill('SIGKILL'),5000);try{await new Promise(resolve=>child.once('exit',resolve));}finally{clearTimeout(timer);}}}}
 try{await run(mode);await run(restart);}finally{await cleanDbosHome(home);}
});

for(const mode of ['delivery-native-record','delivery-native-changed'])test(`PG native retained code archive ${mode}`,{timeout:90000},async()=>{
 const home=await dbosHome();const child=spawn(process.execPath,[fileURLToPath(new URL('./support/durable-views-worker.ts',import.meta.url)),home,mode],{env:process.env,stdio:['ignore','pipe','pipe','ipc']});let output='';child.stdout!.on('data',value=>output+=String(value));child.stderr!.on('data',value=>output+=String(value));
 const result=new Promise<any>((resolve,reject)=>{child.once('message',resolve);child.once('error',reject);child.once('exit',code=>{if(code)reject(new Error(output));});});
 try{const observed=await result;assert.equal(observed.ok,true,JSON.stringify(observed)+'\n'+output);}finally{if(child.exitCode===null){child.kill('SIGTERM');const timer=setTimeout(()=>child.kill('SIGKILL'),5000);try{await new Promise(resolve=>child.once('exit',resolve));}finally{clearTimeout(timer);}}await cleanDbosHome(home);}
});

test('completed DBOS revision serves its new report while preserving old hashes',{timeout:90000},async()=>{
 const home=await dbosHome();const child=spawn(process.execPath,[fileURLToPath(new URL('./support/durable-views-worker.ts',import.meta.url)),home,'delivery-revision'],{env:process.env,stdio:['ignore','pipe','pipe','ipc']});let output='';child.stdout!.on('data',value=>output+=String(value));child.stderr!.on('data',value=>output+=String(value));
 const result=new Promise<any>((resolve,reject)=>{child.once('message',resolve);child.once('error',reject);child.once('exit',code=>{if(code)reject(new Error(output));});});
 try{const observed=await result;assert.equal(observed.ok,true,JSON.stringify(observed)+'\n'+output);}finally{if(child.exitCode===null){child.kill('SIGTERM');const timer=setTimeout(()=>child.kill('SIGKILL'),5000);try{await new Promise(resolve=>child.once('exit',resolve));}finally{clearTimeout(timer);}}await cleanDbosHome(home);}
});


test('completed task archive stays readable when Site transport cannot answer existence probes',{timeout:90000},async()=>{
 const home=await dbosHome();const child=spawn(process.execPath,[fileURLToPath(new URL('./support/durable-views-worker.ts',import.meta.url)),home,'delivery-unavailable'],{env:process.env,stdio:['ignore','pipe','pipe','ipc']});let output='';child.stdout!.on('data',value=>output+=String(value));child.stderr!.on('data',value=>output+=String(value));
 const result=new Promise<any>((resolve,reject)=>{child.once('message',resolve);child.once('error',reject);child.once('exit',code=>{if(code)reject(new Error(output));});});
 try{const observed=await result;assert.equal(observed.ok,true,JSON.stringify(observed)+'\n'+output);}finally{if(child.exitCode===null){child.kill('SIGTERM');const timer=setTimeout(()=>child.kill('SIGKILL'),5000);try{await new Promise(resolve=>child.once('exit',resolve));}finally{clearTimeout(timer);}}await cleanDbosHome(home);}
});


test('known command exit survives durable Job projection while historical exit stays unknown',{timeout:90000},async()=>{
 const home=await dbosHome();
 const child=spawn(process.execPath,[fileURLToPath(new URL('./support/durable-views-worker.ts',import.meta.url)),home,'exit-projection'],{env:process.env,stdio:['ignore','pipe','pipe','ipc']});
 let output='';child.stdout!.on('data',value=>output+=String(value));child.stderr!.on('data',value=>output+=String(value));
 const result=new Promise<any>((resolve,reject)=>{child.once('message',resolve);child.once('error',reject);child.once('exit',code=>{if(code)reject(new Error(output));});});
 try{const observed=await result;assert.equal(observed.ok,true,JSON.stringify(observed)+'\n'+output);}finally{if(child.exitCode===null){child.kill('SIGTERM');const timer=setTimeout(()=>child.kill('SIGKILL'),5000);try{await new Promise(resolve=>child.once('exit',resolve));}finally{clearTimeout(timer);}}await cleanDbosHome(home);}
});
