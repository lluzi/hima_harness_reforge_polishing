// Normal product grow, duplicate intent, and optional-return boundaries use actual Host/PG.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dbosHome, cleanDbosHome } from './support/dbos-process.ts';
import { facadeProcess } from './support/facade-process.ts';
test('normal actual Host Pack start prepares once, preserves strict false/Goal false, and reads PG control under delayed history',{timeout:90000},async()=>{
  const home=await dbosHome(),host=facadeProcess(home,'normal');try{const result=await host.next();assert.equal(result.ok,true,JSON.stringify(result));}finally{await host.close();await cleanDbosHome(home);}
});
