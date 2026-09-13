// L4 Site-only byte-version transfer. No model, EDA, Job or fabricated Campaign state.
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { cpSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { applyWorkspaceRevision, materializeWorkshopRevision, channelFor, loadSite, remoteCommands, clearRemoteCommands, type Site, type Channel } from '@hima/harness';
import { repoRoot } from '../test/contract/support/dsh-home.ts';

const [flag, destination] = process.argv.slice(2);
assert.ok(flag === '--out' && destination && !existsSync(destination), '--out requires a fresh evidence directory');
const out = path.resolve(destination); mkdirSync(out, { recursive: true });
const hash = (bytes: Uint8Array | string) => createHash('sha256').update(bytes).digest('hex');
const siteDirectory = path.join(out, 'site'); mkdirSync(siteDirectory);
cpSync(path.join(repoRoot, 'sites/linglong-aes/site.yml'), path.join(siteDirectory, 'linglong-aes.yml'));
cpSync(path.join(repoRoot, 'sites/linglong-aes/permit.yml'), path.join(siteDirectory, 'permit.yml'));
const site = loadSite(siteDirectory, 'linglong-aes');
const on = channelFor(site);
type PathDecision = { ok: true; absPath: string } | { ok: false; reason: string };
type PathDecisionOperation = (site: Site, asked: string, channel: Channel) => Promise<PathDecision>;
const { decideRead, decideWrite } = await import(new URL('../packages/harness/lib/shell.js', import.meta.url).href) as { decideRead: PathDecisionOperation; decideWrite: PathDecisionOperation };
const workspace = `/data/eda/project/hima_harness/polishing-runs/pls11-bytes-${randomUUID()}`;
const started = Date.now();
const checks: { claim: string; passed: boolean }[] = [];
const check = (claim: string, passed: boolean) => { checks.push({ claim, passed }); assert.ok(passed, claim); };
const read = async (at: string) => {
  const allowed = await decideRead(site, at, on); if (!allowed.ok) throw new Error(allowed.reason);
  return Buffer.from(await on.readFile(allowed.absPath));
};
const writeFixture = async (relative: string, text: string) => {
  const at = path.posix.join(workspace, relative), parent = path.posix.dirname(at);
  const directory = await decideWrite(site, parent, on); if (!directory.ok) throw new Error(directory.reason);
  assert.equal((await on.exec(['mkdir', '-p', '--', directory.absPath])).code, 0);
  const target = await decideWrite(site, at, on); if (!target.ok) throw new Error(target.reason);
  assert.equal((await on.exec(['tee', '--', target.absPath], { stdin: Buffer.from(text) })).code, 0);
};
clearRemoteCommands();
try {
  check('fixture is confined to the authorized polishing-runs root', workspace.startsWith('/data/eda/project/hima_harness/polishing-runs/'));
  await writeFixture('input.txt', 'old input\n');
  await writeFixture('old-workshop/entry.py', 'print(1)\n');
  const changes = [
    { nodeId: 'input', scope: 'workspace' as const, logicalPath: 'input.txt', sourcePath: `${workspace}/input.txt`, beforeSha256: hash('old input\n'), content: 'new input\n' },
    { nodeId: 'algorithm', scope: 'workshop' as const, logicalPath: 'entry.py', sourcePath: `${workspace}/old-workshop/entry.py`, beforeSha256: hash('print(1)\n'), content: 'print(2)\n' },
  ];
  const assets = await applyWorkspaceRevision(site, workspace, 'version-one', changes);
  check('workspace input changed through the real revision writer', (await read(`${workspace}/input.txt`)).toString() === 'new input\n');
  check('historical Workshop executable remained unchanged', (await read(`${workspace}/old-workshop/entry.py`)).toString() === 'print(1)\n');
  for (const asset of assets) {
    check(`${asset.nodeId} before version is retained`, hash(await read(asset.beforeVersionPath)) === asset.beforeSha256);
    check(`${asset.nodeId} after version is retained`, hash(await read(asset.afterVersionPath)) === asset.afterSha256);
  }
  assert.deepEqual(await applyWorkspaceRevision(site, workspace, 'version-one', changes), assets);
  check('repeating the same revision is byte-idempotent', true);
  await materializeWorkshopRevision(site, assets, `${workspace}/new-workshop`);
  check('new private Workshop received only the accepted version', (await read(`${workspace}/new-workshop/entry.py`)).toString() === 'print(2)\n');
  const commands = remoteCommands();
  check('no deletion, EDA wrapper or Job was requested', !commands.some(command => ['rm', 'tmux', '/usr/local/bin/eda', 'edarun'].includes(command.argv[0]!)));
  const evidence = { status: 'passed', scope: 'real SSH/Permit byte-version preservation and materialization only; no Agent/Campaign execution or EDA result claim', site: site.name,
    workspace, startedAt: new Date(started).toISOString(), wallTimeMs: Date.now() - started, modelRequests: 0, edaJobs: 0, assets, checks, commands };
  writeFileSync(path.join(out, 'evidence.json'), JSON.stringify(evidence, null, 2) + '\n');
  process.stdout.write(`revision files PASS; ${checks.length} checks; ${Date.now() - started} ms; no model/EDA\n`);
} catch (error) {
  writeFileSync(path.join(out, 'evidence.json'), JSON.stringify({ status: 'failed', workspace, checks, commands: remoteCommands(), error: String(error) }, null, 2) + '\n');
  throw error;
}
