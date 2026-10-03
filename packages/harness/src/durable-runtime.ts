import { createHash } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DBOS } from '@dbos-inc/dbos-sdk';
import type { WorkflowHandle } from '@dbos-inc/dbos-sdk';
import { NodePostgresDataSource } from '@dbos-inc/node-pg-datasource';
import { Pool } from 'pg';
import type { LocalDatabase } from './local-database.js';
import { jsonDigest, RunStore } from './run-store.js';
import { taskResultProtocol } from './task-contract.js';
import type { JsonValue, TaskResult } from './task-contract.js';

export const durableEngine = 'dbos/5.2.11' as const;
export const durableDependencyVersions = Object.freeze({sdk:'5.2.11',datasource:'5.2.11',pg:'8.16.3'});
export interface ExecutableManifest {
  readonly files: Readonly<Record<string,string>>;
  readonly adapters: Readonly<Record<string,string>>;
}
export interface DurableWorkflowDefinition {
  readonly name: string;
  readonly execute: (runtime: DurableRuntime, input: JsonValue) => Promise<JsonValue>;
}
export interface DurableRuntime {
  readonly applicationVersion: string;
  readonly store: RunStore;
  /** Registered functions may be composed by U6; the registry is fixed before launch. */
  readonly workflows: Readonly<Record<string,(input:JsonValue)=>Promise<JsonValue>>>;
  startWorkflow(name: string, workflowId: string, input: JsonValue): Promise<WorkflowHandle<JsonValue>>;
  commitResult(result:TaskResult): Promise<TaskResult>;
  stop(): Promise<void>;
}
let active = false;
const inheritedCloudMode = process.env.DBOS__CLOUD === 'true';
/** Hash installed executable bytes and runtime resources; Pack declarations remain frozen Run data. */
export async function installedExecutableManifest(root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')):Promise<ExecutableManifest> {
  const files:Record<string,string>={};
  async function visit(relative:string):Promise<void> {
    for(const entry of (await readdir(path.join(root,relative),{withFileTypes:true})).sort((a,b)=>a.name.localeCompare(b.name))) {
      const file=path.posix.join(relative,entry.name);
      if(entry.isSymbolicLink()) throw new Error(`Executable resource ${file} is a symlink; install the frozen App bytes`);
      if(entry.isDirectory()) { if(file !== 'lib/types' && file !== 'lib/client') await visit(file); }
      else if(entry.isFile() && (!file.startsWith('lib/') || entry.name.endsWith('.js') && entry.name !== 'client.js')) files[file]=createHash('sha256').update(await readFile(path.join(root,file))).digest('hex');
    }
  }
  for(const directory of ['lib','skills','rules','choosers','presets']) await visit(directory);
  for(const file of ['package.json','semantics.yml','cordis.patch.yml']) files[file]=createHash('sha256').update(await readFile(path.join(root,file))).digest('hex');
  return {files,adapters:{'task-result':taskResultProtocol}};
}
export function executableApplicationVersion(manifest:ExecutableManifest):string {
  if (!Object.keys(manifest.files).length || !Object.keys(manifest.adapters).length) throw new Error('Freeze executable files and adapter versions before starting DBOS');
  for(const digest of Object.values(manifest.files)) if(!/^[0-9a-f]{64}$/.test(digest)) throw new Error('Executable manifest must identify actual file bytes by SHA256');
  return `hima-${jsonDigest({engine:durableEngine,dependencies:{...durableDependencyVersions},files:{...manifest.files},adapters:{...manifest.adapters}})}`;
}
/** One process / one Home / one DBOS. The existing Host shuts this down before PostgreSQL. Pack
 * installation changes data, never this finite registration list or applicationVersion. */
export async function startDurableRuntime(options: {
  readonly database:LocalDatabase; readonly manifest:ExecutableManifest;
  readonly workflows?:readonly DurableWorkflowDefinition[];
}):Promise<DurableRuntime> {
  if(inheritedCloudMode || process.env.DBOS__CLOUD === 'true') throw new Error('HimaHarness uses private local DBOS only; remove DBOS__CLOUD=true and restart the Host');
  if(active || DBOS.isInitialized()) throw new Error('This Host already owns a durable runtime; use an independent Host for another Home');
  const applicationVersion=executableApplicationVersion(options.manifest);
  active=true;
  let store:RunStore;
  try {
    const source=new NodePostgresDataSource('hima-application',{...options.database.application,connectionTimeoutMillis:2000});
    store=new RunStore(options.database.application,source,applicationVersion);
  } catch(error) {
    try { await DBOS.shutdown({deregister:true,workflowCompletionTimeoutMS:1000}); }
    finally { active=false; }
    throw error;
  }
  const workflows:Record<string,(input:JsonValue)=>Promise<JsonValue>>={};
  const systemPool=new Pool({...options.database.system,connectionTimeoutMillis:2000});
  systemPool.on('error',()=>undefined);
  let stopping:Promise<void>|undefined;
  const runtime:DurableRuntime={applicationVersion,store,workflows,
    async startWorkflow(name,workflowId,input) {
      const workflow=workflows[name]; if(!workflow) throw new Error(`Unregistered durable workflow ${name}; reopen with the frozen executable version`);
      const runId = input !== null && !Array.isArray(input) && typeof input === 'object' ? input.runId : undefined;
      if(typeof runId === 'string') { const run=await store.run(runId); if(run.applicationVersion !== applicationVersion) throw new Error('Run requires its frozen executable version'); }
      return DBOS.startWorkflow(workflow,{workflowID:workflowId})(input);
    },
    commitResult:result=>store.commitResult(result),
    stop() {
      return stopping ??= (async()=>{
        try { await DBOS.shutdown({deregister:true,workflowCompletionTimeoutMS:1000}); }
        finally {
          try { await store.close(); await systemPool.end(); }
          finally { active=false; }
        }
      })();
    },
  };
  try {
    await store.initialize();
    for(const definition of options.workflows ?? []) {
      if(!definition.name.trim() || Object.hasOwn(workflows,definition.name)) throw new Error('Durable workflow registration names must be unique and nonempty');
      workflows[definition.name]=DBOS.registerWorkflow((input:JsonValue)=>definition.execute(runtime,input),{name:definition.name});
    }
    Object.freeze(workflows);
    DBOS.setConfig({name:'hima-harness',systemDatabasePool:systemPool,applicationVersion,
      executorID:`hima-${options.database.identity}`,logLevel:'error',enableOTLP:false});
    await DBOS.launch();
    return runtime;
  } catch(error) { await runtime.stop().catch(()=>undefined); throw error; }
}
