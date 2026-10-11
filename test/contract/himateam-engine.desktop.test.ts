// Actual Electron operator controls; engine setup is distinct from member/installer qualification.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir,writeFile } from 'node:fs/promises';
import path from 'node:path';
import { createEmptyHome,repoRoot } from './support/dsh-home.ts';
import { bootTeamPlaywright } from './support/team-playwright-electron.ts';
import type { TeamServiceReceipt } from '../../packages/harness/lib/types/team-service-runtime.d.ts';

for(const native of [false,true])test(`actual engine Settings ${native?'starts and stops the owned native Mac environment':'retains missing-asset diagnostics without hiding Guide'}`,{timeout:420000},async t=>{
  const runtime=process.env.HIMA_TEST_ENGINE_NATIVE_RUNTIME;
  if(native&&!runtime){t.skip('Explicit qualified Mac internal engine closure is required; never downloaded/installed by the test.');return;}
  const home=await createEmptyHome();delete home.env.HIMA_TEAM_RUNTIME;
  if(native){home.env.HIMA_TEAM_RUNTIME=runtime;home.env.HIMA_POSTGRES_RUNTIME=path.join(runtime!,'postgres');}
  const evidence=path.join(repoRoot,'.scratch/engine-I/app',`${new Date().toISOString().replace(/[:.]/g,'-')}-${native?'native':'missing'}`);await mkdir(evidence,{recursive:true});
  const browser=await bootTeamPlaywright(home,evidence);const page=browser.page;
  const region='[data-hima-region="team-engine-settings"]';const control=(id:string)=>`[data-hima-control="team-engine-${id}"]`;
  try {
    await browser.wait(`document.body.innerText.includes('Internal Testing Notice')`);await page.getByRole('button',{name:'Continue',exact:true}).click();
    await browser.wait(`document.body.innerText.includes('Configure later')`);await page.getByRole('button',{name:'Configure later',exact:true}).click();
    await browser.wait(`!document.body.innerText.includes('Configure later')`);await page.getByRole('button',{name:'Settings',exact:true}).click();await page.getByRole('button',{name:'HimaHarness',exact:true}).click();
    await browser.wait(`!!document.querySelector(${JSON.stringify(region)}) && !document.querySelector(${JSON.stringify(control('start'))}).disabled`);
    await page.locator(control('start')).click();await browser.wait(`!document.querySelector(${JSON.stringify(control('refresh'))}).disabled`,300000);
    const receipt=async()=>page.evaluate<{receipt:TeamServiceReceipt}>(`fetch('/hima/api/team-runtime',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({action:'status',serviceId:'engineering-engine'})}).then(async response=>{if(!response.ok)throw Error('Engine HTTP '+response.status);return response.json();})`);
    const started=await receipt();assert.equal(started.receipt.state,native?'running':'unavailable',JSON.stringify(started));
    assert.match(await page.evaluate<string>(`document.querySelector(${JSON.stringify(region)}).innerText`),/trusted fixtures only/);
    if(native){assert.equal(started.receipt.owned.quiescent,false);assert.equal(started.receipt.owned.engine?.qualification,'trusted-fixture-only');await page.locator(control('stop')).click();await browser.wait(`!document.querySelector(${JSON.stringify(control('refresh'))}).disabled`,120000);const stopped=await receipt();assert.equal(stopped.receipt.owned.quiescent,true,JSON.stringify(stopped));await writeFile(path.join(evidence,'closed-receipt.json'),JSON.stringify(stopped,null,2));}
    await browser.screenshot({path:path.join(evidence,'settings.png'),fullPage:true,timeout:10000});
    await page.getByRole('button',{name:'Close',exact:true}).click();assert.ok(await page.evaluate<boolean>(`!!document.querySelector('[data-hima-control="open-workbench"]')`));
    await writeFile(path.join(evidence,'result.json'),JSON.stringify({result:'PASS',native,productModelCalls:0,memberActivation:false},null,2));
  } catch(error){await browser.screenshot({path:path.join(evidence,'failure.png'),fullPage:true,timeout:10000}).catch(()=>{});throw error;}
  finally {await browser.dispose();await home.dispose();}
});
