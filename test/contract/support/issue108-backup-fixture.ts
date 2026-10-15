/** Small independent byte fixtures, not a claim of a runnable PG/distribution. */
import { createHash } from 'node:crypto';
import { lstat, mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
export const hash108 = (bytes: string | Uint8Array): string => createHash('sha256').update(bytes).digest('hex');
export async function archive108(root: string, version: 1 | 2, neverStarted=false) {
  const source = path.join(root, 'original'), backup = path.join(root, 'archive');
  const payload = path.join(backup, 'payload/0');
  const requestId = 'maintenance-108', cutId = 'cut-108', generation = 'generation-108';
  const host = { pid: 2147483646, processIdentity: 'closed-test-host' };
  const exported = { schema: 'hima-team-service-receipt/1', receiptId: 'export-108', serviceId: 'hindsight', generation,
    operation: 'export', state: 'running', recordedAt: '2026-10-14T10:01:00.000Z', owned: { quiescent: false },
    export: { cutId, file: path.join(source, 'hima/team-service-exports', generation, 'data.zip'), sha256: hash108('real service bytes'), bytes: 18 } };
  const stopped = { schema: 'hima-team-service-receipt/1', receiptId: 'stop-108', serviceId: 'hindsight', generation,
    operation: 'stop', state: 'stopped', recordedAt: '2026-10-14T10:02:00.000Z', owned: { quiescent: true } };
  const inactive={schema:'hima-team-service-receipt/1',receiptId:'not-started-108',serviceId:'hindsight',generation,
    operation:'status',state:'unavailable',recordedAt:'2026-10-14T10:01:00.000Z',owned:{quiescent:true},diagnostic:{code:'not-started',message:'No owned generation started'}};
  const stable=(value:any):string=>Array.isArray(value)?`[${value.map(stable).join(',')}]`:value&&typeof value==='object'?`{${Object.keys(value).sort().map(key=>`${JSON.stringify(key)}:${stable(value[key])}`).join(',')}}`:JSON.stringify(value);
  const row = (receipt: object, seq: number) => ({ seq, receipt_id: (receipt as {receiptId:string}).receiptId, service_id: 'hindsight', generation:(receipt as {generation:string}).generation, digest: hash108(stable(receipt)), receipt });
  const cut = { format: 'hima-cold-cut/1', identity: 'cluster-108', cutId, host,
    boundary: { requestId, mode: 'drain', ready: true, agents: [], runs: [{ runId: 'team-task', state: 'ready', jobs: [] }] },
    startedAt: '2026-10-14T10:00:00.000Z', completedAt: '2026-10-14T10:03:00.000Z',
    ...(!neverStarted?{serviceReadFence: { database: 'hima_hindsight', tables: ['banks', 'memory_units'], kind: 'share-locks-through-stop' }}:{}),
    services: neverStarted?[inactive]:[exported, stopped] };
  const authority = { format: 'hima-cold-authority/1', identity: 'cluster-108', controlSha256: hash108('stopped control'),
    closedAt: '2026-10-14T10:04:00.000Z', host, postmaster: { pid: 2147483645 },
    application: { host_exit: [{singleton: true, active_request: requestId, finalizing: true}],
      host_exit_requests: [{request_id: requestId, mode: 'drain', released_at: null, accepted_at: '2026-10-14T09:59:00.000Z'}],
      team_service_receipts: neverStarted?[row(inactive,1)]:[row(exported, 1), row(stopped, 2)],
      teams: [{ team_id: 'team-108', version: 2 }], team_versions: [{ version: 2, definition: {name: 'retained team'} }],
      team_members:[],team_tasks:[],task_actor_grants:[],team_message_deliveries:[],team_material_links:[],team_delegations:[],team_waits:[],
      team_effect_continuations:[],team_human_requests:[],team_continuation_requests:[],team_pack_delegations:[],team_definition_handoffs:[],
      results:[],commands:[],flow_facts:[],flow_invocations:[],flow_branch_controls:[],
      team_attachments: [{ staged: {path: path.join(source, 'hima/materials/revision.txt')} }],
      team_messages: [{ message_id: 'message-108', envelope: {text: 'human correction', materialIds: ['revision']} }],
      team_delivery_attempts: [{ state: 'stopped' }], team_memory_events: [{event: {action:'disable', revision:2}}],
      team_memory_records: [{record: {content: 'old claim', adopted:false}}], team_memory_index_operations: [],
      effects: [], effect_leases: [] }, system: { workflow_status: [] } };
  const manifest = {format: `hima-cold-backup/${version}`, sourceHome: source, identity: authority.identity,
    platform: `${process.platform}-${process.arch}`, postgresVersion: '16.15', runtimeDigest: 'a'.repeat(64),
    applicationVersion: `hima-${'b'.repeat(64)}`, retainedMaterialsDir: path.join(source,'hima/run-assets'),
    roots: [] as any[], authority, distributionDigest: 'c'.repeat(64), ...(version===2?{maintenanceCut:cut}:{})};
  await mkdir(payload,{recursive:true,mode:0o700});
  const files: Record<string,string> = {'hima/database/data/PG_VERSION':'16\n', 'hima/database/data/global/pg_control':'stopped control',
    'hima/database/credentials.json': JSON.stringify({identity:authority.identity}),
    'hima/database/backup-authority.json': JSON.stringify(authority), 'sessions/native.json': JSON.stringify({id:'native-session',context:'retained context'}),
    'hima/materials/revision.txt':'actual revision bytes', 'hima/run-assets/frozen.json':'{"program":"frozen"}',
    ...(version===2?{'hima/database/maintenance-cut.json':JSON.stringify(cut),
      ...(!neverStarted?{[`hima/team-service-exports/${generation}/data.zip`]:'real service bytes'}:{})}:{})};
  for(const [file,bytes] of Object.entries(files)){await mkdir(path.dirname(path.join(payload,file)),{recursive:true,mode:0o700});await writeFile(path.join(payload,file),bytes,{mode:0o600});}
  const distribution = path.join(backup,'payload/1');await mkdir(distribution,{mode:0o700});await writeFile(path.join(distribution,'app'),'frozen executable',{mode:0o600});
  async function entries(at:string,relative=''):Promise<Record<string,object>> {
    const info=await lstat(path.join(at,relative)),record:Record<string,object>={};
    record[relative]=info.isDirectory()?{kind:'directory',mode:info.mode&0o777}:{kind:'file',mode:info.mode&0o777,sha256:hash108(await readFile(path.join(at,relative)))};
    if(info.isDirectory())for(const child of (await readdir(path.join(at,relative))).sort())Object.assign(record,await entries(at,relative?`${relative}/${child}`:child));
    return record;
  }
  async function publish() {
    // Re-sign changed fixture observations independently, so cut/generation negatives are
    // not accidentally testing only a generic receipt-hash mismatch.
    authority.application.team_service_receipts=neverStarted?[row(inactive,1)]:[row(exported,1),row(stopped,2)];
    await writeFile(path.join(payload,'hima/database/backup-authority.json'),JSON.stringify(authority));
    if(version===2)await writeFile(path.join(payload,'hima/database/maintenance-cut.json'),JSON.stringify(cut));
    manifest.roots=[{original:source,kind:'home',entries:await entries(payload)},
      {original:path.join(root,'original-distribution'),kind:'distribution',entries:await entries(distribution)}];
    await writeFile(path.join(backup,'manifest.json'),JSON.stringify(manifest),{mode:0o600});
  }
  await publish();
  return {backup,source,payload,manifest,authority,cut,exported,stopped,publish};
}
