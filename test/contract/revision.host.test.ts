// Normal shared Strategy/input revision; code-byte regression also shares growth's normal Host fixture.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dbosHome, cleanDbosHome } from './support/dbos-process.ts';
import { facadeProcess } from './support/facade-process.ts';
test('shared Strategy/input revision reaches exact consumers and future chooser carry while unrelated sibling stays original',{timeout:90000},async()=>{
 const home=await dbosHome(),host=facadeProcess(home,'shared');try{const result=await host.next();assert.equal(result.ok,true,JSON.stringify(result));}finally{await host.close();await cleanDbosHome(home);}
});
