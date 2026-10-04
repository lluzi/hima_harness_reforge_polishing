// Read-only folds of PG source facts for ordinary Remote and Guide readers. Never materializes work.
import type { FabricDeps, ExecutionContext } from './fabric.js';
import { ledgerRecord, jobIdentity, type LedgerRecord, type RunRecord } from './ledger.js';
import { createHash } from 'node:crypto';
import { taskEffectStep } from './task-effects.js';
import { isUtf8 } from 'node:buffer';
import { loadSite, pathsOf } from './sites.js';
import { SiteUnreadableError } from './errors.js';
import { readRetainedAssetBytes, type EngineeringAssetRead } from './engineering-executor.js';
import { constants } from 'node:fs';
import { open, lstat } from 'node:fs/promises';
import path from 'node:path';
import { taskResult as taskResultSchema, taskProjection, type JsonValue, type TaskIdentity, type TaskResult, type TaskProjection } from './task-contract.js';
import { factIdentity, jsonDigest } from './run-store.js';
import { durableRunView, knownDurableRun, readDurableExecutionContext, readFrozenProductMethod, type DurableExecutionContext } from './durable-fabric.js';
import type { DurableTaskView } from './record-views.js';
import { packWords, type Pack } from './packs.js';
import { runView, runHeadView, type RunView } from './remote.js';
const object = (value: unknown): Record<string, unknown> => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string,unknown> : {};
const deliveryName=(type:'experience'|'archive'|'refusal',data:Record<string,unknown>,revision=0)=>`delivery:${revision?`revision:${revision}:`:''}${type==='archive'?`archive:${data.delivery}`:type}${data.delivery==='failed'||type==='refusal'?`:${jsonDigest(data as JsonValue)}`:''}`;
const deliveryIdentity=(name:string)=>{const parsed=/^delivery:(?:revision:(\d+):)?(experience|archive|refusal)(?::|$)/.exec(name);return parsed?{revision:Number(parsed[1]??0),type:parsed[2]!}:undefined;};

/** Exact native source bytes; caller first resolves the authenticated PG record of this Run. */
export async function readDurableSourceBytes(rootDirectory:string,runId:string,record:{runId:string;bytes:number;retainedPath?:string}&({type:'observation';contentSha256:string}|{type:'code'|'knowledge';sha256:string}),maxBytes?:number):Promise<Buffer> {
  const sha=record.type==='observation'?record.contentSha256:record.sha256;
  if(record.runId!==runId||!record.retainedPath||!/^[a-f0-9]{64}$/.test(sha)||!Number.isSafeInteger(record.bytes)||record.bytes<0)throw new Error('Original retained material identity is invalid');
  if(maxBytes!==undefined&&record.bytes>maxBytes)throw new Error('Original retained material exceeds this bounded view');
  const root=path.resolve(rootDirectory),at=path.resolve(record.retainedPath);
  if(!at.startsWith(root+path.sep)||(at!==path.join(root,runId,sha)&&at!==path.join(root,sha)))throw new Error('Material path differs from its trusted Run and content identity');
  for(const directory of new Set([root,path.dirname(at)])){const stat=await lstat(directory);if(!stat.isDirectory()||stat.isSymbolicLink())throw new Error('Retained material ancestor is not a plain directory');}
  const file=await open(at,constants.O_RDONLY|constants.O_NOFOLLOW);
  try {
    const stat=await file.stat();if(!stat.isFile()||stat.size!==record.bytes)throw new Error('Original retained size changed');
    const buffer=Buffer.alloc(record.bytes+1);let length=0;
    while(length<buffer.length){const part=await file.read(buffer,length,buffer.length-length,null);length+=part.bytesRead;if(!part.bytesRead)break;}
    if(length!==record.bytes||(await file.stat()).size!==record.bytes)throw new Error('Original retained size changed during read');
    const bytes=buffer.subarray(0,length),found=createHash('sha256').update(bytes).digest('hex');
    if(found!==sha)throw Object.assign(new Error('Original retained material hash changed'),{found});return bytes;
  } finally {await file.close();}
}

export function createDurableViewReaders(deps: FabricDeps, options: {readonly retainedMaterialsDir?:string} = {}) {
  async function readRun(runId: string): Promise<RunRecord | undefined> {
    const original=await knownDurableRun(deps,runId);
    if(!original)return deps.ledger.run(runId);
    const store=deps.durable!.store,prepared=await store.flowFact(runId,'preparation') as unknown as import('./workspace.js').WorkspaceFilesResult|null, outcome=await store.flowFact(runId,`outcome:${original.revision}`);
    return original.cancelled ? (await readDurableExecutionContext(deps,runId)).run : durableRunView(original,prepared,outcome);
  }
  async function readRunRecords(runId: string, type?: LedgerRecord['type']): Promise<readonly LedgerRecord[]> {
    const original = await knownDurableRun(deps,runId);
    if (!original) return deps.ledger.records(type ? {runId,type} : {runId});
    const store=deps.durable!.store, projection=await store.flowProjection(runId), records=new Map<string,LedgerRecord>();
    for (const row of projection.tasks) {
      const task=row as unknown as {identity:TaskIdentity;result:TaskResult|null};
      if(task.result) {
        const source=await store.fact(factIdentity('task-result',task.identity.effectId));
        if(!source || source.runId!==runId || source.kind!=='task-result') throw new Error('Task result source fact is unavailable');
        for(const name of ['observations','verdicts']) for(const value of Array.isArray(object(task.result.value)[name]) ? object(task.result.value)[name] as unknown[] : []) {
          const record=object(value);
          if(!['observation','verdict'].includes(String(record.type)))continue;
          if(record.runId!==runId || typeof record.id!=='string') throw new Error('Task record differs from its original source');
          const sourceId=record.id.match(/^hima-fact:[a-f0-9]{64}(?=:|$)/)?.[0];
          const actual=sourceId?await store.fact(sourceId):undefined;
          if(!actual || actual.runId!==runId || actual.kind!=='task-result')throw new Error('Record original task source is unavailable');
          const originals=object(object(actual.payload).value)[name];
          let candidateDigest:string|undefined;
          if(!Array.isArray(originals)||!originals.some(item=>{const originalDigest=jsonDigest(item);candidateDigest??=jsonDigest(value as JsonValue);return originalDigest===candidateDigest;}))throw new Error('Record differs from its original task source');
          const {outputName:_output,...fields}=record;
          records.set(record.id,ledgerRecord.parse({...fields,seq:actual.seq,at:actual.at}));
        }
      }
      const effect=await store.effect(task.identity.effectId);
      if(!effect){if(task.result)throw new Error('Committed task result has no original effect');continue;}
      if(jsonDigest(effect.identity)!==jsonDigest(task.identity))throw new Error('Native effect differs from its recorded invocation identity');
      for(const held of (await Promise.all(['code:','knowledge:','refusal:','session:'].map(prefix=>store.orderedExternalEffectFacts(task.identity,prefix)))).flat()) {
        const kind=held.phase.split(':')[0];
        if(!['code','knowledge','refusal','session'].includes(kind!)) continue;
        const id=factIdentity('effect-fact',task.identity.effectId,`native:${held.phase}`), source=await store.fact(id);
        if(!source || source.runId!==runId) throw new Error('Native record source fact is unavailable');
        const {toolCallId:_call,...fields}=object(held.fact);
        records.set(id,ledgerRecord.parse({...fields,id,runId,siteId:(original.opening.data as unknown as {run:RunRecord}).run.siteId,type:kind,seq:source.seq,at:source.at,writer:kind==='refusal'?'shell':'executor'}));
      }
    }
    if(!type||type==='job')for(const effect of (await store.flowPhysicalFacts(runId)).effects) {
      const submitted=jobIdentity.safeParse(await store.effectFact(effect.identity.effectId,'submitted'));
      if(!submitted.success)continue; // Native envelopes are not batch Job completion receipts.
      for(const [phase,event,exitCode] of [['submitted','launched',undefined],['executor-ready','finished',0],['executor-failure','finished',undefined]] as const) {
        const value=await store.effectFact(effect.identity.effectId,phase);if(!value)continue;
        const job=jobIdentity.safeParse(phase==='executor-failure'?object(value).receipt:value);
        if(!job.success||job.data.session!==submitted.data.session)continue;
        const id=factIdentity('effect-fact',effect.identity.effectId,phase),source=await store.fact(id);
        if(!source||source.runId!==runId)throw new Error('Batch Job receipt source is unavailable');
        records.set(id,ledgerRecord.parse({id,runId,siteId:(original.opening.data as unknown as {run:RunRecord}).run.siteId,
          seq:source.seq,at:source.at,writer:'executor',type:'job',event,job:job.data,nodeId:effect.identity.taskId,
          ...(exitCode===undefined?{}:{exitCode}),...(event==='launched'?{licences:(await store.effectResources(effect.identity.effectId))[0]?.claim.licences??{}}:{})}));
      }
    }
    const prepared=await store.flowFact(runId,'preparation') as unknown as import('./workspace.js').WorkspaceFilesResult|null;
    if(prepared&&(prepared.kind==='prepared'||prepared.kind==='reused')) {
      const source=await store.fact(factIdentity('flow-fact',runId,'preparation'));
      if(source) records.set(source.factId,ledgerRecord.parse({...prepared.file,campaignId:prepared.file.campaign,packId:prepared.file.pack.id,packVersion:prepared.file.pack.version,...(prepared.file.pack.digest?{packDigest:prepared.file.pack.digest}:{}),id:source.factId,runId,siteId:(original.opening.data as unknown as {run:RunRecord}).run.siteId,type:'workspace',event:prepared.kind,seq:source.seq,at:source.at,writer:'executor'}));
    }
    for(const {name,value,source} of await store.orderedFlowFacts(runId,'delivery:')) {
      const type=deliveryIdentity(name)?.type;if(!type)continue;
      if(source.runId!==runId||jsonDigest(object(source.payload).value as JsonValue)!==jsonDigest(value))throw new Error('Delivery original source differs from its stored value');
      records.set(source.factId,ledgerRecord.parse({...object(value),id:source.factId,runId,siteId:(original.opening.data as unknown as {run:RunRecord}).run.siteId,type,seq:source.seq,at:source.at,writer:type==='refusal'?'shell':'executor'}));
    }
    return [...records.values()].filter(record=>!type||record.type===type).sort((a,b)=>a.seq-b.seq);
  }
  async function revisionRecords(runId:string,records:readonly LedgerRecord[],revision:number) {
    const outside=new Set((await deps.durable!.store.orderedFlowFacts(runId,'delivery:')).filter(fact=>{const identity=deliveryIdentity(fact.name);return identity&&identity.revision!==revision;}).map(fact=>fact.source.factId));
    return records.filter(record=>!outside.has(record.id));
  }
  async function readRunRecord(recordId: string): Promise<LedgerRecord|undefined> {
    const factId=recordId.match(/^hima-fact:[a-f0-9]{64}(?=:|$)/)?.[0]??recordId;
    const fact=await deps.durable?.store.fact(factId);
    if(fact) return (await readRunRecords(fact.runId)).find(record=>record.id===recordId);
    const legacy=deps.ledger.record(recordId);
    // A durable Run cannot silently read a stale history projection as current authority.
    return legacy && !await knownDurableRun(deps,legacy.runId) ? legacy : undefined;
  }
  async function taskViews(context:DurableExecutionContext,pack:Pack):Promise<DurableTaskView[]> {
    const runtime=deps.durable!;
    const invocations=await runtime.store.flowInvocations(context.run.id);
    const byEffect=new Map<string,typeof invocations[number]>();
    for(const invocation of invocations)if(!byEffect.has(invocation.identity.effectId))byEffect.set(invocation.identity.effectId,invocation);
    const tasks=context.durable.tasks as unknown as {identity:TaskIdentity;state:{state:string;reason?:unknown;diagnostic?:unknown};result:TaskResult|null;valid:boolean}[];
    const views:DurableTaskView[]=await Promise.all(tasks.map(async task=>{
      const invocation=byEffect.get(task.identity.effectId), data=object(invocation?.context);
      const definition=(object(data.flow).tasks as Record<string,{contract?:DurableTaskView['contract'];tool?:string}>|undefined)?.[task.identity.taskId];
      const state=task.state.state==='unknown'?'waiting':task.state.state;
      const projection:TaskProjection=taskProjection.parse(state==='waiting'||state==='failed'
        ? {state,reason:task.state.diagnostic??(typeof task.state.reason==='object'&&task.state.reason!==null?task.state.reason:
          {code:task.state.state==='unknown'?'effect-unknown':`task-${state}`,message:typeof task.state.reason==='string'?task.state.reason:'Original task needs attention',source:task.identity.effectId})}
        : {state});
      const held=task.result?undefined:await runtime.store.effectFact(task.identity.effectId,'validated-result');
      const retained=held===undefined?undefined:taskResultSchema.parse(held);
      if(retained&&jsonDigest(retained.identity)!==jsonDigest(task.identity))throw new Error('Retained delivery differs from its original task identity');
      const retainedSource=retained?factIdentity('effect-fact',task.identity.effectId,'validated-result'):undefined;
      if(retainedSource){const source=await runtime.store.fact(retainedSource);if(!source||source.runId!==context.run.id||source.kind!=='effect-fact'||jsonDigest(object(source.payload).fact)!==jsonDigest(retained))throw new Error('Retained verified delivery source is unavailable');}
      return {taskId:task.identity.taskId,identity:task.identity,projection,current:task.valid,rootFlow:object(data.flow).irSha256===pack.flow?.irSha256,iterations:(data.iterations??[]) as {repeatId:string;iteration:number}[],...(retained?{retainedResult:retained}:{}),...(definition?.tool?{tool:definition.tool}:{}),sourceFactIds:task.result?[factIdentity('task-result',task.identity.effectId)]:retainedSource?[retainedSource]:[],...(definition?.contract?{contract:definition.contract}:{}),...(data.input===undefined?{}:{input:data.input as JsonValue}),...(task.result?{result:task.result}:{})};
    }));
    for(const [taskId,definition] of Object.entries(pack.flow?.tasks??{})) if(!views.some(task=>task.taskId===taskId))views.push({taskId,projection:{state:'pending'},tool:definition.tool,contract:definition.contract,sourceFactIds:[]});
    return views;
  }
  async function readRunView(runId: string): Promise<RunView|undefined> {
    const original=await knownDurableRun(deps,runId);if(!original)return undefined;
    const runtime=deps.durable!, sourceRevision=await runtime.store.sourceRevision(runId), context=await readDurableExecutionContext(deps,runId),pack=await readFrozenProductMethod(runtime,original);
    const records=await revisionRecords(runId,await readRunRecords(runId),original.revision), base=runView({records:()=>[...records]},context.run,packWords(pack));
    const views=await taskViews(context,pack);
    return {...base,run:{...runHeadView(context.run,pack.contract.version,packWords(pack)),engine:original.engine,goalState:context.run.goalState,...(context.run.stopState?{stopState:context.run.stopState}:{}),sourceRevision,historyPendingFacts:await runtime.store.pendingFactCount(runId),deadlineAt:original.deadlineAt},tasks:views,sources:[factIdentity('run-opened',runId),...records.map(record=>record.id)],
      ...(context.durable.preparation&&(context.durable.preparation.kind==='prepared'||context.durable.preparation.kind==='reused')?{workspace:{flowRoot:context.durable.preparation.file.flowRoot,containerName:context.durable.preparation.file.containerName,bindings:(original.opening.data as unknown as {product:{bindings:Record<string,string>}}).product.bindings}}:{})};
  }
  async function assignedGuide(viewerSessionId:string,parentSessionId:string,childSessionId?:string):Promise<boolean> {
    for(const run of await deps.durable?.store.runs()??[]) {
      const opening=run.opening.data as unknown as {run:RunRecord};
      if(run.owner!==parentSessionId || opening.run.control?.guideSessionId!==viewerSessionId)continue;
      if(childSessionId===undefined)return true;
      for(const invocation of await deps.durable!.store.flowInvocations(run.runId)) {
        const effect=await deps.durable!.store.effect(invocation.identity.effectId);if(!effect)continue;
        if(jsonDigest(effect.identity)!==jsonDigest(invocation.identity))throw new Error('Native delegation effect differs from its invocation identity');
        for(const held of await deps.durable!.store.orderedExternalEffectFacts(invocation.identity,'child:')) {
          const value=object(held.fact),effective=object(value.effective);
          if(held.phase.endsWith(':intent') && effective.childSessionId===childSessionId && object(value.contract).parentSessionId===parentSessionId)return true;
        }
      }
    }
    return deps.ledger.runs().some(run=>run.control?.owner===parentSessionId && run.control.guideSessionId===viewerSessionId && (childSessionId===undefined || deps.ledger.records({runId:run.id,type:'delegation'}).some(record=>record.type==='delegation' && record.parentSessionId===parentSessionId && record.childSessionId===childSessionId && ['create-intent','created','result-observed'].includes(record.event))));
  }
  async function sourceDeps(runId:string,revision?:number) {
    if(!await knownDurableRun(deps,runId))return deps;
    const run=await readRun(runId),selected=revision??(await deps.durable!.store.run(runId)).revision,records=await revisionRecords(runId,await readRunRecords(runId),selected);
    if(!run)throw new Error('The requested Run is unavailable');
    const ledger={run:(id:string)=>id===runId?run:undefined,records:(query:{runId?:string;type?:LedgerRecord['type']}={})=>records.filter(record=>(!query.runId||record.runId===query.runId)&&(!query.type||record.type===query.type)),record:(id:string)=>records.find(record=>record.id===id)};
    return {...deps,ledger:ledger as unknown as FabricDeps['ledger'],deliveryRevision:selected,sourceView:async()=>{const view=await readRunView(runId);if(!view)throw new Error('Source Run view unavailable');return view;}};
  }
  async function finalizeDelivery(runId:string,revision?:number,attempt=0) {
    // Record a readonly PG snapshot before any conditional publication. All methods in this
    // snapshot use raw source reads; no datasource transaction is nested in a DBOS Step.
    const invocations=await deps.durable!.store.flowInvocations(runId);
    const snapshot=await taskEffectStep('hima.delivery.source',async()=>{
      const runtime=deps.durable!;
      const store=new Proxy(runtime.store,{get(target,key){
        if(key==='flowInvocations')return async()=>invocations;
        if(key==='flowFact')return async(id:string,name:string)=>{const fact=await target.fact(factIdentity('flow-fact',id,name));return fact?object(fact.payload).value as JsonValue:null;};
        const value=Reflect.get(target,key);return typeof value==='function'?value.bind(target):value;
      }});
      const readers=createDurableViewReaders({...deps,durable:{...runtime,store}});
      const original=await store.run(runId),run=await readers.readRun(runId),view=await readers.readRunView(runId),records=await revisionRecords(runId,await readers.readRunRecords(runId),original.revision);
      if(!run||!view)throw new Error('Delivery requires its original PG Run');
      const terminal=await store.fact(factIdentity('flow-fact',runId,`outcome:${original.revision}`));if(!terminal)throw new Error('Delivery has no immutable terminal outcome timestamp');
      return {run,view,records,writtenAt:terminal.at,product:(original.opening.data as unknown as {product:{workspace:string;siteId:string}}).product};
    });
    const writeRevision=revision??snapshot.run.control?.revision??0;
    if(!await deps.durable!.store.admitDeliveryWrite(runId,writeRevision,attempt))return {complete:false,diagnostic:'The App is closing; archive file writes will resume from the original Run after restart'};
    const published=await taskEffectStep('hima.delivery.files',async()=>{
      const {writeExperience,readRunAssets}=await import('./experience.js');
      const records=[...snapshot.records],added:LedgerRecord[]=[];
      const append=(type:'experience'|'archive'|'refusal',data:Record<string,unknown>)=>{
        const name=deliveryName(type,data,writeRevision),id=factIdentity('flow-fact',runId,name);
        const record=ledgerRecord.parse({...data,id,runId,siteId:snapshot.run.siteId,type,seq:(records.at(-1)?.seq??0)+1,at:snapshot.run.createdAt,writer:type==='refusal'?'shell':'executor'});
        if(!records.some(held=>held.id===id)){records.push(record);added.push(record);}return Promise.resolve(record);
      };
      const ledger={run:(id:string)=>id===runId?snapshot.run:undefined,records:(query:{runId?:string;type?:LedgerRecord['type']}={})=>records.filter(record=>(!query.runId||record.runId===query.runId)&&(!query.type||record.type===query.type)),record:(id:string)=>records.find(record=>record.id===id),
        appendExperience:(_id:string,data:Record<string,unknown>)=>append('experience',data),appendArchive:(_id:string,data:Record<string,unknown>)=>append('archive',data),appendRefusal:(_id:string,data:Record<string,unknown>)=>append('refusal',data)};
      const source={...deps,ledger:ledger as unknown as FabricDeps['ledger'],deliveryRevision:writeRevision,deliveryWrittenAt:snapshot.writtenAt,sourceView:async()=>snapshot.view,
        ...(options.retainedMaterialsDir?{sourceMaterialBytes:(record:import('./ledger.js').CodeRecord|import('./ledger.js').KnowledgeRecord|import('./ledger.js').ObservationRecord)=>readDurableSourceBytes(options.retainedMaterialsDir!,runId,record)}:{}),
        taskAssets:async()=>{const assets=[];const site=loadSite(deps.sitesDir,snapshot.product.siteId),p=pathsOf(site);
          for(const task of snapshot.view.tasks??[])if(task.current!==false)for(const artifact of task.result?.artifacts??[]) {
            const bytes=await readRetainedAssetBytes(site,p.join(snapshot.product.workspace,artifact.path),snapshot.product.workspace,artifact.sha256);
            assets.push({path:`materials/task-${jsonDigest([artifact.effectId,artifact.name])}.dat`,source:`task-artifact:${artifact.effectId}:${artifact.name}`,recordId:factIdentity('task-result',artifact.effectId),bytes});
          }return assets;}};
      try {
        await deps.durable!.store.assertDeliveryWrite(runId,writeRevision,attempt);
        await writeExperience(source,runId);const archive=await readRunAssets(source,runId);
        const failure=records.findLast(record=>record.type==='archive'&&record.delivery==='failed');
        return {records:added,delivery:archive.kind==='read'?{complete:true}:{complete:false,diagnostic:failure?.type==='archive'?failure.reason:'why' in archive?archive.why:`Archive ${archive.kind}`}};
      } catch(error) {return {records:added,delivery:{complete:false,diagnostic:(error as Error).message}};}
    });
    await deps.durable!.store.putFlowFact(runId,`delivery-io:closed:${writeRevision}:${attempt}`,{revision:writeRevision,attempt,closed:true});
    // The IO receipt precedes these datasource commits. Replay always repeats this same sequence,
    // including a crash after rename but before the complete claim, without re-running a Task.
    try {for(const record of published.records) {
      const {id:_id,runId:_run,siteId:_site,seq:_seq,at:_at,writer:_writer,type,...data}=record;
      await deps.durable!.store.putFlowFact(runId,deliveryName(type as 'experience'|'archive'|'refusal',data,writeRevision),data as JsonValue);
    }} catch(error) {
      const failure={delivery:'failed',directory:published.records.find(record=>record.type==='archive')?.type==='archive'?(published.records.find(record=>record.type==='archive') as import('./ledger.js').ArchiveRecord).directory:deps.packsDir,materials:[],reason:`published archive completion could not be recorded: ${(error as Error).message}`};
      await deps.durable!.store.putFlowFact(runId,deliveryName('archive',failure,writeRevision),failure);
      return {complete:false,diagnostic:failure.reason};
    }
    return published.delivery;
  }
  async function readRunAssets(runId:string,revision?:number) {const {readRunAssets}=await import('./experience.js');return readRunAssets(await sourceDeps(runId,revision),runId);}
  async function readArchivedMaterial(runId:string,relative:string,revision?:number) {const {readArchivedMaterial}=await import('./experience.js');return readArchivedMaterial(await sourceDeps(runId,revision),runId,relative);}
  async function retainedReport(runId:string,record:LedgerRecord) {
    if(!options.retainedMaterialsDir || !('retainedPath' in record) || !record.retainedPath || !('bytes' in record))return {kind:'unavailable' as const,why:'Original retained material is unavailable'};
    const sha=record.type==='observation'?record.contentSha256:'sha256' in record?String(record.sha256):'';
    if(!/^[a-f0-9]{64}$/.test(sha)||record.bytes>2*1024*1024)return {kind:'unavailable' as const,why:'Original report exceeds this bounded view'};
    try {const bytes=await readDurableSourceBytes(options.retainedMaterialsDir,runId,record as import('./ledger.js').CodeRecord|import('./ledger.js').KnowledgeRecord|import('./ledger.js').ObservationRecord,2*1024*1024);return {kind:'read' as const,text:bytes.toString('utf8')};}
    catch(error){return error instanceof Error&&'found' in error&&typeof error.found==='string'?{kind:'changed' as const,path:record.retainedPath,recorded:sha,found:error.found}:{kind:'unavailable' as const,why:String(error)};}
  }
  async function readMaterial(runId:string,recordId:string):Promise<import('./experience.js').ReadMaterialResult> {
    if(!await knownDurableRun(deps,runId)){const {readMaterial}=await import('./experience.js');return readMaterial(deps,runId,recordId);}
    const record=(await readRunRecords(runId)).find(record=>record.id===recordId);
    if(record?.type!=='code'&&record?.type!=='knowledge')return {kind:'none',why:'No original code or knowledge source belongs to this Run'};
    const held=await retainedReport(runId,record);
    if(held.kind==='read')return {...held,record};
    for(const fact of [...await deps.durable!.store.orderedFlowFacts(runId,'delivery:')].reverse()) {
      const identity=deliveryIdentity(fact.name);if(identity?.type!=='archive'||object(fact.value).delivery!=='complete')continue;
      const archive=await readRunAssets(runId,identity.revision);if(archive.kind!=='read')continue;
      const material=archive.manifest.materials.find(item=>item.recordId===record.id&&item.sha256===record.sha256&&item.bytes===record.bytes);
      if(!material)continue;const saved=await readArchivedMaterial(runId,material.path,identity.revision);if(saved.kind==='read')return {kind:'read',record,text:saved.text};
    }
    return held.kind==='changed'?held:{kind:'unreadable',path:record.retainedPath??record.path,recorded:record.sha256,why:held.why};
  }
  async function readReportMaterial(runId:string,recordId:string):Promise<{kind:'read';text:string}|{kind:'unavailable';why:string}> {
    if(!await knownDurableRun(deps,runId)){const {readReportMaterial}=await import('./experience.js');return readReportMaterial(deps,runId,recordId);}
    const record=(await readRunRecords(runId)).find(record=>record.id===recordId);
    if(!record)return {kind:'unavailable',why:'Original report source is unavailable'};
    const held=await retainedReport(runId,record);return held.kind==='changed'?{kind:'unavailable',why:'Original report hash changed'}:held;
  }
  /** Resolve a named artifact from a verified retained/committed result of this Run; paths are not caller input. */
  async function readTaskArtifact(runId:string,effectId:string,name:string):Promise<EngineeringAssetRead> {
    const original=await knownDurableRun(deps,runId);if(!original)throw new Error('Task artifact requires its original durable Run');
    const committed=await deps.durable!.store.result(effectId),held=committed?undefined:await deps.durable!.store.effectFact(effectId,'validated-result');
    const result=committed??(held===undefined?undefined:taskResultSchema.parse(held));
    if(!result||result.identity.runId!==runId||result.identity.effectId!==effectId)throw new Error('No verified task result belongs to this Run/effect');
    const artifact=result.artifacts.find(item=>item.name===name);
    if(!artifact||artifact.runId!==runId||artifact.effectId!==effectId||artifact.taskId!==result.identity.taskId)throw new Error('No original named task artifact belongs to this result');
    const product=(original.opening.data as unknown as {product:{siteId:string;siteDigest:string;workspace:string}}).product;
    const site=loadSite(deps.sitesDir,product.siteId);
    // Reading verified retained bytes uses today's Site Permit and the original content hash.
    // Unrelated capacity/configuration updates do not invalidate an already delivered artifact.
    const p=pathsOf(site),at=p.join(product.workspace,artifact.path);
    let bytes:Buffer;
    try {bytes=await readRetainedAssetBytes(site,at,product.workspace,artifact.sha256);}
    catch(error) {
      const {channelFor}=await import('./channel.js');const channel=channelFor(site);
      let exists:boolean|undefined;
      try {exists=(await channel.exec(['test','-e',at])).code===0||(await channel.exec(['test','-L',at])).code===0;}
      catch(probeError) {
        // A transport failure cannot establish presence or damage. The archive below must
        // still prove this original Run/effect/content identity before serving any bytes.
        if(!(probeError instanceof SiteUnreadableError))throw probeError;
      }
      const row=(await deps.durable!.store.flowProjection(runId)).tasks.find(task=>object(object(task).identity).effectId===effectId);
      if(exists&&object(row).valid!==false)throw error;
      const {readArchivedTaskBytes}=await import('./experience.js');let found:Buffer|undefined;
      for(const fact of [...await deps.durable!.store.orderedFlowFacts(runId,'delivery:')].reverse()) {
        const identity=deliveryIdentity(fact.name);if(identity?.type!=='archive'||object(fact.value).delivery!=='complete')continue;
        try {found=await readArchivedTaskBytes(await sourceDeps(runId,identity.revision),runId,effectId,name,artifact.sha256);break;}catch{/* Another revision may hold the original effect; no unverifiable bytes are served. */}
      }
      if(!found)throw error;bytes=found;
    }
    const text=isUtf8(bytes)&&!bytes.includes(0)?bytes.toString('utf8',0,1024*1024):undefined;
    return {kind:'file',ref:{id:artifact.name,path:artifact.path,kind:'file',sha256:artifact.sha256,bytes:bytes.length},bytes,
      ...(text===undefined?{}:{text}),truncated:text!==undefined&&bytes.length>1024*1024,references:[]};
  }
  async function readExperience(runId:string,selection?:number|string) {
    let revision=typeof selection==='number'?selection:undefined;
    if(typeof selection==='string'&&await knownDurableRun(deps,runId)) {
      const source=await deps.durable!.store.fact(selection),identity=source?deliveryIdentity(String(object(source.payload).name)):undefined;
      if(!source||source.runId!==runId||identity?.type!=='experience')return {kind:'none' as const,why:'No original report record belongs to this Run'};
      revision=identity.revision;
    }
    if(revision!==undefined&&revision>0&&!await knownDurableRun(deps,runId))return {kind:'none' as const,why:'Historical Run has no DBOS report revision'};
    const {readExperience}=await import('./experience.js');return readExperience(await sourceDeps(runId,revision),runId);
  }
  async function listRunHeads() {
    return Promise.all((await deps.durable?.store.runs()??[]).map(async run=>{
      const store=deps.durable!.store, sourceRevision=await store.sourceRevision(run.runId), prepared=await store.flowFact(run.runId,'preparation') as unknown as import('./workspace.js').WorkspaceFilesResult|null, outcome=await store.flowFact(run.runId,`outcome:${run.revision}`);
      const current=run.cancelled?(await readDurableExecutionContext(deps,run.runId)).run:durableRunView(run,prepared,outcome),pack=await readFrozenProductMethod(deps.durable!,run);
      return {...runHeadView(current,pack.contract.version,packWords(pack)),engine:run.engine,goalState:current.goalState,...(current.stopState?{stopState:current.stopState}:{}),sourceRevision,historyPendingFacts:await store.pendingFactCount(run.runId),deadlineAt:run.deadlineAt};
    }));
  }
  /** API/model context carries the same current facts, without internal workflow polling history. */
  async function executionContext(runId:string):Promise<ExecutionContext & {readonly tasks?:readonly DurableTaskView[];readonly sources?:readonly string[]}> {
    if(!await knownDurableRun(deps,runId)){const {executionContext}=await import('./fabric.js');return executionContext(deps,runId);}
    const sourceRevision=await deps.durable!.store.sourceRevision(runId);
    const actual=await readDurableExecutionContext(deps,runId),pack=await readFrozenProductMethod(deps.durable!,actual.durable.run),tasks=await taskViews(actual,pack);
    const {durable:_internal,...context}=actual;return {...context,run:{...context.run,nextSeq:sourceRevision+1},tasks,sources:[factIdentity('run-opened',runId),...tasks.flatMap(task=>task.sourceFactIds)]};
  }
  return {readRun,readRunView,listRunHeads,readRunRecord,readRunRecords,executionContext,assignedGuide,readMaterial,readReportMaterial,readExperience,readTaskArtifact,readRunAssets,readArchivedMaterial,finalizeDelivery};
}
