// #105 bounded L3: painted Electron + real Host/private PG/DBOS + ordinary Node IO.
// Actual App/Host/private PG qualification; no SDK/model qualification.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chmod, mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { TeamTaskView } from '@hima/harness';
import { createEmptyHome, repoRoot } from './support/dsh-home.ts';
import { bootTeamPlaywright, finishTeamOnboarding } from './support/team-playwright-electron.ts';
const pause = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
const quote = (value: string) => "'" + value.replaceAll("'", "'\\''") + "'";

test('actual painted App checks formal human response and explicitly adopts the reviewed saved definition', { timeout: 600000 }, async t => {
  const home = await createEmptyHome();
  const evidence = path.join(process.env.HIMA_TEAM_EVIDENCE ?? path.join(repoRoot, '.scratch/issue105-human-ui'), new Date().toISOString().replace(/[:.]/gu, '-'));
  await mkdir(evidence, { recursive: true });
  const support = path.join(path.dirname(fileURLToPath(import.meta.url)), 'support');
  const wrapper = path.join(evidence, 'host-node');
  const budgetGC = path.join(evidence, 'budget-gc.mjs');
  await writeFile(budgetGC, "if(typeof globalThis.gc!=='function')throw new Error('Test Host budget requires exposed GC');setInterval(()=>globalThis.gc(),750).unref();\n");
  // Electron keeps its original binary. Only Desktop's existing HIMA_NODE Host selector uses this wrapper.
  await writeFile(wrapper, `#!/bin/sh\nexec ${quote(process.execPath)} --max-old-space-size=128 --max-semi-space-size=1 --expose-gc --import ${quote(budgetGC)} --import ${quote(path.join(support, 'issue105-host-preload.mjs'))} "$@"\n`, { mode: 0o700 });
  await chmod(wrapper, 0o700);
  const adaptedHome = { ...home, env: { ...home.env, NODE_TEST_CONTEXT:'child-v8', HIMA_DBOS_TEST_LIB: path.join(repoRoot, 'packages/harness/lib'),
    HIMA_ISSUE105_EVIDENCE: evidence, HIMA_ISSUE105_RUNNER: path.join(support, 'issue105-human-runner.mjs'),
    HIMA_TEST_SILENT_AGENT: '1', HIMA_TEST_LEGACY_AUTO_DRIVE: '0' } };
  const browser = await bootTeamPlaywright(adaptedHome, evidence, { nodeWrapper: wrapper, v8HeapMiB: 96 });
  const page = browser.page;
  await page.addInitScript("setInterval(() => globalThis.gc?.(), 500)");
  await page.evaluate("(() => { setInterval(() => globalThis.gc?.(), 500); })()");
  const actions: string[] = [], responseBodies: any[] = [];
  const handoffObservations: {taskId:string;currentRunId:string;state:string}[] = [];
  page.on('response', response => {
    if (!response.url().endsWith('/hima/api/teams') || !response.ok()) return;
    void response.json().then(value => {
      if(!value||typeof value!=='object'||Array.isArray(value))return;
      const task=value as TeamTaskView;
      if(task.definitionHandoff)handoffObservations.push({taskId:task.taskId,currentRunId:task.currentRunId,state:task.definitionHandoff.state});
    }).catch(() => undefined);
  });
  let sessionId = '';
  page.on('request', request => {
    if (!request.url().endsWith('/hima/api/teams')) return;
    try { const body = JSON.parse(request.postData() ?? '{}');
      if (body.sessionId) sessionId = body.sessionId;
      if (typeof body.request?.action === 'string') actions.push(body.request.action);
      if (body.request?.action === 'respond' || body.request?.action === 'control') responseBodies.push(body.request);
    } catch { /* Never retain credentials, raw headers or authentication tokens. */ }
  });
  const click = async (control: string) => page.locator(`[data-hima-control="${control}"]`).click();
  const fill = async (control: string, value: string) => page.locator(`[data-hima-control="${control}"]`).fill(value);
  const readRetained = async (): Promise<any[]> => JSON.parse(await readFile(path.join(evidence, 'host-retained.json'), 'utf8'));
  let closed = false;
  try {
    assert.equal(process.versions.node.split('.')[0], '24', 'Source wrapper must execute the admitted actual Node 24');
    await finishTeamOnboarding(browser);
    const registered = await page.evaluate<{result:{ok:boolean}}>(`fetch('/api/workspace/create',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({type:'client-request',rpcId:'human-workspace',method:'workspace/create',payload:{args:{request:{path:${JSON.stringify(home.workspace)}}}}})}).then(r=>r.json())`);
    assert.equal(registered.result.ok, true);
    await browser.wait(`!!document.querySelector('[role="treegrid"], [role="tree"]')`);
    await page.locator('[data-row-key^="workspace:"]:has(span:text-is("workspace"))').hover();
    await page.getByRole('button', { name: 'New session in workspace', exact: true }).click();
    await browser.wait(`document.querySelector('[data-hima-control="open-workbench"]')?.disabled === false`);
    await click('open-workbench'); await click('studio-mode-team');
    await browser.wait(`document.querySelector('[data-hima-control="team-title"]')?.disabled === false`);
    const models = '[data-hima-region="team-models"]';
    await page.locator(`${models} summary`).click();
    for (const [label, value] of [['Model reference','human-ui-node'],['Model ID','ordinary-node'],['Model API endpoint','https://fixture.invalid/v1'],['API key','private-test-only']])
      await page.locator(`${models} label:has-text("${label}") input`).fill(value!);
    await page.locator(`${models} label:has-text("Runtime") select`).selectOption('opencode');
    await page.getByRole('button', { name: 'Save member model', exact: true }).click();
    await browser.wait(`document.querySelector('${models} input[type="password"]').value === '' && document.querySelector('${models}').innerText.includes('human-ui-node')`);
    const member = '[data-hima-region="himateam"] > fieldset.hima-memory-candidates';
    await page.locator(`${member} label:has-text("Runtime") select`).selectOption('opencode');
    await page.locator(`${member} label:has-text("Model reference") input`).fill('human-ui-node');
    await page.locator(`${member} label:has-text("Role") input`).fill('Human UI lead');
    await page.locator(`${member} label:has-text("toolRefs") input`).fill('hima-member-context');
    await page.locator('label:has-text("Delivery schema declaration") textarea').fill(JSON.stringify({version:'answer/1',schema:{$schema:'https://json-schema.org/draft/2020-12/schema',type:'object',properties:{answer:{type:'string'}},required:['answer'],additionalProperties:false}}));
    await fill('team-title', 'Formal human UI source test'); await click('team-save');
    await browser.wait(`document.querySelector('[data-hima-region="himateam"]').dataset.himaStateTeam !== '' && !document.querySelector('[data-hima-control="team-save"]').disabled`);
    const teamId = await page.evaluate<string>(`document.querySelector('[data-hima-region="himateam"]').dataset.himaStateTeam`);
    await fill('team-goal', 'Deliver a checked successor after an actual human answer.');
    await fill('team-input', '{}'); await fill('team-closure', 'Deliver answer/1 after human-answer/1.');
    const deadline = new Date(Date.now() + 300000);
    await fill('team-deadline', new Date(deadline.getTime() - deadline.getTimezoneOffset() * 60000).toISOString().slice(0,16));
    await click('team-start-task');
    await browser.wait(`!!document.querySelector('section[aria-label="Human decision"]')`, 90000);
    const taskId = await page.evaluate<string>(`document.querySelector('[data-hima-region="himateam"]').dataset.himaStateTask`);
    assert.ok(sessionId);
    const readTask = async () => page.evaluate<TeamTaskView>(`fetch('/hima/api/teams',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({sessionId:${JSON.stringify(sessionId)},request:{action:'readTask',teamId:${JSON.stringify(teamId)},taskId:${JSON.stringify(taskId)}}})}).then(async r=>{if(!r.ok)throw Error(await r.text());return r.json()})`);
    const before = await readTask(), request = before.humanRequests?.[0]; assert.ok(request);
    const frozenTeam = await page.evaluate<any>(`fetch('/hima/api/teams',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({sessionId:${JSON.stringify(sessionId)},request:{action:'read',teamId:${JSON.stringify(teamId)},version:${before.team.version}}})}).then(async r=>{if(!r.ok)throw Error(await r.text());return r.json()})`);
    assert.equal(frozenTeam.definition.members[0].role,'Human UI lead');
    assert.equal(frozenTeam.definition.members[0].runtime,'opencode');
    assert.equal(frozenTeam.definition.members[0].modelRef,'human-ui-node');
    assert.equal(request.binding.requestId, 'human-ui-decision-' + before.currentRunId);
    assert.equal(request.binding.taskId, taskId); assert.equal(request.binding.runId, before.currentRunId);
    assert.equal(request.text, 'Approve the measured human UI answer.'); assert.equal(request.output.version, 'human-answer/1');
    await page.locator('section[aria-label="Human decision"] summary').click();
    await browser.wait(`document.querySelector('section[aria-label="Human decision"]').innerText.includes('additionalProperties')`);
    // Preserve paint: helper.screenshot hides afterward; these two frames use the owned painted window directly.
    await page.screenshot({path:path.join(evidence,'formal-question-schema.png'),fullPage:true,timeout:10000});
    let retainedBefore: any[] = [];
    for (const expires=Date.now()+5000;Date.now()<expires;) { retainedBefore=await readRetained(); if(retainedBefore[0]?.request?.binding?.requestId===request.binding.requestId)break;await pause(25); }
    assert.equal(retainedBefore.length,1);
    assert.deepEqual(retainedBefore[0].request,request); assert.equal(retainedBefore[0].response,null);
    assert.equal(retainedBefore[0].operator,request.binding.principalId);
    const original = retainedBefore[0].effects.find((effect:any)=>effect.prepared && effect.closed);
    assert.ok(original?.closed, 'actual parent closure precedes human UI request');
    assert.equal(original.resources.length,1); assert.equal(original.resources[0].released,true);
    assert.equal(original.closed.absent,true);
    await page.locator('section[aria-label="Human decision"] textarea').fill(JSON.stringify({answer:'human-ui-approved'}));
    await click('team-human-respond');
    await browser.wait(`document.querySelector('[data-hima-region="himateam"]').innerText.includes('successor-consumed-human-ui-approved')`,90000);
    const after = await readTask(); assert.equal(after.currentRunId,before.currentRunId);
    assert.equal(after.humanRequests?.length,0); assert.equal(after.deadlineAt,before.deadlineAt);
    const responses = responseBodies.filter(body=>body.action==='respond'); assert.equal(responses.length,1);
    assert.deepEqual(responses[0].request.binding,request.binding);
    assert.deepEqual(responses[0].request.output,{schemaVersion:'human-answer/1',value:{answer:'human-ui-approved'},artifacts:[],diagnostics:[]});
    let retained: any[] = [];
    for (const expires = Date.now()+30000; Date.now()<expires;) {
      retained=await readRetained();
      if(retained[0]?.effects.some((effect:any)=>effect.snapshot.result?.value?.answer==='successor-consumed-human-ui-approved' && effect.snapshot.resourcesReleased && effect.closed?.absent===true))break;
      await pause(50);
    }
    const row=retained[0]; assert.deepEqual(row.request,request); assert.deepEqual(row.response.binding,request.binding);
    assert.deepEqual(row.response.output,responses[0].request.output);
    const child=row.effects.find((effect:any)=>effect.invocation.identity.effectId===request.binding.effectId);
    assert.deepEqual(child.snapshot.result.value,{answer:'human-ui-approved'}); assert.equal(child.snapshot.resourcesReleased,true);
    const successor=row.effects.find((effect:any)=>effect.snapshot.result?.value?.answer==='successor-consumed-human-ui-approved');
    assert.ok(successor?.closed); assert.equal(successor.snapshot.resourcesReleased,true);
    assert.deepEqual(after.execution?.tasks.find(effect=>effect.effectId===successor.invocation.identity.effectId)?.result,successor.snapshot.result);
    const head=row.effects.find((effect:any)=>effect.head?.continuation)?.head;
    assert.ok(head?.continuation); assert.deepEqual(head.continuation.inputs[0].result,child.snapshot.result);
    assert.equal(successor.prepared.inputId,head.continuation.hostInputId);
    assert.equal(successor.prepared.prompt,head.continuation.hostPrompt);
    assert.notEqual(successor.native.streamGeneration,original.native.streamGeneration);
    // Actual receive is a production external fact, not inferred merely from a queued prompt.
    assert.ok(successor.continuationReceipt, 'Host retained the actual successor correlated receive receipt');
    const observed = Object.values(successor.externalFacts) as any[];
    assert.equal(observed.filter(value=>value.kind==='received' && value.payload.inputId===successor.prepared.inputId).length,1);
    assert.equal(observed.filter(value=>value.kind==='terminal' && value.payload.inputId===successor.prepared.inputId).length,1);
    assert.equal(row.effects.filter((effect:any)=>effect.prepared).length,2,'one original and one actual successor');
    await page.screenshot({path:path.join(evidence,'checked-human-successor-result.png'),fullPage:true,timeout:10000});
    const nativeCaller = JSON.parse(await readFile(path.join(evidence,'last-member-request.json'),'utf8'));
    assert.equal(nativeCaller.grant.projectId,after.projectId); assert.equal(nativeCaller.grant.taskId,taskId);
    assert.equal(nativeCaller.grant.runId,after.currentRunId);
    // Second scenario shares the owned Home/Host/window; only authenticated setup saves use HTTP.
    // All task opening, version choice, Apply and accepted human response use the painted UI.
    await page.getByRole('button', { name: 'Back to team definition', exact: true }).click();
    await browser.wait(`document.querySelector('[data-hima-control="team-goal"]')?.disabled === false`);
    await fill('team-goal', 'Adopt reviewed v2 while this v1 task awaits a human.');
    await fill('team-input', '{}'); await fill('team-closure', 'Deliver answer/1 after saved-definition adoption.');
    const adoptionDeadline = new Date(Date.now() + 300000);
    await fill('team-deadline', new Date(adoptionDeadline.getTime() - adoptionDeadline.getTimezoneOffset() * 60000).toISOString().slice(0,16));
    await click('team-start-task');
    await browser.wait(`document.querySelector('[data-hima-region="himateam"]').dataset.himaStateTask !== '' && document.querySelector('[data-hima-region="himateam"]').dataset.himaStateTask !== ${JSON.stringify(taskId)}`,90000);
    await browser.wait(`!!document.querySelector('section[aria-label="Human decision"]')`,90000);
    const adoptionTaskId = await page.evaluate<string>(`document.querySelector('[data-hima-region="himateam"]').dataset.himaStateTask`);
    assert.notEqual(adoptionTaskId,taskId);
    const teamRequest = async (request: unknown) => page.evaluate<{status:number;value:any}>(`fetch('/hima/api/teams',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({sessionId:${JSON.stringify(sessionId)},request:${JSON.stringify(request)}})}).then(async r=>{const text=await r.text();let value;try{value=JSON.parse(text)}catch{value={error:text}}return {status:r.status,value}})`);
    const readAdoptionTask = async (): Promise<TeamTaskView> => {
      const reply = await teamRequest({action:'readTask',teamId,taskId:adoptionTaskId});
      assert.equal(reply.status,200); return reply.value;
    };
    const predecessor = await readAdoptionTask();
    assert.equal(predecessor.team.version,1); assert.ok(predecessor.execution);
    const oldHuman = predecessor.humanRequests?.[0]; assert.ok(oldHuman);
    const saveVersion = async (version: number, memberId: string, role: string) => {
      const definition = {...frozenTeam.definition,title:`Saved adoption v${version}`,
        members:[{...frozenTeam.definition.members[0],id:memberId,role}],leaderMemberId:memberId,
        delivery:{...frozenTeam.definition.delivery,description:`Reviewed delivery v${version}`}};
      const reply = await teamRequest({action:'save',teamId,expectedVersion:version-1,definition});
      assert.equal(reply.status,200); assert.equal(reply.value.version,version); return reply.value;
    };
    const selectedV2 = await saveVersion(2,'adoption-v2-lead','Frozen v2 lead');
    await page.getByRole('button', {name:'Refresh task work',exact:true}).click();
    await browser.wait(`!!document.querySelector('[data-hima-control="team-definition-version"] option[value="2"]')`);
    await page.locator('[data-hima-control="team-definition-version"]').selectOption('2');
    await browser.wait(`document.querySelector('section[aria-label="Saved team definition"]').innerText.includes('Selected saved version 2 · ${selectedV2.sha256}')`);
    const selectedOnly = await readAdoptionTask();
    assert.deepEqual(selectedOnly.team,predecessor.team); assert.equal(selectedOnly.currentRunId,predecessor.currentRunId);
    assert.equal(selectedOnly.definitionHandoff,undefined);
    const savedV3 = await saveVersion(3,'adoption-v3-lead','Latest v3 lead');
    await page.getByRole('button', {name:'Refresh task work',exact:true}).click();
    await browser.wait(`!!document.querySelector('[data-hima-control="team-definition-version"] option[value="3"]')`);
    assert.equal(await page.locator('[data-hima-control="team-definition-version"]').inputValue(),'2');
    const beforeApply = await readAdoptionTask();
    assert.deepEqual(beforeApply.team,predecessor.team); assert.equal(beforeApply.currentRunId,predecessor.currentRunId);
    assert.equal(beforeApply.definitionHandoff,undefined);
    // UI displays the same observed stamps that must accompany the control request.
    await browser.wait(`document.querySelector('section[aria-label="Task controls"]').innerText.includes('Current run ${beforeApply.currentRunId} · generation ${beforeApply.execution!.epoch} · revision ${beforeApply.execution!.revision}')`);
    await fill('team-message-text','Retain this draft across the frozen-definition handoff.');
    const recipients = page.locator('[data-hima-region="team-task-work"] fieldset').filter({has:page.getByText('Recipients from the frozen team',{exact:true})});
    await recipients.getByRole('checkbox').check();
    await click('team-apply-definition');
    await browser.wait(`document.querySelector('[data-hima-definition-handoff="adopted"]') !== null`,90000);
    const adopted = await readAdoptionTask();
    assert.equal(adopted.definitionHandoff?.state,'adopted');
    assert.equal(adopted.definitionHandoff?.predecessorRunId,predecessor.currentRunId);
    assert.equal(adopted.definitionHandoff?.successorRunId,adopted.currentRunId);
    assert.notEqual(adopted.currentRunId,predecessor.currentRunId);
    assert.deepEqual(adopted.team,{teamId,version:2,sha256:selectedV2.sha256});
    assert.deepEqual(adopted.definitionHandoff?.selected,adopted.team);
    assert.equal(adopted.deadlineAt,predecessor.deadlineAt);
    const frozenSuccessor = await teamRequest({action:'read',teamId,version:adopted.team.version});
    assert.equal(frozenSuccessor.status,200); assert.equal(frozenSuccessor.value.sha256,adopted.team.sha256);
    assert.deepEqual(frozenSuccessor.value.definition.members,selectedV2.definition.members);
    await browser.wait(`document.querySelector('nav[aria-label="Team task members"]').innerText.includes('Frozen v2 lead')`);
    assert.equal(await page.locator('nav[aria-label="Team task members"] button').count(),1);
    assert.equal(await page.locator('nav[aria-label="Team task members"] button').innerText(),'Frozen v2 lead');
    const applyRequests=responseBodies.filter(body=>body.action==='control' && body.taskId===adoptionTaskId && body.request.action==='applyDefinition');
    assert.equal(applyRequests.length,1);
    assert.equal(applyRequests[0].request.definitionVersion,2);
    assert.equal(applyRequests[0].request.expectedRunId,beforeApply.currentRunId);
    assert.equal(applyRequests[0].request.expectedEpoch,beforeApply.execution!.epoch);
    assert.equal(applyRequests[0].request.expectedRevision,beforeApply.execution!.revision);
    assert.ok(handoffObservations.some(value=>value.taskId===adoptionTaskId && value.state==='closing'),'actual Host closing observation precedes adoption');
    await browser.wait(`document.querySelector('[data-hima-region="team-task-work"] fieldset').innerText.includes('Frozen v2 lead · adoption-v2-lead')`);
    assert.equal(await recipients.getByRole('checkbox').count(),1);
    assert.ok((await recipients.innerText()).includes('Frozen v2 lead · adoption-v2-lead'));
    assert.equal(await recipients.getByRole('checkbox').isChecked(),false,'removed predecessor recipient is pruned');
    assert.equal(await page.locator('[data-hima-control="team-message-text"]').inputValue(),'Retain this draft across the frozen-definition handoff.');
    // Attempt the actual retained old binding through authenticated production respond, not a fabricated binding.
    const staleResponse = await teamRequest({action:'respond',teamId,taskId:adoptionTaskId,request:{requestId:'stale-predecessor-human-response',binding:oldHuman.binding,
      output:{schemaVersion:'human-answer/1',value:{answer:'human-ui-approved'},artifacts:[],diagnostics:[]}}});
    assert.ok(staleResponse.status>=400 && staleResponse.status<500,'old Run human response must be rejected');
    assert.equal((await readAdoptionTask()).currentRunId,adopted.currentRunId);
    await browser.wait(`!!document.querySelector('section[aria-label="Human decision"]')`,90000);
    let pendingSuccessor = await readAdoptionTask();
    for(const expires=Date.now()+30000;Date.now()<expires && !pendingSuccessor.humanRequests?.some(value=>value.binding.runId===adopted.currentRunId);) { await pause(50); pendingSuccessor=await readAdoptionTask(); }
    const newHuman = pendingSuccessor.humanRequests?.find(value=>value.binding.runId===adopted.currentRunId); assert.ok(newHuman);
    assert.equal(newHuman.binding.runId,adopted.currentRunId); assert.notEqual(newHuman.binding.runId,oldHuman.binding.runId);
    assert.equal(newHuman.binding.requestId,'human-ui-decision-' + adopted.currentRunId);
    assert.notEqual(newHuman.binding.requestId,oldHuman.binding.requestId,'new Run does not alias its predecessor human request');
    await page.screenshot({path:path.join(evidence,'adopted-v2-frozen-recipients.png'),fullPage:true,timeout:10000});
    await page.locator('section[aria-label="Human decision"] textarea').fill(JSON.stringify({answer:'human-ui-approved'}));
    await click('team-human-respond');
    await browser.wait(`document.querySelector('[data-hima-region="himateam"]').innerText.includes('successor-consumed-human-ui-approved')`,90000);
    const checkedAdoption = await readAdoptionTask();
    assert.equal(checkedAdoption.currentRunId,adopted.currentRunId); assert.equal(checkedAdoption.humanRequests?.length,0);
    let adoptionRow: any;
    for(const expires=Date.now()+30000;Date.now()<expires;) {
      adoptionRow=(await readRetained()).find(row=>row.request.binding.taskId===adoptionTaskId && row.request.binding.runId===adopted.currentRunId);
      if(adoptionRow?.effects.some((effect:any)=>effect.snapshot.result?.value?.answer==='successor-consumed-human-ui-approved' && effect.snapshot.resourcesReleased && effect.closed?.absent===true))break;
      await pause(50);
    }
    assert.ok(adoptionRow); assert.deepEqual(adoptionRow.response.binding,newHuman.binding);
    const adoptionChecked=adoptionRow.effects.find((effect:any)=>effect.snapshot.result?.value?.answer==='successor-consumed-human-ui-approved');
    assert.ok(adoptionChecked?.closed); assert.equal(adoptionChecked.snapshot.resourcesReleased,true);
    assert.deepEqual(checkedAdoption.execution?.tasks.find(effect=>effect.effectId===adoptionChecked.invocation.identity.effectId)?.result,adoptionChecked.snapshot.result);
    const oldRow=(await readRetained()).find(row=>row.request.binding.taskId===adoptionTaskId && row.request.binding.runId===predecessor.currentRunId);
    assert.ok(oldRow); assert.equal(oldRow.response,null,'stale predecessor answer created no retained response');
    await page.screenshot({path:path.join(evidence,'adopted-v2-checked-result.png'),fullPage:true,timeout:10000});
    await writeFile(path.join(evidence,'active-definition-result.json'),JSON.stringify({result:'PASS',layer:'L3 ordinary Node IO',teamId,taskId:adoptionTaskId,
      predecessor,selectedV2,savedV3,applyRequest:applyRequests[0],handoffObservations,adopted,staleResponseStatus:staleResponse.status,
      newHuman,frozenSuccessor:frozenSuccessor.value,checkedAdoption,checkedResult:adoptionChecked.snapshot.result,productModelCalls:0,nativeSdkCalls:0},null,2));
    await writeFile(path.join(evidence,'result.json'),JSON.stringify({result:'PASS',layer:'L3 ordinary Node IO',teamId,taskId,currentRunId:after.currentRunId,
      windowGeometry:await page.evaluate(`({x:window.screenX,y:window.screenY,width:window.outerWidth,height:window.outerHeight,devicePixelRatio:window.devicePixelRatio})`),deadlineAt:after.deadlineAt,binding:request.binding,projectId:after.projectId, frozenTeam, nativeCaller: nativeCaller.grant, originalIdentity:original.invocation.identity, successorIdentity:successor.invocation.identity, actions,productModelCalls:0,nativeSdkCalls:0,
      activeDefinitionTaskId:adoptionTaskId, limitation:'No native SDK/model capability; pause/resume/cold reopen and stale cross-Run polling are not exercised.'},null,2));
  } catch(error) {
    await writeFile(path.join(evidence,'failure.txt'),String(error)+'\n'+await page.evaluate<string>('document.body.innerText').catch(()=> 'Renderer unavailable'));
    await page.screenshot({path:path.join(evidence,'failure.png'),fullPage:true,timeout:10000}).catch(()=>undefined);
    t.diagnostic(`Evidence retained: ${evidence}`); throw error;
  } finally {
    await browser.dispose(); closed=true;
    if(closed) await home.dispose();
  }
});
