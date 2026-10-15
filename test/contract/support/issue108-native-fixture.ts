/** Structural path/lineage fixture only; never a real PG qualification or native session claim. */
import { cp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { createHash, randomUUID } from 'node:crypto';
import { hostname, homedir } from 'node:os';
import path from 'node:path';
import { archive108, hash108 } from './issue108-backup-fixture.ts';
export async function nativeArchive108(root:string,local:any) {
  const f=await archive108(root,2),sessionKey='retained-member-108';
  const memberRoot=path.join(f.source,'hima/oar-members',sessionKey);
  const digest='a'.repeat(64),prepared={schema:'hima-oar-task/1',sessionKey,generation:0,memberId:'member-a',runtime:'pi',projectId:'project',modelRef:'default',
    inputId:'input-a',deadlineAt:'2099-01-01T00:00:00Z',prompt:'Retained path fixture',identity:{runId:'run-a',effectId:'effect-a',taskId:'task-a',
      inputSha256:digest,irSha256:digest,applicationVersion:'app',adapterVersion:'adapter',packSha256:digest}};
  const assets={oarModule:'/unused/oar.js',nodeExecutable:process.execPath,opencodeCommand:'/unused/opencode',opencodeVersion:'unused'};
  const runtime=new local.OarLocalMemberRuntime({home:f.source,nodeExecutable:process.execPath,runnerModule:'/unused/runner.js',assets});
  const lease=await runtime.stage({prepared,model:{provider:'openai-completions',model:'fixture',baseUrl:'https://example.invalid',apiKey:''},outputSchemaVersion:'1'},[]);
  await runtime.close(lease); // actual stage/never-started closure; no process or signal
  const origin={identity:prepared.identity,sessionKey,generation:0,memberId:prepared.memberId,runtime:'pi',nativeSession:'synthetic-context-108',cwd:lease.workDirectory};
  const pi=`pi/sessions/--${lease.workDirectory.replace(/^[/\\]/,'').replace(/[/\\:]/g,'-')}--/original.jsonl`;
  await mkdir(path.dirname(path.join(lease.controlDirectory,'native',pi)),{recursive:true});
  await writeFile(path.join(lease.controlDirectory,'native',pi),JSON.stringify({type:'session',id:origin.nativeSession,cwd:origin.cwd})+'\n'+JSON.stringify({type:'message',message:{role:'user',content:'retained fixture context'}})+'\n',{mode:0o600});
  // Actual filesystem checkpoint hashing/verification over synthetic Pi conversation bytes;
  // this does not assert a real native creation or physically-started member qualification.
  const capture=local.captureLocalNativeFiles(lease.controlDirectory,origin,'restore-path',{maxFiles:8,maxBytes:4096,maxFileBytes:2048});
  if(capture.state!=='captured')throw new Error('Native FS fixture checkpoint was not captured');
  const checkpoint=capture.checkpoint;
  const relative=path.relative(f.source,memberRoot);
  await cp(memberRoot,path.join(f.payload,relative),{recursive:true});
  const leaseBytes=await readFile(path.join(memberRoot,'lease.json'),'utf8'),configurationBytes=await readFile(path.join(memberRoot,'control/config.json'),'utf8');
  const identity=randomUUID();f.manifest.identity=identity;f.authority.identity=identity;f.cut.identity=identity;
  await writeFile(path.join(f.payload,'hima/database/credentials.json'),JSON.stringify({identity}),{mode:0o600});
  await f.publish();await cp(f.payload,f.source,{recursive:true});
  return {...f,sessionKey,memberRoot,lease,leaseBytes,configurationBytes,checkpoint,
    binding:{root:memberRoot,leaseSha256:hash108(leaseBytes),configurationSha256:hash108(configurationBytes)},
    async arrangeQualifiedResolverState(backup:any,gate:any,home:string) {
      // Arrange the authority boundary for the resolver unit. This is NOT calling or proving
      // qualifyHeldRestore: real PG/distribution/native closure remains I-scheduled.
      const inspected=await backup.inspectColdBackup(f.backup);
      const machine=createHash('sha256').update(JSON.stringify([hostname(),homedir(),process.getuid?.(),process.platform,process.arch])).digest('hex');
      await gate.writeDatabaseLineage({format:'hima-database-lineage/1',identity,machine,epoch:1,currentHome:home,
        retainedMaterialsDir:f.manifest.retainedMaterialsDir,retiredHomes:[f.source],retiredManifest:inspected.manifestSha256});
      await writeFile(path.join(home,'hima/restore-lineage.json'),JSON.stringify({format:'hima-restore-lineage/1',identity,epoch:1,
        manifest:inspected.manifestSha256,qualified:true,memberRoots:{[sessionKey]:{root:memberRoot,leaseSha256:hash108(leaseBytes),configurationSha256:hash108(configurationBytes)}}}),{mode:0o600});
      return inspected;
    },
    async originalBytes() {return [await readFile(path.join(memberRoot,'lease.json'),'utf8'),await readFile(path.join(memberRoot,'control/config.json'),'utf8')];},
  };
}
