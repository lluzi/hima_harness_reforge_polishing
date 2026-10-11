import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, symlinkSync, readFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
const hash = (b: string | Buffer) => createHash('sha256').update(b).digest('hex');
const load = () => import(new URL('../../scripts/package-native-audit.mjs', import.meta.url).href);
function tar(entries: {name: string; bytes: Buffer}[]) {
  return Buffer.concat([...entries.flatMap(({name, bytes}) => {
    const header = Buffer.alloc(512); header.write(name); header.write('0000644\0',100);
    header.write(bytes.length.toString(8).padStart(11,'0')+'\0',124); header.fill(32,148,156); header.write('0',156); header.write('ustar\0',257);
    header.write([...header].reduce((n,b)=>n+b,0).toString(8).padStart(6,'0')+'\0 ',148);
    return [header,bytes,Buffer.alloc((512-bytes.length%512)%512)];
  }),Buffer.alloc(1024)]);
}
function fixture(architecture: 'arm64' | 'amd64' = 'arm64') {
  const directory=mkdtempSync(path.join(os.tmpdir(),'hima-sdk-audit-')); mkdirSync(path.join(directory,'engine'));
  const files: any[]=[];
  const components=Object.entries({opencode:'1.18.34',rg:'15.2.0',fd:'10.5.0',pi:'1.1.0',oar:'0.46.0'}).map(([id,version])=> {
    const requiredFiles=[`opt/hima/member/bin/${id}`],notices=[`opt/hima/member/notices/${id}/LICENSE`];
    for(const imagePath of [...requiredFiles,...notices]) files.push({root:'sdk',path:imagePath,imagePath,sha256:hash(imagePath),size:imagePath.length,mode:0o644});
    return {id,version,source:`https://example.test/${id}`,license:'MIT',requiredFiles,notices};
  });
  const sources:any={format:'hima-team-member-sources/1',platform:{os:'linux',architecture},components,files,symlinks:[],archives:[]};
  const descriptor=(bytes:Buffer,mediaType:string)=>({digest:`sha256:${hash(bytes)}`,size:bytes.length,mediaType});
  const layer=Buffer.from('opaque layer bytes; audit does not decompress');
  const config=Buffer.from(JSON.stringify({os:'linux',architecture,rootfs:{type:'layers',diff_ids:[`sha256:${hash('uncompressed')}`]},config:{Env:['NODE_VERSION=24.20.0']}}));
  const layers=[descriptor(layer,'application/vnd.oci.image.layer.v1.tar+gzip')];
  const ociManifest=Buffer.from(JSON.stringify({schemaVersion:2,config:descriptor(config,'application/vnd.oci.image.config.v1+json'),layers}));
  const index=Buffer.from(JSON.stringify({schemaVersion:2,manifests:[{...descriptor(ociManifest,'application/vnd.oci.image.manifest.v1+json'),platform:sources.platform}]}));
  const archive=tar([{name:'oci-layout',bytes:Buffer.from('{"imageLayoutVersion":"1.0.0"}')},{name:'index.json',bytes:index},...[ociManifest,config,layer].map(bytes=>({name:`blobs/sha256/${hash(bytes)}`,bytes}))]);
  const receipt:any={format:'hima-team-member-image-assembly/1',qualification:'offline-asset-assembly-only',memberReady:false,platform:sources.platform,archiveSha256:hash(archive),archiveSize:archive.length,manifestDigest:`sha256:${hash(ociManifest)}`,configDigest:`sha256:${hash(config)}`,baseArchiveSha256:hash('base'),sourceManifestSha256:hash(JSON.stringify(sources)),layers,addedLayer:{...layers[0],diffId:`sha256:${hash('uncompressed')}`},components:[{id:'node',version:'24.20.0',source:'https://github.com/nodejs/docker-node',manifestDigest:`sha256:${hash('base-manifest')}`,executable:'usr/local/bin/node',sha256:hash('node'),license:'MIT',noticeQualification:'base transitive obligations unqualified'},...components],nativeProbes:'NOT RUN',releaseBlockers:['transitive source/NOTICE closure']};
  const manifest:any={platform:architecture==='arm64'?'darwin-arm64':'linux-x64',files:{},engineeringEngine:{guestPlatform:architecture==='arm64'?'linux-arm64':'linux-x64',image:{file:'engine/member-sdk.oci.tar',sha256:hash(archive),bytes:archive.length,manifestSha256:hash(ociManifest),configSha256:hash(config),layers:layers.map(l=>({sha256:l.digest.slice(7),bytes:l.size}))}}};
  const stage=()=> {
    receipt.sourceManifestSha256=hash(JSON.stringify(sources));
    for(const [file,bytes] of [['engine/member-sdk.oci.tar',archive],['engine/member-sdk-receipt.json',Buffer.from(JSON.stringify(receipt))],['engine/member-sdk-sources.json',Buffer.from(JSON.stringify(sources))]] as const){writeFileSync(path.join(directory,file),bytes);manifest.files[file]=hash(bytes);}
  }; stage(); return {directory,sources,receipt,manifest,stage,archive};
}
test('member asset audit inventories six assembly-bound components without activating or extracting assets',async()=> {
  const f=fixture(); try {
    f.sources.files.push({imagePath:'opt/hima/member/notices/supplemental/notice-scope.json',path:'notice-scope.json',sha256:hash('scope declarations'),size:18});f.stage();
    const before=readFileSync(path.join(f.directory,'engine/member-sdk.oci.tar'));
    const {auditTeamMemberAssets}=await load(); const result=auditTeamMemberAssets(f)!;
    assert.equal(result.scope,'ASSEMBLY-BOUND DECLARATIONS ONLY'); assert.equal(result.memberReady,false);
    assert.deepEqual(result.components.map((c:any)=>c.id),['node','opencode','rg','fd','pi','oar']);
    assert.equal(result.components[1].notices[0].imagePath,'opt/hima/member/notices/opencode/LICENSE');
    assert.equal(result.components[1].notices[0].sha256,hash('opt/hima/member/notices/opencode/LICENSE'));
    assert.equal(result.identities.archiveSha256,f.manifest.engineeringEngine.image.sha256);
    assert.deepEqual(result.supplementalNotices[0],{imagePath:'opt/hima/member/notices/supplemental/notice-scope.json',sha256:hash('scope declarations'),bytes:18,contentNotIndependentlyRead:true});
    assert.ok(result.unresolved.some((s:string)=>s.includes('transitive'))); assert.match(result.limits.join(' '),/nested.*license/i);
    assert.deepEqual(readFileSync(path.join(f.directory,'engine/member-sdk.oci.tar')),before);
  }finally{rmSync(f.directory,{recursive:true,force:true});}
});
test('old service and base-engine manifests remain compatible',async()=> {
  const {auditTeamMemberAssets}=await load();
  assert.equal(auditTeamMemberAssets({directory:'unused',manifest:{components:[]}}),undefined);
  assert.equal(auditTeamMemberAssets({directory:'unused',manifest:{engineeringEngine:{image:{file:'engine/base.tar'}}}}),undefined);
});
for(const variant of ['archive','receipt','sources','source-binding','cohort','platform','layer','missing','image-path','link-escape','outer-escape','symlink','oci-blob','supplemental'] as const) test(`member asset audit rejects ${variant}`,async()=> {
  const f=fixture(); try {
    if(variant==='cohort')f.receipt.components[1].version='other';
    if(variant==='platform')f.receipt.platform={os:'linux',architecture:'amd64'};
    if(variant==='layer')f.receipt.layers=[{...f.receipt.layers[0],digest:`sha256:${'0'.repeat(64)}`}];
    if(variant==='image-path')f.sources.files[0].imagePath='../escape';
    if(variant==='link-escape')f.sources.symlinks=[{imagePath:'opt/hima/member/link',target:'../../../../escape'}];
    if(variant==='supplemental'){f.sources.files.push({imagePath:'opt/hima/member/notices/supplemental/scope.json',path:'scope.json',sha256:'bad',size:1});}
    if(variant==='oci-blob'){const at=f.archive.indexOf('opaque layer bytes');f.archive[at]=88;f.receipt.archiveSha256=hash(f.archive);f.manifest.engineeringEngine.image.sha256=hash(f.archive);}
    f.stage();
    if(variant==='archive')writeFileSync(path.join(f.directory,'engine/member-sdk.oci.tar'),'corrupt');
    if(variant==='receipt')writeFileSync(path.join(f.directory,'engine/member-sdk-receipt.json'),'{}');
    if(variant==='sources')writeFileSync(path.join(f.directory,'engine/member-sdk-sources.json'),'{}');
    if(variant==='source-binding'){f.receipt.sourceManifestSha256='0'.repeat(64);const b=JSON.stringify(f.receipt);writeFileSync(path.join(f.directory,'engine/member-sdk-receipt.json'),b);f.manifest.files['engine/member-sdk-receipt.json']=hash(b);}
    if(variant==='missing')rmSync(path.join(f.directory,'engine/member-sdk-sources.json'));
    if(variant==='outer-escape')f.manifest.engineeringEngine.image.file='../member-sdk.oci.tar';
    if(variant==='symlink'){const file=path.join(f.directory,'engine/member-sdk-sources.json');rmSync(file);symlinkSync('/etc/hosts',file);}
    const {auditTeamMemberAssets}=await load(); assert.equal(typeof auditTeamMemberAssets,'function'); assert.throws(()=>auditTeamMemberAssets(f));
  }finally{rmSync(f.directory,{recursive:true,force:true});}
});

test('existing distribution seam publishes additive SDK inventory and keeps release blockers', async()=> {
  const f=fixture(); try {
    const resource=path.join(f.directory,'app'); mkdirSync(path.join(resource,'node_modules'),{recursive:true});
    const {cpSync}=await import('node:fs'); cpSync(path.join(f.directory,'engine'),path.join(resource,'team-runtime/engine'),{recursive:true});
    writeFileSync(path.join(resource,'team-runtime/team-runtime.json'),JSON.stringify({...f.manifest,components:[]}));
    const lockfile=path.join(f.directory,'lock.yaml');writeFileSync(lockfile,'packages: {}\n');
    const {auditDistribution}=await load();const result=auditDistribution({app:resource,resource,lockfile,electronVersion:'test',teamRuntimeIdentity:{platform:'darwin-arm64',manifestSha256:hash(JSON.stringify({...f.manifest,components:[]})),releaseBlockers:['release barrier']}});
    const sbom=JSON.parse(readFileSync(path.join(resource,'third-party/SBOM.json'),'utf8'));
    assert.equal(sbom.teamMemberSDK.components.length,6);assert.ok(result.unresolved.includes('release barrier'));
    assert.ok(result.unresolved.some((s:string)=>s.includes('nested license bytes')));
    assert.deepEqual(Object.keys(result).sort(),['file','sha256','npmComponents','nativeObjects','foreignNativeObjects','unresolved'].sort());
    assert.match(readFileSync(path.join(resource,'third-party/THIRD_PARTY_NOTICES.md'),'utf8'),/ASSEMBLY-BOUND DECLARATIONS ONLY/);
  }finally{rmSync(f.directory,{recursive:true,force:true});}
});

test('coherent Linux x64 SDK remains an assembly-bound declaration inventory',async()=> {
  const f=fixture('amd64');try {
    const {auditTeamMemberAssets}=await load();const result=auditTeamMemberAssets(f);
    assert.deepEqual(result.platform,{os:'linux',architecture:'amd64'});
    assert.equal(result.scope,'ASSEMBLY-BOUND DECLARATIONS ONLY');assert.equal(result.memberReady,false);
    assert.ok(result.unresolved.some((s:string)=>s.includes('native execution')));
  }finally{rmSync(f.directory,{recursive:true,force:true});}
});
for(const [architecture,host,guest] of [
  ['arm64','linux-x64','linux-arm64'],['arm64','darwin-arm64','linux-x64'],
  ['amd64','darwin-arm64','linux-x64'],['amd64','linux-x64','linux-arm64'],
  ['arm64','darwin-x64','linux-arm64'],
] as const) test(`member SDK rejects crossing ${architecture}/${host}/${guest}`,async()=> {
  const f=fixture(architecture);try {
    f.manifest.platform=host;f.manifest.engineeringEngine.guestPlatform=guest;
    const {auditTeamMemberAssets}=await load();assert.throws(()=>auditTeamMemberAssets(f),/identity differs/);
  }finally{rmSync(f.directory,{recursive:true,force:true});}
});

test('member OCI requires both zero end blocks even with coherently rebound archive identity',async()=> {
  const f=fixture();try {
    const truncated=f.archive.subarray(0,f.archive.length-1024);
    assert.ok(f.archive.subarray(f.archive.length-1024).every(byte=>byte===0));
    writeFileSync(path.join(f.directory,'engine/member-sdk.oci.tar'),truncated);
    const sha256=hash(truncated);f.manifest.files['engine/member-sdk.oci.tar']=sha256;
    f.manifest.engineeringEngine.image.sha256=sha256;f.manifest.engineeringEngine.image.bytes=truncated.length;
    f.receipt.archiveSha256=sha256;f.receipt.archiveSize=truncated.length;
    const receipt=JSON.stringify(f.receipt);writeFileSync(path.join(f.directory,'engine/member-sdk-receipt.json'),receipt);
    f.manifest.files['engine/member-sdk-receipt.json']=hash(receipt);
    const {auditTeamMemberAssets}=await load();assert.throws(()=>auditTeamMemberAssets(f),/terminator/);
  }finally{rmSync(f.directory,{recursive:true,force:true});}
});
