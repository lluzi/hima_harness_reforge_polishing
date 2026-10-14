// #106: narrow Host-owned GitHub writes for a human-opened software Team task.
// Native members receive only member_context; this adapter retains the Host login.
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { inspectTeamRepositoryForWrite, memberGitEnvironment, parseTeamGitHubTask, preflightTeamRepository, verifyTaskGitHubPolicy, type TeamGitHubTask } from './team-worktree.js';

const execute = promisify(execFile);
const helper='credential.helper=!gh auth git-credential';
const hostGitHubEnvironment=():NodeJS.ProcessEnv=>{
  const env:NodeJS.ProcessEnv={PATH:process.env.PATH??'/usr/bin:/bin',HOME:process.env.HOME??os.homedir(),
    GIT_TERMINAL_PROMPT:'0',GH_PROMPT_DISABLED:'1'};
  for(const name of ['XDG_CONFIG_HOME','GH_CONFIG_DIR','GH_HOST','GH_TOKEN','GITHUB_TOKEN','GH_ENTERPRISE_TOKEN',
    'GITHUB_ENTERPRISE_TOKEN','HTTP_PROXY','HTTPS_PROXY','ALL_PROXY','NO_PROXY','http_proxy','https_proxy','all_proxy','no_proxy',
    'SSL_CERT_FILE','LANG','TZ','TMPDIR'])if(process.env[name])env[name]=process.env[name];
  return env;
};
const localGit=async(...args:string[]):Promise<string>=>{
  const result=await execute('/usr/bin/git',['-c','credential.helper=','-c','core.hooksPath=/dev/null','-c','core.fsmonitor=false',...args],
    {encoding:'utf8',timeout:30_000,maxBuffer:1024*1024,env:memberGitEnvironment});
  return result.stdout.trim();
};
export interface GitHubCommandPort { run(executable:'git'|'gh',args:readonly string[],cwd?:string):Promise<string> }
const commandPort:GitHubCommandPort={
  async run(executable,args,cwd) {
    try {
      const result=await execute(executable==='git'?'/usr/bin/git':'gh',[...args],
        {cwd:cwd??os.tmpdir(),encoding:'utf8',timeout:45_000,maxBuffer:1024*1024,
          env:{...hostGitHubEnvironment(),...(executable==='git'?{GIT_CONFIG_NOSYSTEM:'1',GIT_CONFIG_GLOBAL:'/dev/null',GIT_CONFIG_COUNT:'0'}:{})}});
      return result.stdout.trim();
    } catch(error) {
      const code=(error as {code?:string|number}).code;
      throw new Error(`${executable} operation failed${code===undefined?'':` (${String(code)})`}; the Host retained the original checkout and remote state.`,{cause:error});
    }
  },
};

export type TeamGitHubAction =
  | {readonly action:'checkout'}
  | {readonly action:'status'}
  | {readonly action:'push-task-branch'}
  | {readonly action:'open-pr';readonly testsCommit:string;readonly reviewCommit:string;
      readonly tests:string;readonly review:string;readonly remaining:string};

const json=<T>(text:string):T=>JSON.parse(text) as T;
const git=(port:GitHubCommandPort,...args:string[]):Promise<string>=>port.run('git',args);
const gh=(port:GitHubCommandPort,...args:string[]):Promise<string>=>port.run('gh',args);
const candidateDir=(memberRoot:string):string=>path.join(memberRoot,'software','task');
const repositoryDir=(memberRoot:string):string=>path.join(memberRoot,'software','repository');
const remoteUrl=(task:TeamGitHubTask):string=>`https://github.com/${task.repository}.git`;

async function issue(port:GitHubCommandPort,task:TeamGitHubTask):Promise<{url:string;title:string;state:string}> {
  const found=json<{url:string;title:string;state:string}>(await gh(port,'issue','view',String(task.issueNumber),'--repo',task.repository,'--json','url,title,state'));
  if(found.url!==task.issueUrl||found.state!=='OPEN')throw new Error('The original GitHub Issue is missing, closed or belongs to another repository.');
  return found;
}

async function remoteHead(port:GitHubCommandPort,task:TeamGitHubTask):Promise<string|undefined> {
  const output=await git(port,'-c',helper,'ls-remote',remoteUrl(task),`refs/heads/${task.taskBranch}`);
  const row=output.split('\n').find(line=>line.endsWith(`\trefs/heads/${task.taskBranch}`));
  return row?.split('\t')[0];
}

async function existingPr(port:GitHubCommandPort,task:TeamGitHubTask):Promise<{url:string;number:number;headRefOid:string;baseRefName:string;state:string}|undefined> {
  const list=json<{url:string;number:number;headRefOid:string;baseRefName:string;state:string}[]>(await gh(port,'pr','list','--repo',task.repository,'--head',task.taskBranch,'--state','all','--json','url,number,headRefOid,baseRefName,state'));
  if(list.length>1)throw new Error('Multiple pull requests use the task branch; choose the original one before continuing.');
  return list[0];
}

async function repoBase(port:GitHubCommandPort,task:TeamGitHubTask):Promise<string> {
  const info=json<{defaultBranchRef?:{name?:string}}>(await gh(port,'repo','view',task.repository,'--json','defaultBranchRef'));
  const base=info.defaultBranchRef?.name;
  if(!base||base===task.taskBranch)throw new Error('The repository default branch is unavailable or equals the task branch.');
  return base;
}

async function pushFrozenCommit(port:GitHubCommandPort,task:TeamGitHubTask,worktree:string,commit:string,beforeWrite:()=>Promise<void>):Promise<void> {
  const temporary=await mkdtemp(path.join(os.tmpdir(),'hima-team-push-'));
  const bare=path.join(temporary,'objects.git');
  try {
    await localGit('init','--bare','-q',bare);
    // The first transfer is local and has no credential. The credentialed push
    // runs only from this fresh Host-controlled bare repository.
    await localGit(`--git-dir=${bare}`,'fetch','--no-tags','--no-recurse-submodules',worktree,commit);
    if(await localGit(`--git-dir=${bare}`,'rev-parse','FETCH_HEAD')!==commit||await localGit(`--git-dir=${bare}`,'cat-file','-t',commit)!=='commit')
      throw new Error('The reviewed Git object was not copied unchanged into the Host push repository.');
    await beforeWrite();
    await git(port,`--git-dir=${bare}`,'-c',helper,'-c','core.hooksPath=/dev/null','-c','push.followTags=false','push','--no-follow-tags',
      remoteUrl(task),`${commit}:refs/heads/${task.taskBranch}`);
  } finally {await rm(temporary,{recursive:true,force:true});}
}

/** The Host chooses fixed checkout paths below the current native member root. */
export async function operateTeamGitHub(memberRoot:string,rawTask:unknown,request:TeamGitHubAction,port:GitHubCommandPort=commandPort,
  beforeWrite:()=>Promise<void>=async()=>{}):Promise<object> {
  const task=parseTeamGitHubTask(rawTask),root=await realpath(memberRoot);
  await issue(port,task);
  const base=await repoBase(port,task),worktree=candidateDir(root),repository=repositoryDir(root);
  if(request.action==='status')return {issueUrl:task.issueUrl,baseBranch:base,
    remoteHead:await remoteHead(port,task),pullRequest:await existingPr(port,task)};
  if(request.action==='checkout') {
    const software=path.dirname(repository);
    await mkdir(software,{recursive:true,mode:0o700});
    if(await realpath(software)!==software)throw new Error('The member software directory must stay inside its original work root.');
    const existing=await realpath(worktree).catch(()=>undefined);
    if(existing) {
      const checked=await inspectTeamRepositoryForWrite(worktree,task);
      const remote=await remoteHead(port,task);
      if(remote&&remote!==checked.headCommit) {
        const temporary=await mkdtemp(path.join(os.tmpdir(),'hima-team-read-'));
        const fresh=path.join(temporary,'repository.git');
        try {
          await git(port,'-c',helper,'-c','core.hooksPath=/dev/null','clone','--bare',remoteUrl(task),fresh);
          if(await localGit(`--git-dir=${fresh}`,'rev-parse',task.taskBranch)!==remote)
            throw new Error('The remote task branch changed while the review checkout was opening.');
          await beforeWrite();
          await localGit('-C',repository,'fetch','--no-tags',fresh,remote);
          const older=await localGit('-C',worktree,'merge-base','--is-ancestor',checked.headCommit,remote).then(()=>true,()=>false);
          const ahead=await localGit('-C',worktree,'merge-base','--is-ancestor',remote,checked.headCommit).then(()=>true,()=>false);
          if(!older&&!ahead)throw new Error('The local and remote task branches diverged; retain both and reconcile before continuing.');
          if(older)await localGit('-C',worktree,'merge','--ff-only',remote);
        } finally {await rm(temporary,{recursive:true,force:true});}
        if(await localGit('-C',worktree,'rev-parse','HEAD')===remote) {
          const refreshed=await inspectTeamRepositoryForWrite(worktree,task);
          return {state:'updated',worktree:refreshed.worktree,headCommit:refreshed.headCommit,baseBranch:base};
        }
      }
      return {state:'existing',worktree:checked.worktree,headCommit:checked.headCommit,baseBranch:base};
    }
    if(await realpath(repository).catch(()=>undefined))throw new Error('The task repository exists without its worktree; inspect its original Git state before continuing.');
    await beforeWrite();
    await git(port,'-c',helper,'-c','core.hooksPath=/dev/null','clone','--no-checkout',remoteUrl(task),repository);
    const defaultHead=await localGit('-C',repository,'rev-parse',`origin/${base}`);
    if(defaultHead!==task.baseCommit)throw new Error('The default branch changed from the human-approved base commit; refresh the task binding.');
    const remote=await remoteHead(port,task);
    if(remote&&await localGit('-C',repository,'rev-parse',`origin/${task.taskBranch}`)!==remote)
      throw new Error('The task branch changed while the checkout was opening.');
    await beforeWrite();
    await localGit('-C',repository,'worktree','add','-b',task.taskBranch,worktree,remote??task.baseCommit);
    const checked=remote?await inspectTeamRepositoryForWrite(worktree,task):await preflightTeamRepository(worktree,task);
    return {state:'created',worktree:checked.worktree,headCommit:checked.headCommit,baseBranch:base};
  }
  const checked=await inspectTeamRepositoryForWrite(worktree,task);
  verifyTaskGitHubPolicy(checked,{action:request.action,repository:task.repository,branch:task.taskBranch,baseCommit:task.baseCommit});
  if(checked.headCommit===task.baseCommit)throw new Error('The task branch has no reviewed candidate commit.');
  if(request.action==='push-task-branch') {
    const prior=await remoteHead(port,task);
    if(prior&&prior!==checked.headCommit)try {await localGit('-C',worktree,'merge-base','--is-ancestor',prior,checked.headCommit);}
    catch {throw new Error('The remote task branch is not an ancestor of the reviewed candidate; reconcile before writing.');}
    if(prior!==checked.headCommit)await pushFrozenCommit(port,task,worktree,checked.headCommit,beforeWrite);
    const observed=await remoteHead(port,task);
    if(observed!==checked.headCommit)throw new Error('GitHub did not confirm the exact pushed candidate commit.');
    return {state:prior===checked.headCommit?'already-pushed':'pushed',branch:task.taskBranch,headCommit:observed};
  }
  const remote=await remoteHead(port,task);
  if(remote!==checked.headCommit)throw new Error('Push the exact candidate commit before creating its PR.');
  if(request.testsCommit!==remote||request.reviewCommit!==remote)
    throw new Error('Tests and independent review must name the exact PR head commit.');
  const prior=await existingPr(port,task);
  if(prior) {
    if(prior.state!=='OPEN'||prior.headRefOid!==remote||prior.baseRefName!==base)throw new Error('Existing PR identity differs from the frozen candidate; inspect it before retrying.');
    return {state:'existing',url:prior.url,number:prior.number,headCommit:remote};
  }
  for(const [name,value] of Object.entries({tests:request.tests,review:request.review,remaining:request.remaining}))
    if(!value.trim()||value.length>12000)throw new Error(`PR ${name} receipt must be nonempty and bounded.`);
  const body=`Closes ${task.issueUrl}\n\nHead: ${remote}\n\nTests (${request.testsCommit}): ${request.tests}\n\nIndependent review (${request.reviewCommit}): ${request.review}\n\nRemaining: ${request.remaining}\n`;
  const temp=await mkdtemp(path.join(os.tmpdir(),'hima-team-pr-'));
  try {
    const file=path.join(temp,'body.md');await writeFile(file,body,{mode:0o600});
    const title=`Fix #${task.issueNumber}: ${(await issue(port,task)).title.slice(0,120)}`;
    await beforeWrite();
    await gh(port,'pr','create','--repo',task.repository,'--head',task.taskBranch,'--base',base,
      '--title',title,'--body-file',file);
  } finally {await rm(temp,{recursive:true,force:true});}
  const created=await existingPr(port,task);
  if(!created||created.state!=='OPEN'||created.headRefOid!==remote||created.baseRefName!==base)
    throw new Error('PR creation was not confirmed against the exact candidate commit.');
  return {state:'created',url:created.url,number:created.number,headCommit:remote};
}
