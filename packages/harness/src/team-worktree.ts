// #106: a software Team task binds one Issue to one isolated Git checkout.
// This is a preflight for the existing Host/Resident path, not a Git credential provider.
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { lstat, realpath } from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';

const git = promisify(execFile);
/** Member-controlled repository reads never inherit the Host's login or provider secrets. */
export const memberGitEnvironment: NodeJS.ProcessEnv = {
  PATH:'/usr/bin:/bin',LANG:'C',HOME:'/var/empty',XDG_CONFIG_HOME:'/var/empty',GH_CONFIG_DIR:'/var/empty',SSH_AUTH_SOCK:'',
  GH_TOKEN:'',GITHUB_TOKEN:'',GIT_CONFIG_NOSYSTEM:'1',GIT_CONFIG_GLOBAL:'/dev/null',GIT_CONFIG_COUNT:'0',
  GIT_TERMINAL_PROMPT:'0',GIT_ASKPASS:'/usr/bin/false',GIT_SSH_COMMAND:'/usr/bin/false',GIT_ALLOW_PROTOCOL:'file',
};
const sha = z.string().regex(/^[a-f0-9]{40}$/);
const branch = z.string().regex(/^codex\/[a-z0-9][a-z0-9-]{0,63}$/);
export const teamGitHubTask = z.strictObject({
  repository: z.string().regex(/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/),
  issueNumber: z.number().int().positive(),
  issueUrl: z.url(),
  baseCommit: sha,
  taskBranch: branch,
});
export type TeamGitHubTask = z.infer<typeof teamGitHubTask>;

export class TeamGitHubPreflightError extends Error {
  constructor(readonly code: 'task-binding'|'worktree'|'repository'|'branch'|'base'|'dirty', message: string) {
    super(message); this.name = 'TeamGitHubPreflightError';
  }
}

function canonicalRemote(raw: string): string | undefined {
  const remote = raw.trim();
  const match = /^(?:https:\/\/github\.com\/|git@github\.com:)([A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+?)(?:\.git)?$/.exec(remote);
  return match?.[1]?.toLowerCase();
}

export function parseTeamGitHubTask(raw: unknown): TeamGitHubTask {
  const parsed = teamGitHubTask.safeParse(raw);
  if (!parsed.success) throw new TeamGitHubPreflightError('task-binding', 'Bind one exact GitHub repository, Issue, base commit and task branch.');
  const value = parsed.data;
  if (value.issueUrl !== `https://github.com/${value.repository}/issues/${value.issueNumber}`)
    throw new TeamGitHubPreflightError('task-binding', 'Issue URL must name the exact task repository and Issue.');
  return value;
}

async function readGit(root: string, ...args: string[]): Promise<string> {
  try {
    const result = await git('/usr/bin/git', ['-c','credential.helper=','-c','core.hooksPath=/dev/null','-c','core.fsmonitor=false','-C', root, ...args],
      { encoding: 'utf8', timeout: 10_000, maxBuffer: 64 * 1024,env:memberGitEnvironment });
    return result.stdout.trim();
  } catch {
    throw new TeamGitHubPreflightError('worktree', 'The task checkout could not be inspected with Git.');
  }
}

export interface TeamRepositoryPreflight {
  readonly repository: string;
  readonly issueUrl: string;
  readonly worktree: string;
  readonly baseCommit: string;
  readonly taskBranch: string;
  readonly headCommit: string;
}

async function inspect(directory:string,raw:unknown,fresh:boolean):Promise<TeamRepositoryPreflight> {
  const binding = parseTeamGitHubTask(raw);
  const worktree = await realpath(directory).catch(() => { throw new TeamGitHubPreflightError('worktree', 'The task worktree is unavailable.'); });
  if (!(await lstat(path.join(worktree, '.git')).catch(() => undefined))?.isFile())
    throw new TeamGitHubPreflightError('worktree', 'Use an independent linked Git worktree for the task.');
  const top = await readGit(worktree, 'rev-parse', '--show-toplevel');
  if (await realpath(top) !== worktree) throw new TeamGitHubPreflightError('worktree', 'The task path must be the worktree root.');
  const remote = canonicalRemote(await readGit(worktree, 'config', '--get', 'remote.origin.url'));
  if (remote !== binding.repository.toLowerCase()) throw new TeamGitHubPreflightError('repository', 'The worktree origin differs from the authorized repository.');
  const currentBranch = await readGit(worktree, 'branch', '--show-current');
  if (currentBranch !== binding.taskBranch) throw new TeamGitHubPreflightError('branch', 'The worktree branch differs from the authorized task branch.');
  const headCommit = await readGit(worktree, 'rev-parse', 'HEAD');
  if (fresh && headCommit !== binding.baseCommit) throw new TeamGitHubPreflightError('base', 'A fresh task worktree must start at the exact recorded base commit.');
  if (!fresh) try { await git('/usr/bin/git', ['-c','credential.helper=','-c','core.hooksPath=/dev/null','-c','core.fsmonitor=false','-C', worktree, 'merge-base', '--is-ancestor', binding.baseCommit, headCommit],
    { timeout: 10_000,env:memberGitEnvironment }); }
  catch { throw new TeamGitHubPreflightError('base', 'The candidate commit does not descend from the recorded base commit.'); }
  if (await readGit(worktree, 'status', '--porcelain=v1', '--untracked-files=all'))
    throw new TeamGitHubPreflightError('dirty', 'The fresh task worktree contains uncommitted or untracked files.');
  return { repository: binding.repository, issueUrl: binding.issueUrl, worktree,
    baseCommit: binding.baseCommit, taskBranch: binding.taskBranch, headCommit };
}

/** Read actual Git state before a Team writer receives this checkout. */
export const preflightTeamRepository = (directory:string,raw:unknown):Promise<TeamRepositoryPreflight> => inspect(directory,raw,true);

/** Recheck the exact clean candidate after the writer commits, before any remote write. */
export const inspectTeamRepositoryForWrite = (directory:string,raw:unknown):Promise<TeamRepositoryPreflight> => inspect(directory,raw,false);

/** Only these operations can be presented to a future Host write adapter. */
export function verifyTaskGitHubPolicy(preflight: TeamRepositoryPreflight, request: { readonly action: string; readonly repository: string; readonly branch?: string; readonly baseCommit?: string }): 'push-task-branch'|'open-pr' {
  if (request.repository !== preflight.repository || request.branch !== preflight.taskBranch || request.baseCommit !== preflight.baseCommit)
    throw new TeamGitHubPreflightError('task-binding', 'GitHub write must match the frozen repository, branch and base commit.');
  if (request.action !== 'push-task-branch' && request.action !== 'open-pr')
    throw new TeamGitHubPreflightError('task-binding', 'Only task-branch push and PR creation are available to this Team task.');
  return request.action;
}
