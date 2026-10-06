import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
export function facadeProcess(home:string,mode:string){
  const child=spawn(process.execPath,[fileURLToPath(new URL('./durable-fabric-worker.ts',import.meta.url)),home,mode],{env:process.env,stdio:['ignore','pipe','pipe','ipc']});
  let stderr='';child.stderr!.on('data',value=>{stderr+=String(value);});
  const queue:any[]=[],waiters:Array<{resolve:(v:any)=>void;reject:(e:Error)=>void}>=[];
  child.on('message',value=>{const waiter=waiters.shift();if(waiter)waiter.resolve(value);else queue.push(value);});
  const ended=new Promise<void>(resolve=>child.once('close',()=>{for(const waiter of waiters.splice(0))waiter.reject(new Error(stderr));resolve();}));
  return {async next(){if(queue.length)return queue.shift();if(child.exitCode!==null||child.signalCode!==null)throw new Error(stderr);return new Promise<any>((resolve,reject)=>{const timer=setTimeout(()=>reject(new Error('Facade Host timeout: '+stderr)),60000);waiters.push({resolve:value=>{clearTimeout(timer);resolve(value);},reject:error=>{clearTimeout(timer);reject(error);}});});},
    async kill(){child.kill('SIGKILL');await ended;},async close(){if(child.exitCode!==null||child.signalCode!==null){await ended;return;}child.send({action:'close'});const timer=setTimeout(()=>child.kill('SIGKILL'),5000);try{await ended;}finally{clearTimeout(timer);}}};
}
