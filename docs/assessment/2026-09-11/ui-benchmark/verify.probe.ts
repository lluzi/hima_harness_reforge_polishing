import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { bootDriver, fillForm, theOneRunId } from '../../../../test/contract/support/driver.ts';
import { freePort } from '../../../../test/contract/support/boot-host.ts';
import { timingProbePackId } from '../../../../test/contract/support/pack.ts';
const out=path.resolve('docs/assessment/2026-09-11/ui-benchmark');
async function inspector(port: number) {
  const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json() as { type: string; webSocketDebuggerUrl: string }[];
  const page = targets.find((target) => target.type === 'page'); assert.ok(page);
  const socket = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise<void>((resolve, reject) => { socket.addEventListener('open', () => resolve(), { once: true }); socket.addEventListener('error', reject, { once: true }); });
  let seq=0;
  const pending = new Map<number, { resolve:(v:any)=>void; reject:(e:Error)=>void }>();
  socket.addEventListener('message',(event)=>{ const m=JSON.parse(String(event.data)); if(m.id!==undefined){const p=pending.get(m.id);pending.delete(m.id);if(m.error)p?.reject(new Error(m.error.message));else p?.resolve(m.result);}});
  const evaluate = async (expression: string) => {
    const result:any = await new Promise((resolve,reject)=>{ const id=++seq;const timer=setTimeout(()=>{pending.delete(id);reject(new Error('DOM inspection timed out'));},10000);pending.set(id,{resolve:(v)=>{clearTimeout(timer);resolve(v);},reject:(e)=>{clearTimeout(timer);reject(e);}});socket.send(JSON.stringify({id,method:'Runtime.evaluate',params:{expression,awaitPromise:true,returnByValue:true}})); });
    if(result.exceptionDetails)throw new Error(result.exceptionDetails.text);
    return result.result.value;
  };
  return { evaluate, close:()=>socket.close() };
}



for(const theme of ['light','dark'] as const) test(`research navigation in ${theme} theme`,async(t)=>{
 const port=await freePort();
 const d=await bootDriver(t,{home:'hima',sleepSeconds:0,remoteDebuggingPort:port,theme,window:{width:theme==='light'?1280:900,height:860}});
 if(!d)return;
 let b;
 const result:Record<string,unknown>={theme};
 try{
  b=await inspector(port);
  const wait=async(expression:string)=>{const until=Date.now()+12000;for(;;){if(await b!.evaluate(expression))return;if(Date.now()>until)throw new Error(`Timed out: ${expression}`);await new Promise(r=>setTimeout(r,75));}};
  await d.open('/');
  await wait(`!!document.querySelector('[data-hima-control="open-workbench"]')`);
  await wait('document.body.innerText.includes("Internal Testing Notice")');
  result.beforeNotice=await b.evaluate(`({buttons:[...document.querySelectorAll('button,[role="button"]')].map(e=>({tag:e.tagName,text:e.textContent})),text:document.body.innerText})`);
  await b.evaluate(`(()=>{const e=[...document.querySelectorAll('button,[role="button"],span,div')].find(e=>e.childElementCount===0&&e.textContent.trim()==='Continue');if(e)(e.closest('button,[role="button"]')??e).click();})()`);
  await wait('!document.body.innerText.includes("Internal Testing Notice")');
  await wait('document.body.innerText.includes("Configure later")');
  await b.evaluate(`[...document.querySelectorAll('button')].find(e=>e.textContent.trim()==='Configure later').click()`);
  await wait(`(()=>{const e=document.querySelector('[data-hima-control="open-workbench"]');const r=e.getBoundingClientRect();return document.elementFromPoint(r.x+r.width/2,r.y+r.height/2)?.closest('[data-hima-control]')===e})()`);
  await b.evaluate('document.fonts.ready.then(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>resolve(true)))))');
  assert.ok((await d.screenshot(path.join(out,`after-chat-${theme}.png`))).ok);
  const workbench=await d.click('open-workbench');result.workbenchClick=workbench;assert.ok(workbench.ok,JSON.stringify(workbench));
  assert.ok((await d.wait('start','pack',10000)).ok);
  result.form=await b.evaluate('({width:innerWidth,scrollWidth:document.documentElement.scrollWidth,groups:[...document.querySelectorAll("legend")].map(e=>e.textContent),links:[...document.querySelectorAll(".chrome a")].map(e=>({label:e.textContent,href:e.getAttribute("href")}))})');
  assert.ok((result.form as any).scrollWidth <= (result.form as any).width,'no document horizontal overflow');
  assert.ok((await d.screenshot(path.join(out,`after-workbench-${theme}.png`))).ok);
  await fillForm(d,{'start-pack':timingProbePackId,'start-site':'local','start-target':'2.3','start-knob-periodNs':'2.3','start-time-box':'5','start-retries':'1','start-generations':'2'});
  assert.ok((await d.click('start')).ok);
  assert.ok((await d.wait('run-status','ended — goal met',30000)).ok);
  const run=await theOneRunId(d);
  assert.ok((await d.open(`/hima/?run=${run}`)).ok);
  await wait('!!document.getElementById("run-report")');
  result.run=run;
  result.destinations=await b.evaluate('([...document.querySelectorAll(".section-nav a")].map(e=>({href:e.getAttribute("href"),exists:!!document.querySelector(e.getAttribute("href"))})))');
  assert.ok((result.destinations as any[]).every(e=>e.exists));
  const report=await d.click('show-report');assert.ok(report.ok,JSON.stringify(report));
  await wait('location.hash==="#run-report"');
  await b.evaluate('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>resolve(true))))');
  result.report=await b.evaluate(`({hash:location.hash,top:document.getElementById("run-report").getBoundingClientRect().top,navBottom:document.querySelector(".section-nav").getBoundingClientRect().bottom,width:innerWidth,scrollWidth:document.documentElement.scrollWidth,text:document.querySelector('[data-hima-region="run-experience"]').innerText.slice(0,350)})`);
  assert.ok((result.report as any).top >= (result.report as any).navBottom-1,JSON.stringify(result.report));
  assert.ok((result.report as any).scrollWidth <= (result.report as any).width);
  assert.ok((await d.screenshot(path.join(out,`after-report-${theme}.png`))).ok);
  assert.ok((await d.click('show-overview')).ok);
  await wait('location.hash==="#run-overview"');
  assert.ok((await d.screenshot(path.join(out,`after-run-${theme}.png`))).ok);
  assert.ok((await d.click('open-chat')).ok);
  await wait(`!!document.querySelector('[data-hima-control="open-workbench"]')`);
  assert.ok((await d.click('open-workbench')).ok);
  const runs=await d.wait('runs',run,10000);assert.ok(runs.ok,JSON.stringify(runs));
  result.returnedRunVisible=true;
  assert.deepEqual(d.unexpectedStdout(),[]);
 }finally{await writeFile(path.join(out,`window-${theme}.json`),JSON.stringify(result,null,2)+'\n');b?.close();await d.dispose();}
});
