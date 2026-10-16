import assert from 'node:assert/strict';
// Yielded parents retain their final tail in the original Host journal; the PG
// observation index is not the durable journal's completion authority.
export function requireYieldedNativeTurn(identity:any,lease:any,native:any,intent:any,accepted:any,closed:any,inputId:string,rows:any[]):void {
  assert.deepEqual(intent?.parentIdentity,identity);assert.equal(accepted?.ok,true);
  assert.equal(accepted.value?.state,'yield-accepted');assert.equal(accepted.value.waitId,intent.waitId);
  assert.ok(intent.requestId&&inputId&&native?.nativeSession&&native.streamGeneration);
  for(const key of ['sessionKey','generation','memberId','controlDirectory','workDirectory']){
    assert.equal(intent.lease?.[key],lease[key]);if(key!=='memberId')assert.equal(native[key],lease[key]);
  }
  assert.equal(closed?.absent,true);assert.ok(Number.isSafeInteger(intent.lease.processGroup));
  assert.equal(closed.group,intent.lease.processGroup);assert.ok(closed.pids.includes(intent.lease.pid));
  for(const [seq,row] of rows.entries()){
    assert.equal(row.schema,'hima-oar-observation/1');assert.equal(row.seq,seq);
    for(const key of ['sessionKey','generation','memberId'])assert.equal(row[key],lease[key]);
    assert.equal(row.streamGeneration,native.streamGeneration);
  }
  const current=(row:any)=>row.nativeSession===native.nativeSession&&row.payload?.inputId===inputId;
  const receive=rows.find(row=>row.kind==='received'&&current(row));assert.ok(receive);
  const admission=rows.find(row=>row.kind==='control'&&current(row)&&row.payload.action==='yield_intent'&&row.payload.requestId===intent.requestId);assert.ok(admission);
  const terminal=rows.find(row=>row.kind==='terminal'&&current(row)&&row.payload.received===true&&row.payload.outcome?.kind==='completed'&&row.payload.yieldRequestId===intent.requestId);assert.ok(terminal);
  assert.ok(receive.seq<admission.seq&&admission.seq<terminal.seq);
  const raw=rows.filter(row=>row.kind==='raw'&&row.nativeRawSeq!==undefined);assert.ok(raw.length);
  raw.forEach((row,index)=>{assert.equal(row.nativeRawSeq,index);assert.equal(row.payload.seq,index);});
  const finals=rows.filter(row=>row.kind==='control'&&row.payload?.action==='raw_final');assert.equal(finals.length,1,'One final raw-credit receipt is required');
  const final=finals[0]!;assert.equal(final.nativeSession,native.nativeSession);
  assert.ok(final.seq>terminal.seq);assert.equal(final.payload.state,'complete');assert.equal(final.payload.lastSeq,raw.length-1);
  assert.ok(raw.every(row=>row.seq<final.seq),'All credited raw must precede the final receipt');
}
