import assert from 'node:assert/strict';
import { test } from 'node:test';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dbosHome,cleanDbosHome } from './support/dbos-process.ts';
function worker(home:string,mode:string) {
 const child=spawn(process.execPath,[fileURLToPath(new URL('./support/task-effects-worker.ts',import.meta.url)),home,mode],{env:process.env,stdio:['ignore','pipe','pipe','ipc']});
 let stderr='';child.stderr!.on('data',data=>stderr+=data);const messages:any[]=[];const waiters:any[]=[];
 const ended=new Promise<void>(resolve=>child.once('close',()=>{for(const pending of waiters.splice(0))pending.reject(new Error(stderr));resolve();}));
 child.on('message',message=>{const pending=waiters.shift();if(pending)pending.resolve(message);else messages.push(message);});
 return {control(action:string){child.send({action});},async next(){if(messages.length)return messages.shift();if(child.exitCode!==null||child.signalCode!==null)throw new Error(stderr);return new Promise<any>((resolve,reject)=>{const pending={resolve,reject};waiters.push(pending);const timer=setTimeout(()=>reject(new Error(`Task effects worker timeout: ${stderr}`)),60000);pending.resolve=value=>{clearTimeout(timer);resolve(value);};pending.reject=error=>{clearTimeout(timer);reject(error);};});},async kill(){child.kill('SIGKILL');await ended;},async close(){if(child.exitCode===null&&child.signalCode===null){child.send({action:'close'});const timer=setTimeout(()=>child.kill('SIGKILL'),5000);await ended;clearTimeout(timer);}else await ended;}};
}
test('declared Pack command protocol: lost ACK, unknown release/licence, Reader repair and current callback admission',{timeout:90000},async()=>{
 const home=await dbosHome(),host=worker(home,'matrix');try{assert.equal((await host.next()).ok,true);}finally{await host.close();await cleanDbosHome(home);}
});
test('real resident wrapper/ACP Job auto-hands-off Reader result without owner complete and preserves native repair session',{timeout:90000},async()=>{
 const home=await dbosHome(),host=worker(home,'resident');try{const result=await host.next();assert.equal(result.ok,true);assert.equal(result.ownerCompleteCalls,0);assert.equal(result.repairRounds,5);}finally{await host.close();await cleanDbosHome(home);}
});
for(const phase of ['prepared','submitted'])test(`DBOS SIGKILL after ${phase} fact resumes stable operation order and one original Job`,{timeout:90000},async()=>{
 const home=await dbosHome();let host=worker(home,`crash-${phase}`);try{assert.equal((await host.next()).stage,phase);await host.kill();host=worker(home,'recover');assert.equal((await host.next()).ok,true);}finally{await host.close();await cleanDbosHome(home);}
});
test('prepared-intent crash preserves human pause; replay sends zero effects until current continue',{timeout:90000},async()=>{
 const home=await dbosHome();let host=worker(home,'crash-prepared');try{assert.equal((await host.next()).stage,'prepared');host.control('pause');assert.equal((await host.next()).stage,'paused');await host.kill();host=worker(home,'recover-held');assert.equal((await host.next()).ok,true);}finally{await host.close();await cleanDbosHome(home);}
});
test('undeclared inherited licence properties refuse; explicitly declared features count all held own properties',{timeout:90000},async()=>{
 const home=await dbosHome(),host=worker(home,'resource-prototypes');try{assert.equal((await host.next()).ok,true);}finally{await host.close();await cleanDbosHome(home);}
});
for(const boundary of ['live','gone'])test(`known resident failure closes original ${boundary} wrapper resources without a success result`,{timeout:90000},async()=>{
 const home=await dbosHome(),host=worker(home,`resident-failure-${boundary}`);try{const result=await host.next();assert.equal(result.ok,true);assert.equal(result.terminal,'failed');assert.equal(result.leaseReleased,true);}finally{await host.close();await cleanDbosHome(home);}
});

test('resident late business message completes after delivery while Reader is pending, then closes the same native resources',{timeout:90000},async()=>{
 const home=await dbosHome(),host=worker(home,'resident-late-message');try{const result=await host.next();assert.equal(result.ok,true);assert.equal(result.leaseReleased,true);}finally{await host.close();await cleanDbosHome(home);}
});

for(const boundary of ['retained','changed'])test(`resident ${boundary} result keeps exact validated bytes across late completed native message closure`,{timeout:90000},async()=>{
 const home=await dbosHome(),host=worker(home,`resident-${boundary}-message`);try{const result=await host.next();assert.equal(result.ok,true);assert.equal(result.leaseReleased,boundary==='retained');}finally{await host.close();await cleanDbosHome(home);}
});

test('resident running accepted message defers the original release receipt until native completion and quiescence',{timeout:90000},async()=>{
 const home=await dbosHome(),host=worker(home,'resident-inflight-message');try{const result=await host.next();assert.equal(result.ok,true);assert.equal(result.leaseReleased,true);assert.equal(result.originalReleaseCompleted,true);assert.equal(result.noReplacementRelease,true);}finally{await host.close();await cleanDbosHome(home);}
});
