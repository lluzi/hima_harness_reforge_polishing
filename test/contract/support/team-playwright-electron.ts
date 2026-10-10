// Bounded L3 seam: real Desktop main/Host, driven by Playwright Electron.
// Playwright is supplied by the operator runtime; this does not add a product dependency.
import assert from 'node:assert/strict';
import { execFileSync, type ChildProcess } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import { electronBinary } from './driver.ts';
import { recordTestBoot, repoRoot, type HimaHome } from './dsh-home.ts';
import { freePort } from './boot-host.ts';

// The narrow public API consumed here; runtime loading keeps this optional qualification
// usable without introducing a repository dependency or an absolute type-import path.
interface Locator {
  click(): Promise<void>;
  fill(value: string): Promise<void>;
  selectOption(value: string): Promise<unknown>;
}
export interface TeamPage {
  on(event: 'request', listener: (request: { url(): string; postData(): string | null }) => void): void;
  locator(selector: string): Locator;
  getByRole(role: string, options: { name: string; exact?: boolean }): Locator;
  evaluate<R>(expression: string): Promise<R>;
  waitForFunction(expression: string, arg?: undefined, options?: { timeout: number }): Promise<unknown>;
  reload(): Promise<unknown>;
  screenshot(options: { path: string; fullPage?: boolean; timeout?: number }): Promise<unknown>;
}
interface ElectronApplication {
  firstWindow(options: { timeout: number }): Promise<TeamPage>;
  evaluate<R>(fn: (electron: { BrowserWindow: { getAllWindows(): { hide(): void; showInactive(): void; show(): void; webContents: { setBackgroundThrottling(value: boolean): void } }[] } }) => R): Promise<R>;
  process(): ChildProcess;
  close(): Promise<void>;
}
interface PlaywrightModule {
  _electron: { launch(options: { executablePath: string; args: string[]; cwd: string; env: Record<string, string>; timeout: number }): Promise<ElectronApplication> };
}

const alive = (pid: number): boolean => { try { process.kill(pid, 0); return true; } catch { return false; } };
function descendants(pid: number): number[] {
  const rows = execFileSync('/bin/ps', ['-axo', 'pid=,ppid='], { encoding: 'utf8' }).trim().split('\n')
    .map(row => row.trim().split(/\s+/u).map(Number));
  const owned = new Set([pid]);
  for (let changed = true; changed;) {
    changed = false;
    for (const [child, parent] of rows) if (child && parent && owned.has(parent) && !owned.has(child)) { owned.add(child); changed = true; }
  }
  return [...owned];
}
function redact(text: string): string {
  return text.replace(/([?&]token=)[^\s&]+/gu, '$1[redacted]')
    .replace(/(Bearer\s+)\S+/giu, '$1[redacted]')
    .replace(/((?:api[_-]?key|password|cookieValue|cookie|authorization)["']?\s*[:=]\s*)[^\s,}\n]+/giu, '$1[redacted]');
}

export async function bootTeamPlaywright(home: HimaHome, evidence: string): Promise<{
  page: TeamPage;
  wait(expression: string): Promise<void>;
  dispose(): Promise<void>;
  screenshot(options: { path: string; fullPage?: boolean; timeout?: number }): Promise<void>;
}> {
  const binary = electronBinary();
  if ('missing' in binary) throw new Error(binary.missing);
  const require = createRequire(import.meta.url);
  const playwright = require(process.env.HIMA_PLAYWRIGHT_MODULE ?? 'playwright-core') as PlaywrightModule;
  const userData = path.join(home.home, 'electron-user-data');
  await mkdir(userData, { recursive: true });
  await mkdir(evidence, { recursive: true });
  await writeFile(path.join(userData, 'window-state.json'), JSON.stringify({ width: 1440, height: 960 }));
  const env = Object.fromEntries(Object.entries({ ...home.env, HIMA_NODE: process.execPath,
    HIMA_WORKSPACE: home.workspace, HIMA_USER_DATA: userData, HIMA_DRIVER_DISPLAY: '',
    HIMA_TEST_SILENT_AGENT: '1', BROWSER: 'none', ELECTRON_RUN_AS_NODE: '' })
    .filter((entry): entry is [string, string] => entry[1] !== undefined));
  // Authentication is absent in this no-model scenario, including inherited credentials.
  for (const key of Object.keys(env)) if (/API_KEY|ACCESS_TOKEN|AUTH_TOKEN/u.test(key)) delete env[key];
  recordTestBoot('electron');
  const app = await playwright._electron.launch({ executablePath: binary.at,
    args: [`--remote-debugging-port=${await freePort()}`, path.join(repoRoot, 'packages/desktop/lib/main.js'), '--theme', 'light'],
    cwd: home.workspace, env, timeout: 150_000 });
  const child = app.process();
  let stderr = ''; let stdout = '';
  const teamRequests: { action: string; title?: string }[] = [];
  child.stderr?.on('data', data => { stderr += String(data); });
  child.stdout?.on('data', data => { stdout += String(data); });
  const waitForExit = child.exitCode !== null || child.signalCode !== null ? Promise.resolve()
    : new Promise<void>(resolve => child.once('exit', () => resolve()));
  let disposed = false;
  const dispose = async (): Promise<void> => {
    if (disposed) return;
    const owned = child.pid ? descendants(child.pid) : [];
    const pgFile = path.join(home.home, 'hima/database/data/postmaster.pid');
    const pgPid = Number((await readFile(pgFile, 'utf8').catch(() => '')).split('\n')[0]);
    if (pgPid > 1) owned.push(pgPid);
    await app.close(); // normal before-quit: real Host/DBOS/pools/PG shutdown
    await waitForExit;
    const remaining = owned.filter(alive);
    await writeFile(path.join(evidence, 'electron-stderr.log'), redact(stderr));
    await writeFile(path.join(evidence, 'electron-stdout.log'), redact(stdout));
    await writeFile(path.join(evidence, 'team-request-titles.json'), JSON.stringify(teamRequests, null, 2));
    await writeFile(path.join(evidence, 'cleanup.json'), JSON.stringify({ electronPid: child.pid, ownedPids: [...new Set(owned)], remainingPids: remaining,
      postmasterPidFileRemoved: await readFile(pgFile, 'utf8').then(() => false, () => true) }, null, 2));
    assert.deepEqual(remaining, [], 'owned Electron/Host/PostgreSQL processes must end before removing Home');
    assert.equal(await readFile(pgFile, 'utf8').then(() => false, () => true), true, 'owned PostgreSQL shutdown removed its PID file');
    disposed = true;
  };
  try {
    const page = await app.firstWindow({ timeout: 150_000 });
    page.on('request', request => {
      if (!request.url().endsWith('/hima/api/teams') || request.postData() === null) return;
      try {
        const body = JSON.parse(request.postData()!) as { request?: { action?: string; definition?: { title?: string } } };
        if (body.request?.action === 'save') teamRequests.push({ action: 'save', title: body.request.definition?.title });
      } catch { /* Preserve no raw request, session token or header in evidence. */ }
    });
    // Show only this isolated instance without focus. Hidden Electron input can
    // change DOM values without delivering React changes, so L3 uses a painted window.
    await app.evaluate(({ BrowserWindow }) => { for (const win of BrowserWindow.getAllWindows()) { win.webContents.setBackgroundThrottling(false); win.hide(); win.show = () => undefined; } });
    await app.evaluate(({ BrowserWindow }) => { for (const win of BrowserWindow.getAllWindows()) win.showInactive(); });
    return { page, wait: async expression => { await writeFile(path.join(evidence, 'last-wait.txt'), expression); await page.waitForFunction(expression, undefined, { timeout: 60_000 }); }, dispose,
      screenshot: async options => {
        // Capture only this owned window; hide it immediately after the final frame.
        await app.evaluate(({ BrowserWindow }) => { for (const win of BrowserWindow.getAllWindows()) { win.showInactive(); } });
        try { await page.screenshot(options); }
        finally { await app.evaluate(({ BrowserWindow }) => { for (const win of BrowserWindow.getAllWindows()) win.hide(); }); }
      } };
  } catch (error) { await dispose(); throw error; }
}
