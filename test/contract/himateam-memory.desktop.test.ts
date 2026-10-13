// L3 only: real painted Electron/Host/PG, zero product models or Hindsight.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { MemoryPage } from '@hima/harness';
import { createEmptyHome, repoRoot } from './support/dsh-home.ts';
import { bootTeamPlaywright, finishTeamOnboarding } from './support/team-playwright-electron.ts';

test('Electron Team memory controls remain visible and usable with long retained provenance in a narrow panel', {timeout:150000}, async()=>{
  const home=await createEmptyHome();delete home.env.HIMA_TEAM_RUNTIME;
  const evidence=path.join(process.env.HIMA_TEAM_EVIDENCE??path.join(repoRoot,'.scratch/issue104-memory-desktop'),new Date().toISOString().replace(/[:.]/g,'-'));await mkdir(evidence,{recursive:true});
  await writeFile(path.join(evidence,'home.json'),JSON.stringify({home:home.home}));
  const browser=await bootTeamPlaywright(home,evidence),page=browser.page;let sessionId='';
  page.on('request',request=>{if(request.url().endsWith('/hima/api/teams')&&request.postData())sessionId=JSON.parse(request.postData()!).sessionId;});
  const click=async(control:string)=>page.locator(`[data-hima-control="${control}"]`).click();
  const fill=async(selector:string,value:string)=>{const field=page.locator(selector);await field.click();await field.press('ControlOrMeta+A');await field.press('Backspace');await field.pressSequentially(value);};
  try {
    await finishTeamOnboarding(browser);
    const registered=await page.evaluate<{result:{ok:boolean}}>(`fetch('/api/workspace/create',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({type:'client-request',rpcId:'memory-ui-workspace',method:'workspace/create',payload:{args:{request:{path:${JSON.stringify(home.workspace)}}}}})}).then(r=>r.json())`);assert.equal(registered.result.ok,true);
    await browser.wait(`!!document.querySelector('[role="treegrid"], [role="tree"]')`);await page.locator('[data-row-key^="workspace:"]:has(span:text-is("workspace"))').hover();await page.getByRole('button',{name:'New session in workspace',exact:true}).click();
    await browser.wait(`document.querySelector('[data-hima-control="open-workbench"]')?.disabled === false`);await click('open-workbench');await click('studio-mode-team');await browser.wait(`document.querySelector('[data-hima-control="team-title"]')?.disabled === false`);
    await fill('[data-hima-control="team-title"]','Memory visual regression');await fill('[data-hima-region="himateam"] label:has-text("Model reference") input:visible','fixture-model');await click('team-save');
    await browser.wait(`document.querySelector('[data-hima-region="himateam"]').dataset.himaStateTeam !== '' && !document.querySelector('[data-hima-control="team-save"]').disabled`);assert.ok(sessionId);
    const teamId=await page.evaluate<string>(`document.querySelector('[data-hima-region="himateam"]').dataset.himaStateTeam`);
    const post=async<T,>(url:string,body:unknown)=>page.evaluate<T>(`fetch(${JSON.stringify(url)},{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(${JSON.stringify(body)})}).then(async r=>{const value=await r.json();if(!r.ok)throw Error(JSON.stringify(value));return value})`);
    const task=await post<{taskId:string;readiness:{ready:boolean}}>('/hima/api/teams',{sessionId,request:{action:'startTask',teamId,request:{requestId:'memory-ui-opening',teamId,expectedVersion:1,goal:'Check only offline memory UI',input:{},deadlineAt:new Date(Date.now()+120000).toISOString(),closure:'No member runtime or model.'}}});
    assert.equal(task.readiness.ready,false,'Unavailable member model keeps this UI test from starting native/model work.');
    await page.getByRole('button',{name:'Refresh teams',exact:true}).click();await browser.wait(`!!document.querySelector('[data-hima-control="team-task-${task.taskId}"]')`);await click(`team-task-${task.taskId}`);
    const panel='[data-hima-region="work-memory"][data-hima-state-memory="team"]';await browser.wait(`!!document.querySelector(${JSON.stringify(panel)}) && !document.querySelector(${JSON.stringify(panel+' button')}).disabled`);
    const text='该项目的 SRAM 访问上限为 37 ns。';await fill(`${panel} label:text-is("Feedback") textarea`,text);await fill(`${panel} label:text-is("Reason") textarea`,'工程师确认');await page.getByRole('button',{name:'Save feedback candidate',exact:true}).click();
    await browser.wait(`document.querySelector(${JSON.stringify(panel)}).innerText.includes('Feedback saved as a candidate.')`);
    const ref={sessionId,teamId,taskId:task.taskId};const status=()=>post<MemoryPage>('/hima/api/memory',{...ref,action:'status',request:{page:{limit:30}}});let item=(await status()).records[0]!;assert.equal(item.record.text,text);assert.equal(item.index.state,'pending');
    const article=`${panel} article:has(textarea):has-text(${JSON.stringify('Memory '+item.record.memoryId)})`;
    // Initial adoption relies on checked original sources, not unrelated extra feedback.
    await fill(`${article} label:text-is("Change reason") textarea`,'采用当前项目事实');await page.getByRole('button',{name:'Adopt',exact:true}).click();await browser.wait(`document.querySelector(${JSON.stringify(panel)}).innerText.includes('adopted recorded.')`);
    item=(await status()).records[0]!;assert.equal(item.tip.state,'adopted');
    await fill(`${article} label:text-is("Change reason") textarea`,'更新事实');await fill(`${article} label:text-is("Replacement text") textarea`,'该项目的 SRAM 访问上限为 23 ns。');await page.getByRole('button',{name:'Correct to replacement candidate',exact:true}).click();await browser.wait(`document.querySelector(${JSON.stringify(panel)}).innerText.includes('Correction saved as a replacement candidate.')`);
    item=(await status()).records[0]!;assert.equal(item.record.version,2);assert.equal(item.tip.state,'candidate');assert.equal(item.record.text.includes('23 ns'),true);
    await page.locator(`${article} input[type=checkbox]`).click();await fill(`${article} label:text-is("Change reason") textarea`,'采用新的23纳秒');await page.getByRole('button',{name:'Adopt',exact:true}).click();await browser.wait(`document.querySelector(${JSON.stringify(panel)}).innerText.includes('adopted recorded.')`);
    await fill(`${article} label:text-is("Change reason") textarea`,'停止使用该事实');await page.getByRole('button',{name:'Disable',exact:true}).click();await browser.wait(`document.querySelector(${JSON.stringify(panel)}).innerText.includes('disabled recorded.')`);
    const domArticle=`${panel} article:has(textarea)`;
    await page.evaluate(`document.querySelector(${JSON.stringify(domArticle)}).scrollIntoView({block:'start'})`);
    const geometry=await page.evaluate<{team:{clientWidth:number;scrollWidth:number};memory:{clientWidth:number;scrollWidth:number};viewport:{left:number;right:number};bounds:{left:number;right:number};visibleState:boolean}>(`(()=>{const t=document.querySelector('[data-hima-region="himateam"]'),m=document.querySelector(${JSON.stringify(panel)}),a=document.querySelector(${JSON.stringify(domArticle)}),b=document.querySelector('.hima-workbench-body');const v=b.getBoundingClientRect(),r=a.getBoundingClientRect();return {team:{clientWidth:t.clientWidth,scrollWidth:t.scrollWidth},memory:{clientWidth:m.clientWidth,scrollWidth:m.scrollWidth},viewport:{left:v.left,right:v.right},bounds:{left:r.left,right:r.right},visibleState:a.innerText.includes('Current state: disabled')}})()`);
    await writeFile(path.join(evidence,'geometry.json'),JSON.stringify(geometry,null,2));assert.ok(geometry.team.scrollWidth<=geometry.team.clientWidth+1,'Team content must not horizontally overflow');assert.ok(geometry.memory.scrollWidth<=geometry.memory.clientWidth+1,'Memory provenance must wrap');assert.ok(geometry.bounds.left>=geometry.viewport.left-1&&geometry.bounds.right<=geometry.viewport.right+1,'Entire memory article must fit the visible pane');assert.equal(geometry.visibleState,true);
    await browser.screenshot({path:path.join(evidence,'disabled-memory-visible.png'),fullPage:true,timeout:10000});
    await writeFile(path.join(evidence,'functional-result.json'),JSON.stringify({result:'functional-PASS-pending-cleanup',modelCalls:0,hindsightStarts:0,memberStarts:0,geometry},null,2));
  } catch(error) {await writeFile(path.join(evidence,'failure.txt'),String(error));await browser.screenshot({path:path.join(evidence,'failure.png'),fullPage:true,timeout:10000}).catch(()=>{});throw error;}
  finally {await browser.dispose();await home.dispose();}
  await writeFile(path.join(evidence,'result.json'),JSON.stringify({result:'PASS',modelCalls:0,hindsightStarts:0,memberStarts:0,cleanup:'owned App/Host/PG closed'},null,2));
});
