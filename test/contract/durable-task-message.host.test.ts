import assert from 'node:assert/strict';
import {test} from 'node:test';
import {flowProcess} from './support/flow-workflow-worker.ts';
import {dbosHome,cleanDbosHome} from './support/dbos-process.ts';
test('durable native business message reconciles a lost ACK and rejects changed or stale requests',{timeout:60000},async()=>{
  const home=await dbosHome(),host=flowProcess(home,'message');
  try{const result=await host.next();assert.equal(result.ok,true);assert.equal(result.externalMessages,1);}
  finally{await host.close();await cleanDbosHome(home);}
});
for(const mode of ['message-pending','message-unavailable','message-pending-cancel'])test(`durable message preserves original identity through ${mode}`,{timeout:60000},async()=>{
  const home=await dbosHome(),host=flowProcess(home,mode);
  try{const result=await host.next();assert.equal(result.ok,true);assert.equal(result.externalMessages,mode==='message-pending-cancel'?0:1);}
  finally{await host.close();await cleanDbosHome(home);}
});
