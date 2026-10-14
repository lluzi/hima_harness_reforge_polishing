// #106: actual Git worktree identity and the narrow Team write operation set.
// No GitHub credential, remote write or product model is used in this local test.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { inspectTeamRepositoryForWrite, operateTeamGitHub, preflightTeamRepository, verifyTaskGitHubPolicy, type GitHubCommandPort } from '@hima/harness';

const command = promisify(execFile);
async function git(at: string, ...args: string[]): Promise<string> {
  return (await command('git', ['-C', at, ...args], { encoding: 'utf8', timeout: 10_000 })).stdout.trim();
}

test('task preflight accepts one clean linked worktree and refuses wrong repository, branch, base or Issue', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'hima-team-git-'));
  const main = path.join(root, 'main'), worktree = path.join(root, 'task');
  try {
    await git(root, 'init', '-q', main);
    await git(main, 'config', 'user.name', 'Hima Test');
    await git(main, 'config', 'user.email', 'hima-test@example.invalid');
    await git(main, 'remote', 'add', 'origin', 'https://github.com/lluzi/himateam_test.git');
    await writeFile(path.join(main, 'README.md'), '# fixture\n');
    await git(main, 'add', 'README.md');
    await git(main, 'commit', '-qm', 'fixture base');
    const baseCommit = await git(main, 'rev-parse', 'HEAD');
    await git(main, 'worktree', 'add', '-q', '-b', 'codex/issue-1', worktree, 'HEAD');
    const binding = { repository: 'lluzi/himateam_test', issueNumber: 1,
      issueUrl: 'https://github.com/lluzi/himateam_test/issues/1', baseCommit, taskBranch: 'codex/issue-1' };
    const accepted = await preflightTeamRepository(worktree, binding);
    assert.equal(accepted.headCommit, baseCommit);
    assert.equal(accepted.worktree, await realpath(worktree));
    await assert.rejects(preflightTeamRepository(main, binding), /independent linked Git worktree/);
    await assert.rejects(preflightTeamRepository(worktree, { ...binding, repository: 'lluzi/other', issueUrl: 'https://github.com/lluzi/other/issues/1' }), /origin differs/);
    await assert.rejects(preflightTeamRepository(worktree, { ...binding, taskBranch: 'codex/issue-2' }), /branch differs/);
    await assert.rejects(preflightTeamRepository(worktree, { ...binding, baseCommit: '0'.repeat(40) }), /exact recorded base/);
    await assert.rejects(preflightTeamRepository(worktree, { ...binding, issueUrl: 'https://github.com/lluzi/himateam_test/issues/2' }), /exact task repository and Issue/);
    await writeFile(path.join(worktree, 'untracked.txt'), 'not yet admitted\n');
    await assert.rejects(preflightTeamRepository(worktree, binding), /uncommitted or untracked/);
    await rm(path.join(worktree, 'untracked.txt'));
    await writeFile(path.join(worktree, 'README.md'), '# corrected\n');
    await git(worktree, 'add', 'README.md');await git(worktree, 'commit', '-qm', 'correct issue');
    assert.notEqual((await inspectTeamRepositoryForWrite(worktree, binding)).headCommit, baseCommit);
    await assert.rejects(preflightTeamRepository(worktree, binding), /exact recorded base/);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('Host GitHub adapter binds a committed task worktree, confirms push and reuses one exact PR', async () => {
  const root=await mkdtemp(path.join(os.tmpdir(),'hima-team-gh-'));
  const repository=path.join(root,'software','repository'),worktree=path.join(root,'software','task');
  try {
    await git(root,'init','-q',repository);
    await git(repository,'config','user.name','Hima Test');await git(repository,'config','user.email','hima-test@example.invalid');
    await git(repository,'remote','add','origin','https://github.com/lluzi/himateam_test.git');
    await writeFile(path.join(repository,'README.md'),'base\n');await git(repository,'add','README.md');await git(repository,'commit','-qm','base');
    const baseCommit=await git(repository,'rev-parse','HEAD');
    await git(repository,'worktree','add','-q','-b','codex/issue-1',worktree,'HEAD');
    await writeFile(path.join(worktree,'README.md'),'fixed\n');await git(worktree,'add','README.md');await git(worktree,'commit','-qm','fix');
    const head=await git(worktree,'rev-parse','HEAD');
    await git(worktree,'config','remote.origin.pushurl','https://github.com/lluzi/other.git');
    await git(worktree,'config','push.followTags','true');
    await git(worktree,'tag','v1');
    const binding={repository:'lluzi/himateam_test',issueNumber:1,issueUrl:'https://github.com/lluzi/himateam_test/issues/1',baseCommit,taskBranch:'codex/issue-1'};
    let remote:string|undefined,created=0,body='',pr:{url:string;number:number;headRefOid:string;baseRefName:string;state:string}|undefined;
    const port:GitHubCommandPort={async run(executable,args) {
      if(executable==='gh') {
        if(args[0]==='issue'&&args[1]==='view')return JSON.stringify({url:binding.issueUrl,title:'Known bug',state:'OPEN'});
        if(args[0]==='repo'&&args[1]==='view')return JSON.stringify({defaultBranchRef:{name:'main'}});
        if(args[0]==='pr'&&args[1]==='list')return JSON.stringify(pr?[pr]:[]);
        if(args[0]==='pr'&&args[1]==='create') {
          created++;body=await readFile(String(args[args.indexOf('--body-file')+1]),'utf8');
          pr={url:'https://github.com/lluzi/himateam_test/pull/2',number:2,headRefOid:head,baseRefName:'main',state:'OPEN'};
          return pr.url;
        }
      }
      if(executable==='git') {
        if(args.includes('ls-remote')){
          assert.ok(args.includes('https://github.com/lluzi/himateam_test.git'));
          return remote?`${remote}\trefs/heads/${binding.taskBranch}`:'';
        }
        if(args.includes('push')){
          assert.ok(args.includes('--no-follow-tags'));
          assert.ok(args.includes('https://github.com/lluzi/himateam_test.git'));
          assert.ok(args.includes(`${head}:refs/heads/${binding.taskBranch}`));
          assert.equal(args.includes('origin'),false);
          remote=head;return '';
        }
      }
      throw Error(`Unexpected external command ${executable} ${args.join(' ')}`);
    }};
    const status=await operateTeamGitHub(root,binding,{action:'status'},port) as {remoteHead?:string};
    assert.equal(status.remoteHead,undefined);
    await assert.rejects(operateTeamGitHub(root,binding,{action:'push-task-branch'},port,async()=>{throw Error('revoked before push');}),/revoked before push/);
    assert.equal(remote,undefined);
    const pushed=await operateTeamGitHub(root,binding,{action:'push-task-branch'},port) as {headCommit:string;state:string};
    assert.equal(pushed.headCommit,head);assert.equal(pushed.state,'pushed');
    assert.equal((await operateTeamGitHub(root,binding,{action:'push-task-branch'},port) as {state:string}).state,'already-pushed');
    await assert.rejects(operateTeamGitHub(root,binding,{action:'open-pr',testsCommit:head,reviewCommit:'0'.repeat(40),tests:'1/1 PASS',review:'old review',remaining:'none'},port),/exact PR head commit/);
    await assert.rejects(operateTeamGitHub(root,binding,{action:'open-pr',testsCommit:head,reviewCommit:head,tests:'1/1 PASS',review:'independent review PASS',remaining:'none'},port,async()=>{throw Error('revoked before PR');}),/revoked before PR/);
    assert.equal(created,0);
    const first=await operateTeamGitHub(root,binding,{action:'open-pr',testsCommit:head,reviewCommit:head,tests:'1/1 PASS',review:'independent review PASS',remaining:'none'},port) as {url:string;state:string};
    assert.equal(first.url,pr?.url);assert.equal(first.state,'created');assert.match(body,new RegExp(head));
    assert.match(body,/Closes https:\/\/github\.com\/lluzi\/himateam_test\/issues\/1/);
    const repeat=await operateTeamGitHub(root,binding,{action:'open-pr',testsCommit:head,reviewCommit:head,tests:'1/1 PASS',review:'independent review PASS',remaining:'none'},port) as {state:string};
    assert.equal(repeat.state,'existing');assert.equal(created,1);
  } finally {await rm(root,{recursive:true,force:true});}
});

test('a lead can read the developer branch in an independent checkout and fast-forward to a new reviewed head', async () => {
  const root=await mkdtemp(path.join(os.tmpdir(),'hima-team-review-'));
  const seed=path.join(root,'seed'),bare=path.join(root,'remote.git'),member=path.join(root,'lead');
  try {
    await git(root,'init','-q','-b','main',seed);
    await git(seed,'config','user.name','Hima Test');await git(seed,'config','user.email','hima-test@example.invalid');
    await writeFile(path.join(seed,'README.md'),'base\n');await git(seed,'add','README.md');await git(seed,'commit','-qm','base');
    const baseCommit=await git(seed,'rev-parse','HEAD');
    await git(root,'clone','-q','--bare',seed,bare);
    await git(seed,'checkout','-q','-b','codex/issue-1');
    await writeFile(path.join(seed,'README.md'),'fix one\n');await git(seed,'commit','-qam','fix one');
    await git(seed,'push','-q',bare,'HEAD:refs/heads/codex/issue-1');
    let remote=await git(seed,'rev-parse','HEAD');
    const binding={repository:'lluzi/himateam_test',issueNumber:1,issueUrl:'https://github.com/lluzi/himateam_test/issues/1',baseCommit,taskBranch:'codex/issue-1'};
    await mkdir(member);
    const port:GitHubCommandPort={async run(executable,args) {
      if(executable==='gh') {
        if(args[0]==='issue')return JSON.stringify({url:binding.issueUrl,title:'Known bug',state:'OPEN'});
        if(args[0]==='repo')return JSON.stringify({defaultBranchRef:{name:'main'}});
      }
      if(executable==='git'&&args.includes('ls-remote'))return `${remote}\trefs/heads/${binding.taskBranch}`;
      if(executable==='git'&&args.includes('clone')) {
        const mapped=[...args];mapped[mapped.indexOf('https://github.com/lluzi/himateam_test.git')]=bare;
        const output=(await command('git',mapped,{encoding:'utf8',timeout:10000})).stdout.trim();
        if(!args.includes('--bare'))await git(String(args[args.length-1]),'remote','set-url','origin','https://github.com/lluzi/himateam_test.git');
        return output;
      }
      throw Error(`Unexpected external command ${executable} ${args.join(' ')}`);
    }};
    let checks=0;
    const first=await operateTeamGitHub(member,binding,{action:'checkout'},port,async()=>{checks++;}) as {worktree:string;headCommit:string};
    assert.equal(first.headCommit,remote);assert.equal(await git(first.worktree,'rev-parse','HEAD'),remote);
    assert.ok(checks>=2,'authority is checked before local repository writes');
    await writeFile(path.join(seed,'README.md'),'fix two\n');await git(seed,'commit','-qam','fix two');
    await git(seed,'push','-q',bare,'HEAD:refs/heads/codex/issue-1');remote=await git(seed,'rev-parse','HEAD');
    const updated=await operateTeamGitHub(member,binding,{action:'checkout'},port,async()=>{checks++;}) as {state:string;headCommit:string};
    assert.equal(updated.state,'updated');assert.equal(updated.headCommit,remote);
    assert.equal(await git(first.worktree,'rev-parse','HEAD'),remote);
  } finally {await rm(root,{recursive:true,force:true});}
});

test('task write policy exposes only exact branch push and PR creation', () => {
  const bound = { repository: 'lluzi/himateam_test', issueUrl: 'https://github.com/lluzi/himateam_test/issues/1',
    worktree: '/private/task', baseCommit: 'a'.repeat(40), taskBranch: 'codex/issue-1', headCommit: 'a'.repeat(40) };
  const request = { repository: bound.repository, branch: bound.taskBranch, baseCommit: bound.baseCommit };
  assert.equal(verifyTaskGitHubPolicy(bound, { ...request, action: 'push-task-branch' }), 'push-task-branch');
  assert.equal(verifyTaskGitHubPolicy(bound, { ...request, action: 'open-pr' }), 'open-pr');
  for (const action of ['merge', 'push-protected', 'delete-remote', 'tag', 'release'])
    assert.throws(() => verifyTaskGitHubPolicy(bound, { ...request, action }), /Only task-branch push and PR creation/);
  assert.throws(() => verifyTaskGitHubPolicy(bound, { ...request, action: 'push-task-branch', branch: 'main' }), /must match the frozen/);
  assert.throws(() => verifyTaskGitHubPolicy(bound, { ...request, action: 'open-pr', repository: 'lluzi/other' }), /must match the frozen/);
});
