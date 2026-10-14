// Test-owned orchestration proof only. Never authorizes a product action/receipt.
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { lstat, readFile, realpath, writeFile, link, unlink } from 'node:fs/promises';
import path from 'node:path';
export const digest = (s: string) => createHash('sha256').update(s).digest('hex');
export function calculatorBarrier(deadlineAt: string) {
  const nonce = randomUUID(), enteredName = `.native-entered-${nonce}.json`, releaseName = `.native-release-${nonce}.json`;
  const script = `const fs=require("node:fs"),crypto=require("node:crypto"),nonce=${JSON.stringify(nonce)},deadline=${Date.parse(deadlineAt)},entered=${JSON.stringify(enteredName)},release=${JSON.stringify(releaseName)};const enteredTemp=entered+"."+process.pid+".tmp";fs.writeFileSync(enteredTemp,JSON.stringify({nonce,pid:process.pid,cwd:process.cwd(),executable:process.execPath,enteredAt:new Date().toISOString()}),{flag:"wx"});try{if(Date.now()>=deadline)throw Error("original calculator deadline exceeded");fs.linkSync(enteredTemp,entered)}finally{fs.unlinkSync(enteredTemp)};const timer=setInterval(()=>{if(Date.now()>=deadline){clearInterval(timer);throw Error("original calculator deadline exceeded")}if(!fs.existsSync(release))return;const r=JSON.parse(fs.readFileSync(release,"utf8"));if(r.nonce!==nonce)throw Error("release nonce differs");clearInterval(timer);const answer=37*19,bytes=String(answer);fs.writeFileSync("product.txt",bytes);console.log(JSON.stringify({answer,sha256:crypto.createHash("sha256").update(bytes).digest("hex")}))},10);`;
  const shellQuote = (value: string) => "'" + value.replaceAll("'", "'\\''") + "'";
  const command = `${shellQuote(process.execPath)} -e ${shellQuote(script)}`;
  return { nonce, enteredName, releaseName, command, script, commandSha256: digest(command), deadlineAt };
}
type Barrier = ReturnType<typeof calculatorBarrier>;
type Row = any;
// Optional observer of existing checks only: no I/O, proof relaxation or receipt.
export type BusyStage = (facts: Record<string, string | number | boolean | null>) => void;
export function mappedInputId(sessionKey: string, id: string) {
  const d = digest(JSON.stringify([sessionKey,id]));
  return `${d.slice(0,8)}-${d.slice(8,12)}-8${d.slice(13,16)}-8${d.slice(17,20)}-${d.slice(20,32)}`;
}
function jsonInput(v: unknown): any { if(typeof v==='string')return JSON.parse(v); return v; }
// Pending means only that the actual marker/native event has not arrived yet.
// A contradictory identity/completion is a hard failure, never a permissive guard.
export function nativeCommandEvidence(p: any, rows: Row[], barrier: Barrier, stage?: BusyStage) {
  stage?.({ proofStage: 'native-original-identity', pendingReason: null });
  assert.ok(!p.continuation,'original fresh worker required');
  const created=rows.filter(r=>r.kind==='created'); assert.equal(created.length,1);
  const session=created[0].nativeSession; assert.ok(session); assert.ok(created[0].streamGeneration);
  for(const row of rows){assert.equal(row.sessionKey,p.sessionKey);assert.equal(row.generation,p.generation);assert.equal(row.memberId,p.memberId);if(row.seq>=created[0].seq)assert.equal(row.nativeSession,session);assert.equal(row.streamGeneration,created[0].streamGeneration);}
  stage?.({ proofStage: 'native-original-prompt' });
  const raw=rows.filter(r=>r.kind==='raw').map(r=>({row:r,record:r.payload}));
  const prompts=raw.filter(x=>x.record.kind==='request'&&x.record.direction==='toRuntime'&&x.record.body?.kind==='prompt');
  assert.equal(prompts.length,1,'single original pending prompt interval');
  const request=prompts[0]; assert.ok(request); assert.equal(request.record.sessionId,session); assert.deepEqual(request.record.agentPath,[]);
  assert.equal(request.record.body.input,p.prompt); assert.equal(digest(request.record.body.input),digest(p.prompt));
  assert.equal(request.record.body.inputId,mappedInputId(p.sessionKey,p.inputId));
  const ack=rows.filter(r=>r.kind==='control'&&r.payload?.action==='prompt_ack'); assert.equal(ack.length,1);
  assert.equal(ack[0].payload.inputId,p.inputId); assert.equal(ack[0].payload.nativeInputId,request.record.body.inputId);
  const intents=rows.filter(r=>r.kind==='control'&&r.payload?.action==='send_intent');assert.equal(intents.length,1);
  assert.equal(intents[0].payload.inputId,p.inputId);assert.equal(intents[0].payload.input,p.prompt);
  stage?.({ proofStage: 'native-original-completion' });
  assert.ok(!rows.some(r=>r.kind==='terminal'),'native original already terminal');
  assert.ok(!rows.some(r=>r.kind==='event'&&r.payload?.kind==='turn_ended'),'native original already ended');
  assert.ok(!raw.some(x=>x.record.kind==='frame'&&x.record.body?.type==='session/prompt'),'native prompt already completed');
  const candidates=raw.filter(x=>x.record.kind==='frame'&&x.record.seq>request.record.seq).flatMap(x=>{
    const b=x.record.body,n=b?.native;
    if(p.runtime==='opencode'&&b?.type==='tool_call_update'&&n?.update?.status==='in_progress'&&n.update.rawInput?.command===barrier.command)
      return [{...x,callId:n.update.toolCallId,input:n.update.rawInput,nativeSession:n.sessionId}];
    if(p.runtime==='pi'&&b?.type==='tool_execution_start'&&n?.toolName==='bash'&&n.args?.command===barrier.command)
      return [{...x,callId:n.toolCallId,input:n.args,nativeSession:x.record.sessionId}];
    return [];
  });
  stage?.({ proofStage: 'native-command-candidate', candidateCount: candidates.length });
  if(!candidates.length) { stage?.({ pendingReason: 'no-command-candidate' }); return undefined; }
  stage?.({ proofStage: 'native-candidate-identity' });
  // ACP repeats identical in_progress updates for one native call. Preserve every
  // raw row and prove one distinct session/call, then use its earliest command frame.
  for(const candidate of candidates) {
    assert.ok(candidate.callId); assert.equal(candidate.nativeSession,session);
    assert.equal(candidate.record.sessionId,session); assert.deepEqual(candidate.record.agentPath,[]);
  }
  const calls=new Set(candidates.map(candidate=>JSON.stringify([candidate.nativeSession,candidate.callId])));
  stage?.({ proofStage: 'native-distinct-call', distinctCallCount: calls.size });
  assert.equal(calls.size,1,'second distinct native calculator call cannot pass busy proof');
  const c=candidates.reduce((earliest,candidate)=>candidate.record.seq<earliest.record.seq?candidate:earliest);
  assert.ok(c); assert.ok(c.callId);
  stage?.({ proofStage: 'native-command-cwd', sdkSeq: c.record.seq, nativeRowSeq: c.row.seq, callId: c.callId, nativeSession: c.nativeSession, commandSha256: barrier.commandSha256 });
  for(const candidate of candidates)assert.equal(candidate.input.cwd,c.input.cwd,'repeated native command CWD differs');
  stage?.({ proofStage: 'native-normalized-event' });
  if(!rows.some(r=>r.kind==='event'&&r.payload?.seq===c.record.seq)) { stage?.({ pendingReason: 'no-normalized-event' }); return undefined; }
  assert.equal(c.nativeSession,session); assert.equal(c.record.sessionId,session); assert.deepEqual(c.record.agentPath,[]);
  stage?.({ proofStage: 'native-start-correlation' });
  const starts=rows.filter(r=>r.kind==='event'&&r.payload?.kind==='tool_call_started'&&r.payload.callId===c.callId);
  assert.equal(starts.length,1); assert.equal(starts[0].payload.sessionId,session);
  if(p.runtime==='opencode') {
    const opening=raw.find(x=>x.record.kind==='frame'&&x.record.body?.type==='tool_call'&&x.record.body.native?.update?.toolCallId===c.callId);
    assert.ok(opening); assert.equal(opening.record.body.native.update.kind,'execute');
    assert.equal(opening.record.sessionId,session); assert.equal(opening.record.body.native.sessionId,session);
    assert.equal(starts[0].payload.seq,opening.record.seq);
  } else assert.equal(starts[0].payload.seq,c.record.seq);
  stage?.({ proofStage: 'native-input-correlation' });
  const inputs=rows.filter(r=>r.kind==='event'&&['tool_call_started','tool_call_input'].includes(r.payload?.kind)&&r.payload.callId===c.callId&&r.payload.seq===c.record.seq);
  assert.equal(inputs.length,1); assert.equal(inputs[0].payload.sessionId,session); assert.deepEqual(inputs[0].payload.agentPath,[]);
  assert.equal(jsonInput(inputs[0].payload.input).command,barrier.command);
  stage?.({ proofStage: 'native-call-completion' });
  assert.ok(!rows.some(r=>r.kind==='event'&&r.payload?.kind==='tool_call_ended'&&r.payload.callId===c.callId),'native calculator already completed');
  assert.ok(!raw.some(x=>x.record.seq>c.record.seq&&((x.record.body?.native?.update?.toolCallId===c.callId&&['completed','failed','cancelled'].includes(x.record.body.native.update.status))||(x.record.body?.type==='tool_execution_end'&&x.record.body.native?.toolCallId===c.callId))),'raw native calculator already completed');
  return { nativeSession:session,callId:c.callId,sdkSeq:c.record.seq,matchedSdkSeqs:candidates.map(candidate=>candidate.record.seq),nativeRowSeq:c.row.seq,commandSha256:barrier.commandSha256,inputSha256:digest(p.prompt),nativeInputId:request.record.body.inputId,...(c.input.cwd===undefined?{}:{commandCwd:c.input.cwd}) };
}
function processes() {
  return execFileSync('ps',['-ww','-axo','pid=,ppid=,lstart=,command='],{encoding:'utf8',maxBuffer:4*1024*1024}).split('\n').flatMap(line=>{
    const m=line.trim().match(/^(\d+)\s+(\d+)\s+(\w+\s+\w+\s+\d+\s+\d+:\d+:\d+\s+\d+)\s+(.+)$/);
    return m?[{pid:Number(m[1]),parent:Number(m[2]),birth:m[3]!,command:m[4]!}]:[];
  });
}
async function marker(cwd: string,name: string) {
  const filename=path.join(cwd,name);
  try {const s=await lstat(filename);assert.ok(s.isFile()&&!s.isSymbolicLink());assert.ok(s.size<=4096);return JSON.parse(await readFile(filename,'utf8'));}
  catch(e){if((e as NodeJS.ErrnoException).code==='ENOENT')return undefined;throw e;}
}
export async function proveBusy(p: any,birth: any,rows: Row[],barrier: Barrier, stage?: BusyStage) {
  stage?.({ markerPresent: null, calculatorPid: null, calculatorBirth: null, supervisorPid: null, supervisorBirth: null, calculatorLive: null, supervisorLive: null, ancestryDepth: null, ancestryReachedSupervisor: null });
  const native=nativeCommandEvidence(p,rows,barrier,stage); if(!native)return undefined;
  stage?.({ proofStage: 'worker-birth-identity' });
  assert.equal(birth.sessionKey,p.sessionKey);assert.equal(birth.generation,p.generation);assert.equal(birth.memberId,p.memberId);
  if(p.runtime==='opencode' && native.commandCwd!==undefined)
    assert.equal(native.commandCwd,birth.workDirectory,'native execute exact original CWD');
  stage?.({ proofStage: 'worker-original-cwd' });
  assert.ok(path.isAbsolute(birth.workDirectory));assert.equal(await realpath(birth.workDirectory),birth.workDirectory,'no symlink worker CWD');
  stage?.({ proofStage: 'entered-marker-read' });
  const entered=await marker(birth.workDirectory,barrier.enteredName);
  stage?.({ markerPresent: !!entered });
  if(!entered) { stage?.({ pendingReason: 'no-entered-marker' }); return undefined; }
  stage?.({ proofStage: 'entered-marker-identity', calculatorPid: Number.isSafeInteger(entered.pid) ? entered.pid : null, enteredAt: Number.isFinite(Date.parse(entered.enteredAt)) ? new Date(Date.parse(entered.enteredAt)).toISOString() : null });
  assert.equal(entered.nonce,barrier.nonce);assert.equal(entered.cwd,birth.workDirectory);assert.equal(entered.executable,process.execPath);
  assert.ok(Number.isSafeInteger(entered.pid)&&entered.pid>0);
  stage?.({ proofStage: 'release-marker-absent' });
  assert.ok(!await marker(birth.workDirectory,barrier.releaseName),'released calculator is not busy proof');
  stage?.({ proofStage: 'original-deadline' });
  assert.ok(Date.parse(entered.enteredAt)<Date.parse(barrier.deadlineAt));assert.ok(Date.now()<Date.parse(barrier.deadlineAt));
  stage?.({ proofStage: 'actual-process-table' });
  const table=processes(),node=table.find(r=>r.pid===entered.pid),root=table.find(r=>r.pid===birth.pid);
  stage?.({ proofStage: 'actual-managed-pids-live', calculatorLive: !!node, supervisorLive: !!root, supervisorPid: birth.pid, calculatorBirth: node?.birth ?? null, supervisorBirth: root?.birth ?? null });
  assert.ok(node&&root,'actual managed PID must remain live');stage?.({ proofStage: 'actual-supervisor-birth' });assert.equal(root.birth,birth.startIdentity);
  stage?.({ proofStage: 'actual-node-command' });
  assert.ok(node.command.includes(barrier.nonce)&&node.command.includes(process.execPath),'actual Node command binds nonce');
  stage?.({ proofStage: 'actual-calculator-birth' });
  assert.ok(Date.parse(node.birth)<=Date.parse(entered.enteredAt));
  stage?.({ proofStage: 'actual-ancestry' });
  const ancestry:number[]=[];let cursor: {pid:number;parent:number;birth:string;command:string}|undefined=node;
  while(cursor&&cursor.pid!==root.pid&&!ancestry.includes(cursor.pid)){ancestry.push(cursor.pid);cursor=table.find(r=>r.pid===cursor!.parent);}
  stage?.({ ancestryDepth: ancestry.length, ancestryReachedSupervisor: cursor?.pid===root.pid });
  assert.equal(cursor?.pid,root.pid,'Node must descend from original owned native supervisor');
  stage?.({ proofStage: 'entered-marker-digest' });
  return {...native,entered,enteredSha256:digest(await readFile(path.join(birth.workDirectory,barrier.enteredName),'utf8')),nodeBirth:node.birth,ancestry,ancestryBirths:table.filter(r=>ancestry.includes(r.pid)||r.pid===root.pid).map(({pid,parent,birth})=>({pid,parent,birth})),workDirectory:birth.workDirectory};
}
// Same-directory hard-link publication is atomic and cannot replace an existing
// final marker. The native reader never sees the temporary partially written JSON.
export async function publishCompleteMarker(filename: string,value: unknown,deadlineAt: string) {
  const temporary=`${filename}.${randomUUID()}.tmp`;
  await writeFile(temporary,JSON.stringify(value),{flag:'wx',mode:0o600});
  try {
    assert.ok(Date.now()<Date.parse(deadlineAt),'original marker deadline exceeded before publication');
    await link(temporary,filename);
  } finally { await unlink(temporary); }
}
export async function releaseAfterHuman(proof: NonNullable<Awaited<ReturnType<typeof proveBusy>>>,barrier: Barrier,humanCreatedAt: string) {
  assert.ok(Date.parse(proof.entered.enteredAt)<Date.parse(humanCreatedAt),'entered must precede persisted human message');
  const node=processes().find(r=>r.pid===proof.entered.pid);assert.equal(node?.birth,proof.nodeBirth,'same original live PID before release');
  if(Date.now()===Date.parse(humanCreatedAt))await new Promise(resolve=>setTimeout(resolve,1));
  const release={nonce:barrier.nonce,humanCreatedAt,releasedAt:new Date().toISOString()};
  assert.ok(Date.parse(humanCreatedAt)<Date.parse(release.releasedAt),'human persistence must precede release');
  assert.ok(Date.parse(release.releasedAt)<Date.parse(barrier.deadlineAt));
  await publishCompleteMarker(path.join(proof.workDirectory,barrier.releaseName),release,barrier.deadlineAt);
  return release;
}
export function assertBarrierOrder(proof:any,release:any,humanCreatedAt:string,rows:Row[],originalTerminal:Row) {
  assert.equal(release.nonce,proof.entered.nonce);
  const ended=rows.filter(r=>r.kind==='event'&&r.payload?.kind==='tool_call_ended'&&r.payload.callId===proof.callId);
  assert.equal(ended.length,1);assert.equal(ended[0].payload.sessionId,proof.nativeSession);
  const rawEnd=rows.find(r=>r.kind==='raw'&&r.payload?.kind==='frame'&&r.payload.seq===ended[0].payload.seq);assert.ok(rawEnd);
  assert.equal(rawEnd.payload.sessionId,proof.nativeSession);assert.deepEqual(rawEnd.payload.agentPath,[]);
  const nativeEnd=rawEnd.payload.body?.native;
  assert.ok((nativeEnd?.update?.toolCallId===proof.callId&&nativeEnd.update.status==='completed')||(rawEnd.payload.body?.type==='tool_execution_end'&&nativeEnd?.toolCallId===proof.callId));
  assert.ok(proof.sdkSeq<ended[0].payload.seq);assert.ok(proof.nativeRowSeq<ended[0].seq);
  assert.ok(Date.parse(proof.entered.enteredAt)<Date.parse(humanCreatedAt));
  assert.ok(Date.parse(humanCreatedAt)<Date.parse(release.releasedAt));
  assert.ok(Date.parse(release.releasedAt)<ended[0].payload.receivedAt);
  assert.ok(ended[0].payload.receivedAt<=Date.parse(originalTerminal.time));
  assert.ok(ended[0].seq<originalTerminal.seq);
}
