// Prepare a fresh, isolated demo Home beside a packaged trial App (pattern of issue83-r7 prepare-home.mjs).
// Run from the root of the worktree that built the App (it imports packages/desktop/lib and the
// credential packages from node_modules):
//   node docs/product-demo/customer-demo/scripts/prepare-demo-home.mjs \
//     <kitDir> <siteYml> <permitYml> <priorHomeWithCredential> [siteName]
// It refuses an existing Home, installs the Site file as hima/sites/<siteName>.yml with its Permit
// beside it as permit.yml, copies the DEEPSEEK_API_KEY credential natively from a prior Home (the
// value is never printed) and writes <kitDir>/fresh-home.json as evidence.
import {mkdir,cp,chmod,writeFile,stat} from 'node:fs/promises';
import {readFileSync,readdirSync,existsSync} from 'node:fs';
import {createRequire} from 'node:module';
import {pathToFileURL} from 'node:url';
import path from 'node:path';
import {createHash} from 'node:crypto';
const root=process.cwd();
const [kit,siteYml,permitYml,prior,siteNameArg]=process.argv.slice(2);
if(!kit||!siteYml||!permitYml||!prior) throw new Error('usage: kitDir siteYml permitYml priorHome [siteName]');
const siteName=siteNameArg??path.basename(path.dirname(path.resolve(siteYml)));
const {prepareHimaHome,himaHomeSources}=await import(pathToFileURL(path.join(root,'packages/desktop/lib/hima-home.js')).href);
const resource=path.join(kit,'HimaHarness.app/Contents/Resources/app');
const home=path.join(kit,'Trial Data/dsh'), workspace=path.join(kit,'Trial Workspace');
if(existsSync(home)) throw new Error('refusing existing Home');
delete process.env.DEEPSEEK_API_KEY;
await mkdir(home,{recursive:true}); await mkdir(workspace,{recursive:true});
await prepareHimaHome({home,sources:himaHomeSources(resource)});
const sites=path.join(home,'hima/sites');
await cp(siteYml,path.join(sites,`${siteName}.yml`));
await cp(permitYml,path.join(sites,'permit.yml'));
const pnpm=path.join(root,'node_modules/.pnpm');
const dir=readdirSync(pnpm).find(name=>name.startsWith('@deepseek-ai+dsh-credentials-local@'));
const entry=path.join(pnpm,dir,'node_modules/@deepseek-ai/dsh-credentials-local/lib/index.js');
const req=createRequire(entry);
const {Context,Service}=await import(pathToFileURL(req.resolve('@deepseek-ai/cordis')).href);
const {LocalCredentialProvider}=await import(pathToFileURL(entry).href);
const {credentialRef}=await import(pathToFileURL(req.resolve('@deepseek-ai/dsh-credentials')).href);
async function withProvider(file,fn){const p=new LocalCredentialProvider(new Context(),{path:file,watch:false});const init=p[Service.init]();const dispose=(await init.next()).value;try{await init.next();return await fn(p);}finally{if(typeof dispose==='function')await dispose();}}
const ref=credentialRef('DEEPSEEK_API_KEY');
const held=await withProvider(path.join(prior,'.credentials.yaml'),p=>p.resolve(ref));
if(typeof held?.value!=='string'||!held.value)throw new Error('missing configured product credential');
await withProvider(path.join(home,'.credentials.yaml'),p=>p.set(ref,held.value));
await chmod(path.join(home,'.credentials.yaml'),0o600);
const sha=p=>createHash('sha256').update(readFileSync(p)).digest('hex');
const evidence={home,workspace,siteName,siteSha256:sha(path.join(sites,`${siteName}.yml`)),permitSha256:sha(path.join(sites,'permit.yml')),credentialMode:(await stat(path.join(home,'.credentials.yaml'))).mode&0o777,ledgerExists:existsSync(path.join(home,'storages/hima_ledger.json'))};
await writeFile(path.join(kit,'fresh-home.json'),JSON.stringify(evidence,null,2)+'\n');
console.log(JSON.stringify(evidence));
