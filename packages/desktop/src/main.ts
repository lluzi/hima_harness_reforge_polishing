// @hima-seam cli direct
// The HimaHarness desktop window: one native window around the hima profile, and nothing else.
//
// The application is still `dsh --profile hima` (D30, ADR-0003). This process starts that host as a
// child, waits until it serves, exchanges its launch token for a session cookie inside the window's
// own session, and loads the page. It adds no UI of its own beyond a native menu, a starting page and
// a failure page, contributes no plugin, patches nothing, and gives the remote page no IPC surface:
// everything the workbench does, it does through the `/hima/api/` routes of ADR-0002, and dsh's chat
// stays inside the page. Closing the window stops the host.
//
// Borrowed, under MIT with attribution in ../THIRD-PARTY-NOTICES.md, from `dataelement/dsh-desktop`
// @ c8c33c4 and `fendouai/deepseek-harness-desktop` @ 2d1b505 (docs/research/2026-09-09-dsh-desktop-shells.md
// §5): the token-on-the-first-navigation rule and the stale-cookie sweep from B's `window-navigation.ts`,
// and from A the shape of the whole thing — one window, a local starting document, navigate when the
// host is ready, no IPC for the remote page. The launch, readiness and stop patterns are in
// `host-launch.ts`, which the contract suite boots hosts with too.
import { app, BrowserWindow, Menu, nativeTheme, screen, shell, type Session } from 'electron';
import type { ChildProcess } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { checkoutRoot, clearReplayOverlay, HIMA_PROFILE, packagedTrialDshHome, prepareHimaHome, resolveDshHome, writeReplayOverlay } from './hima-home.js';
import { launchHimaHost, HostLaunchError, stopChild, type LaunchedHost } from './host-launch.js';
import { LOCAL_SITE_NAME, seedLocalSite } from './local-site.js';
import { startDriver, type DriverSession } from './driver.js';

/** The product's name: the window title, the menu's application name, and what the dock says. */
const APP_NAME = 'HimaHarness';

function applicationVersion(): string {
  const manifest = JSON.parse(readFileSync(path.join(packageDir, 'package.json'), 'utf8')) as { version?: unknown };
  if (typeof manifest.version !== 'string' || manifest.version === '') throw new Error('desktop package.json has no application version');
  return manifest.version;
}

/** The window's own cookie jar, kept apart from anything else Electron might store. */
const SESSION_PARTITION = 'persist:hima-workbench';

/**
 * dsh names its browser-session cookie after the request authority, which includes the port, but
 * cookies are not port-scoped and the cookie lasts thirty days. A fresh port per launch therefore
 * leaves one more `dsh-auth-*` cookie on 127.0.0.1 every time, until the request header grows past
 * what Node will accept and the workbench answers HTTP 431 for ever. So every one of them is swept
 * before each navigation. This is `dataelement/dsh-desktop`'s finding, and it is the single most
 * valuable thing this shell borrowed.
 */
const HOST_COOKIE_PREFIX = 'dsh-auth-';

/** Only loopback is ever swept: a cookie on any other host is not ours to remove. */
const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '::1']);

/** What a driver run, or a start that failed before there was a window to say so in, exits with. */
const EXIT_FAILED = 1;

const here = path.dirname(fileURLToPath(import.meta.url));
const packageDir = path.dirname(here);

/**
 * `--driver`: answer the contract suite's requests on stdin instead of serving a person (D42,
 * ADR-0004). `--site local`: seed the home with the local site and the stand-in flow before the
 * host boots, so a developer's generations take seconds. Only `local` is a site this shell can
 * seed; any other name is refused before anything is prepared, rather than ignored.
 */
const driver = process.argv.includes('--driver');
/**
 * `--theme light|dark`: open the window in that colour scheme whatever the machine is set to.
 *
 * The workbench page follows `prefers-color-scheme` and not a class (`workbench-style.ts`), and in
 * Electron that media query answers `nativeTheme.themeSource` — so this flag is the only way to ask
 * a window for a palette, and it is what `scripts/workbench-screenshot.ts` photographs both of the
 * page's palettes through. Without it the window follows the machine, which is what a person wants
 * and what every other run does. A name that is neither is refused before a window is opened, the
 * way `--site` is, rather than quietly ignored.
 */
const theme = ((argv: readonly string[]): 'light' | 'dark' | undefined => {
  const at = argv.indexOf('--theme');
  if (at === -1) return undefined;
  const named = argv[at + 1];
  if (named !== 'light' && named !== 'dark') {
    process.stderr.write('hima-desktop: --theme takes light or dark\n');
    process.exit(2);
  }
  return named;
})(process.argv);
/**
 * `--replay <fixture> [--replay-override <sidecar>] [--replay-child <log> …]`: boot the host against dsh's keyless replay
 * adapter instead of its DeepSeek one, so a driven window runs a real agent over a fixed model
 * transcript with no API key anywhere (#59).
 *
 * **Driver mode only**, and refused outright otherwise: a person's window is the product, and a
 * product that could be told to fake its model on the command line is a product that could be told
 * to fake it by accident. The flag exists so the contract suite and the live check can drive the one
 * mechanism in this harness a model takes part in; the live check itself passes neither flag, which
 * is how it reaches the real model with the owner's key.
 */
const replay = ((argv: readonly string[]): { file: string; overrideFile?: string; childFiles?: string[] } | undefined => {
  const named = (flag: string): string | undefined => {
    const at = argv.indexOf(flag);
    if (at === -1) return undefined;
    const value = argv[at + 1];
    if (value === undefined || value.startsWith('--')) { process.stderr.write(`hima-desktop: ${flag} needs a file\n`); process.exit(2); }
    return value;
  };
  // Every occurrence, in the order they were given, because the adapter binds child scripts by that
  // order (#62): a scenario with three model sessions in one host names two `--replay-child` files
  // and the second of them is the third session's.
  const eachNamed = (flag: string): string[] => {
    const values: string[] = [];
    for (let at = argv.indexOf(flag); at !== -1; at = argv.indexOf(flag, at + 1)) {
      const value = argv[at + 1];
      if (value === undefined || value.startsWith('--')) { process.stderr.write(`hima-desktop: ${flag} needs a file\n`); process.exit(2); }
      values.push(value);
    }
    return values;
  };
  const file = named('--replay');
  const overrideFile = named('--replay-override');
  const childFiles = eachNamed('--replay-child');
  if (file === undefined) {
    if (overrideFile !== undefined) { process.stderr.write('hima-desktop: --replay-override needs --replay\n'); process.exit(2); }
    if (childFiles.length > 0) { process.stderr.write('hima-desktop: --replay-child needs --replay\n'); process.exit(2); }
    return undefined;
  }
  if (!driver) { process.stderr.write('hima-desktop: --replay is a driver-mode flag; a window a person opens runs the real model route\n'); process.exit(2); }
  return {
    file: path.resolve(file),
    ...(overrideFile === undefined ? {} : { overrideFile: path.resolve(overrideFile) }),
    ...(childFiles.length === 0 ? {} : { childFiles: childFiles.map((f) => path.resolve(f)) }),
  };
})(process.argv);

const site = ((argv: readonly string[]): string | undefined => {
  const at = argv.indexOf('--site');
  if (at === -1) return undefined;
  const named = argv[at + 1];
  if (named === undefined || named.startsWith('--')) { process.stderr.write('hima-desktop: --site needs a site name; the one this shell can seed is local\n'); process.exit(2); }
  if (named !== LOCAL_SITE_NAME) { process.stderr.write(`hima-desktop: --site ${named} is not a site this shell can seed; the one it can is ${LOCAL_SITE_NAME}\n`); process.exit(2); }
  return named;
})(process.argv);

/** A pre-window diagnostic for release triage; it never prepares a home or starts dsh. */
const runtimeInfo = process.argv.includes('--runtime-info');

function nodeSelection(): { readonly source: 'HIMA_NODE' | 'bundled-node24' | 'npm_node_execpath' | 'PATH'; readonly available: boolean } {
  const named = process.env.HIMA_NODE;
  if (named !== undefined && named !== '') return { source: 'HIMA_NODE', available: existsSync(named) };
  if (app.isPackaged) {
    const bundled = path.join(checkoutRoot(), 'node', 'bin', 'node');
    return { source: 'bundled-node24', available: existsSync(bundled) };
  }
  const viaPackageManager = process.env.npm_node_execpath;
  if (viaPackageManager !== undefined && viaPackageManager !== '' && existsSync(viaPackageManager)) return { source: 'npm_node_execpath', available: true };
  return { source: 'PATH', available: true };
}

/**
 * What the shell says about what it did. On stdout for a person, where `pnpm run desktop` shows
 * it; on stderr in driver mode, where stdout carries the driver's answers and nothing else.
 */
function say(line: string): void {
  (driver ? process.stderr : process.stdout).write(`hima-desktop: ${line}\n`);
}

// The application is HimaHarness, and it is named before anything asks: `app.getName()` decides the
// menu's application name and, left to itself, where `userData` goes.
app.setName(APP_NAME);

// `userData` holds the window state, the two local pages and the persistent cookie jar. Where
// Electron would put it depends on how it was started — `Electron` when it is run as
// `electron lib/main.js`, this package's scoped `@hima` name when it finds the manifest first — and
// neither is a directory a person would recognise as the workbench's. So it is named here, once,
// rather than left to that. `HIMA_USER_DATA` moves the whole directory, which is how a driver test
// runs without writing into a developer's own application-data directory. Both are set before
// `whenReady`: afterwards Electron has already resolved the path and opened files inside it.
const userDataOverride = process.env.HIMA_USER_DATA;
app.setPath('userData', userDataOverride !== undefined && userDataOverride !== ''
  ? path.resolve(userDataOverride)
  : path.join(app.getPath('appData'), APP_NAME));

/** Where the window was last time, so it opens where the person left it. */
interface WindowBounds { width: number; height: number; x?: number; y?: number }
const defaultBounds: WindowBounds = { width: 1280, height: 860 };

let host: LaunchedHost | undefined;
/** The dsh child from the moment it is spawned, which is before the host is ready to be loaded. */
let hostChild: ChildProcess | undefined;
let stopping: Promise<number | null> | undefined;

/**
 * The dsh CLI entry this window starts. Resolved from this package's own dependencies, so the window
 * boots the same dsh the bundle and the contract suite were built against.
 */
function dshEntry(): string {
  const require = createRequire(path.join(packageDir, 'package.json'));
  return require.resolve('@deepseek-ai/dsh/lib/bin.js');
}

/**
 * The Node that runs dsh. Not `process.execPath`: that is the Electron binary, whose bundled Node is
 * older than the Node 24 dsh declares, and running a host on it would fail in a way no message here
 * could explain well. `HIMA_NODE` names one explicitly; otherwise the Node that ran the package
 * manager which started us, and otherwise whatever `node` the PATH resolves — which is what a
 * developer running `pnpm run desktop` has. Packaging (which would carry its own Node) is out of
 * scope for this ticket.
 */
function nodeExecutable(): string {
  const named = process.env.HIMA_NODE;
  if (named !== undefined && named !== '') return named;
  // Electron is the window runtime, not the dsh runtime. The trial app carries a
  // separately pinned Node 24 binary because dsh declares Node 24 as its floor.
  if (app.isPackaged) return path.join(checkoutRoot(), 'node', 'bin', 'node');
  const viaPackageManager = process.env.npm_node_execpath;
  if (viaPackageManager !== undefined && viaPackageManager !== '' && existsSync(viaPackageManager)) return viaPackageManager;
  return 'node';
}

if (runtimeInfo) {
  const resourcesRoot = typeof process.resourcesPath === 'string' ? process.resourcesPath : undefined;
  const packagedRoot = checkoutRoot();
  process.stdout.write(`${JSON.stringify({
    isPackaged: app.isPackaged,
    resourcesLayout: resourcesRoot !== undefined && existsSync(path.join(resourcesRoot, 'app', 'profiles', HIMA_PROFILE, 'package.json')),
    packagedRuntimeRoot: resourcesRoot !== undefined && packagedRoot === path.join(resourcesRoot, 'app'),
    node: nodeSelection(),
  })}\n`);
  process.exit(0);
}

/**
 * The directory the host takes as its workspace — the agent's own working directory, not the ledger's
 * home, which dsh reads from `DSH_HOME`.
 *
 * `HIMA_WORKSPACE` names one outright, which is what a driver test uses so a run of it never reaches
 * into the repository. Otherwise the directory the person actually typed the command in: `pnpm run
 * desktop` executes the package's own script with the cwd set to `packages/desktop`, and a workbench
 * whose workspace was the shell's own source directory is not what anybody asked for. `INIT_CWD` is
 * where they invoked it, which is the answer.
 */
function hostWorkspace(): string {
  if (app.isPackaged && (!process.env.HIMA_WORKSPACE || process.env.HIMA_WORKSPACE.trim() === '')) {
    return path.join(app.getPath('userData'), 'workspace');
  }
  return process.env.HIMA_WORKSPACE || process.env.INIT_CWD || process.cwd();
}

/** The environment the host is given: ours, minus the two things Electron adds that would confuse it. */
function hostEnvironment(): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env, NO_COLOR: '1', BROWSER: 'none' };
  // Set for the dsh child by nothing here, and poisonous if it were inherited: a dsh plugin that
  // re-invokes the CLI through the executable running it would boot an Electron app instead.
  delete env.ELECTRON_RUN_AS_NODE;
  return env;
}

const stateFile = (): string => path.join(app.getPath('userData'), 'window-state.json');

/** Which display a driver's window opens on: a name from the environment, else the first display that is not the primary one. */
const DRIVER_DISPLAY_VARIABLE = 'HIMA_DRIVER_DISPLAY';

/**
 * Where a driver's window goes. A suite opens a window per test, and a window that lands on the
 * primary display lands on the person working there. So in driver mode the window is placed on a
 * display of the person's choosing (`HIMA_DRIVER_DISPLAY`, matched against the display's label,
 * case-insensitively) or, absent a choice, on the first display that is not the primary one; a
 * machine with one display keeps the window where it was. The size is the remembered one; the
 * position is the centre of the chosen display's work area, so a remembered position from another
 * screen cannot put the window somewhere no display is.
 */
function requestedDisplayBounds(remembered: WindowBounds): { readonly bounds: WindowBounds; readonly requested: boolean } {
  const displays = screen.getAllDisplays();
  const primary = screen.getPrimaryDisplay();
  const wanted = process.env[DRIVER_DISPLAY_VARIABLE]?.trim().toLowerCase();
  const requested = wanted !== undefined && wanted !== '';
  const chosen = wanted !== undefined && wanted !== ''
    ? displays.find((d) => d.label.toLowerCase().includes(wanted))
    : displays.find((d) => d.id !== primary.id);
  if (chosen === undefined) {
    if (requested) throw new Error(`requested display ${JSON.stringify(process.env[DRIVER_DISPLAY_VARIABLE])} is unavailable; refusing before opening a window or starting a Host`);
    return { bounds: remembered, requested: false };
  }
  const area = chosen.workArea;
  const width = Math.min(remembered.width, area.width);
  const height = Math.min(remembered.height, area.height);
  return { bounds: {
    width,
    height,
    x: Math.round(area.x + (area.width - width) / 2),
    y: Math.round(area.y + (area.height - height) / 2),
  }, requested };
}

function readBounds(): WindowBounds {
  try {
    const held = JSON.parse(readFileSync(stateFile(), 'utf8')) as Partial<WindowBounds>;
    // A remembered size only, and only a sane one: a state file from another screen can put the
    // window somewhere there is no longer a display, and a person would see nothing open at all.
    const width = typeof held.width === 'number' && held.width >= 480 ? Math.round(held.width) : defaultBounds.width;
    const height = typeof held.height === 'number' && held.height >= 360 ? Math.round(held.height) : defaultBounds.height;
    const at = typeof held.x === 'number' && typeof held.y === 'number' ? { x: Math.round(held.x), y: Math.round(held.y) } : {};
    return { width, height, ...at };
  } catch {
    return defaultBounds;
  }
}

function writeBounds(win: BrowserWindow): void {
  try {
    if (win.isDestroyed() || win.isMinimized()) return;
    const [width, height] = win.getSize();
    const [x, y] = win.getPosition();
    mkdirSync(path.dirname(stateFile()), { recursive: true });
    writeFileSync(stateFile(), `${JSON.stringify({ width, height, x, y }, null, 2)}\n`);
  } catch {
    // Where the window was is a convenience; failing to record it must never cost a person their run.
  }
}

/**
 * A local page, written into this app's own data directory and loaded as a `file:` URL.
 *
 * A file rather than a `data:` URL so that every document this window ever loads is one of exactly
 * two origins — this app's files, and the loopback host — which is the whole of the navigation fence
 * below. `userData` is where they are written, and the fence permits a `file:` target only when it
 * resolves inside that directory, so "this app's files" is a place and not a scheme.
 */
function localPage(name: string, title: string, bodyHtml: string): string {
  const at = path.join(app.getPath('userData'), name);
  mkdirSync(path.dirname(at), { recursive: true });
  writeFileSync(at, [
    '<!doctype html><meta charset="utf-8">',
    `<title>${title}</title>`,
    '<style>',
    ':root{color-scheme:light dark}',
    'body{margin:0;padding:48px;font:14px/1.6 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}',
    'h1{font-size:18px;font-weight:600;margin:0 0 12px}',
    'p{margin:0 0 12px;opacity:.75}',
    'pre{white-space:pre-wrap;font:12px/1.5 ui-monospace,SFMono-Regular,Menlo,monospace;background:rgba(127,127,127,.12);padding:12px;border-radius:6px;overflow:auto;max-height:60vh}',
    '</style>',
    bodyHtml,
    '',
  ].join('\n'));
  return at;
}

const escapeHtml = (text: string): string =>
  text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/**
 * Every stale `dsh-auth-*` cookie on the host's own loopback origin, removed before we navigate.
 *
 * @param session - the window's session, which is the cookie jar the page will use.
 * @param origin - the host's origin.
 */
async function clearStaleHostCookies(session: Session, origin: string): Promise<void> {
  const hostname = new URL(origin).hostname;
  if (!LOOPBACK_HOSTS.has(hostname)) return;
  for (const cookie of await session.cookies.get({ url: origin })) {
    if (!cookie.name.startsWith(HOST_COOKIE_PREFIX)) continue;
    await session.cookies.remove(origin, cookie.name).catch(() => undefined);
  }
}

/**
 * The session cookie this window holds for the host: the one `dsh-auth-*` cookie the token exchange
 * left in the window's own jar, handed to a driver test so its route calls carry the session the
 * window uses — the one session, not a second one opened beside it.
 */
async function hostSession(session: Session, origin: string): Promise<DriverSession | undefined> {
  for (const cookie of await session.cookies.get({ url: origin })) {
    if (cookie.name.startsWith(HOST_COOKIE_PREFIX)) return { cookieName: cookie.name, cookieValue: cookie.value };
  }
  return undefined;
}

/**
 * The native menu keeps conversation and Live Run in the same mounted document. The latter
 * activates the client's own dock entry; its button owns session readiness and panel navigation.
 */
function installMenu(win: BrowserWindow): void {
  const goTo = (pathname: string) => (): void => { if (host !== undefined) void win.loadURL(`${host.origin}${pathname}`); };
  const template: Parameters<typeof Menu.buildFromTemplate>[0] = [
    ...(process.platform === 'darwin'
      ? [{ label: APP_NAME, submenu: [{ role: 'about' as const }, { type: 'separator' as const }, { role: 'quit' as const }] }]
      : []),
    {
      label: 'View',
      submenu: [
        { label: 'Conversation', accelerator: 'CmdOrCtrl+1', click: () => {
          if (host !== undefined && new URL(win.webContents.getURL()).pathname === '/') {
            void win.webContents.executeJavaScript(`document.querySelector('[contenteditable="true"]')?.focus()`);
          } else goTo('/')();
        } },
        { label: 'Live Run', accelerator: 'CmdOrCtrl+2', click: () => {
          // Activate the same native-dock entry as the sidebar; preserve the mounted conversation.
          void win.webContents.executeJavaScript(`document.querySelector('button[data-hima-control="open-workbench"]')?.click()`);
        } },
        { type: 'separator' },
        { label: 'Reload', accelerator: 'CmdOrCtrl+R', click: () => { win.webContents.reload(); } },
        { label: 'Toggle Developer Tools', accelerator: process.platform === 'darwin' ? 'Alt+Cmd+I' : 'Ctrl+Shift+I', click: () => { win.webContents.toggleDevTools(); } },
        { type: 'separator' },
        { role: 'resetZoom' }, { role: 'zoomIn' }, { role: 'zoomOut' },
        ...(process.platform === 'darwin' ? [] : [{ type: 'separator' as const }, { role: 'quit' as const }]),
      ],
    },
    { label: 'Edit', submenu: [{ role: 'undo' }, { role: 'redo' }, { type: 'separator' }, { role: 'cut' }, { role: 'copy' }, { role: 'paste' }, { role: 'selectAll' }] },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

/**
 * The window's navigation fence: this app's own files and the one loopback host, and nowhere else. A
 * link in the page that points outside both opens in the person's browser, where a link belongs; it
 * never navigates the workbench away from itself.
 *
 * "This app's own files" is the two pages `localPage` writes, so a `file:` target is permitted only
 * when it resolves inside this app's `userData` directory — the directory those pages are written
 * into, and the one directory this shell owns. Every other local file is denied, in both handlers.
 * The scheme alone is not the fence: `setWindowOpenHandler` calls `win.loadURL` from the main
 * process, where Chromium's own http→file block does not apply, so a `window.open('file:///…')`
 * from the model-authored content this window renders would otherwise load any file on the machine
 * into the workbench. ADR-0003 rests the fence on exactly two origins; this is that, spelled out.
 */
function fenceNavigation(win: BrowserWindow, allowedOrigin: () => string | undefined): void {
  const permitted = (target: string): boolean => fenceVerdict(target, allowedOrigin()).permitted;
  // Only a scheme a browser would follow is handed to the person's browser: `shell.openExternal` asks
  // the operating system to open whatever it is given, and a page's link is the page's, not ours.
  const openOutside = (target: string): void => {
    if (/^https?:$/u.test(new URL(target, 'http://invalid.invalid').protocol)) void shell.openExternal(target);
  };
  win.webContents.setWindowOpenHandler(({ url }) => {
    // A `target="_blank"` inside dsh's own app is still the workbench asking to go somewhere in the
    // workbench: this window is the only surface there is, so a permitted URL navigates it rather
    // than being dropped on the floor, which is what returning `deny` alone used to do.
    if (permitted(url)) void win.loadURL(url);
    else openOutside(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (event, url) => {
    if (permitted(url)) return;
    event.preventDefault();
    openOutside(url);
  });
  // The remote page gets no permission it has to be granted: nothing here asks for one.
  win.webContents.session.setPermissionRequestHandler((_contents, _permission, callback) => { callback(false); });
}

/**
 * The fence's answer for one target: permitted, or refused in the fence's own words. One verdict
 * for the two navigation handlers and for the driver's `open`, so what the driver refuses is what
 * the window refuses, said the same way.
 *
 * @param target - the URL the page, or the driver, asked to go to.
 * @param allowedOrigin - the host's origin, once there is a host.
 * @returns the verdict, with the reason when it is a refusal.
 */
function fenceVerdict(target: string, allowedOrigin: string | undefined): { readonly permitted: true } | { readonly permitted: false; readonly reason: string } {
  const permits = `it permits the host's origin ${allowedOrigin ?? '(no host yet)'} and this app's own pages under ${app.getPath('userData')}, and nothing else`;
  /** Is this resolved local path inside the app's own data directory? */
  const underUserData = (parsed: URL): boolean => {
    let target: string;
    try {
      // Percent-decoding and UNC shapes are `fileURLToPath`'s business; a URL it will not convert to
      // a local path (`file://some-host/share`) is not one of ours and throws its way to `false`.
      target = path.resolve(fileURLToPath(parsed));
    } catch {
      return false;
    }
    const root = path.resolve(app.getPath('userData'));
    return target === root || target.startsWith(root + path.sep);
  };
  // Origins, parsed, never a string prefix. `http://127.0.0.1:51234@evil.example/` starts with the
  // host's origin and is a request to `evil.example`; a fence that compared prefixes would let the
  // workbench navigate itself to an arbitrary remote page, still titled HimaHarness because the
  // title is pinned in `start`. A target that does not parse as a URL is not one we can vouch for,
  // so it is refused.
  let parsed: URL;
  try {
    parsed = new URL(target);
  } catch {
    return { permitted: false, reason: `${JSON.stringify(target)} does not parse as a URL, and this window's fence ${permits}` };
  }
  if (parsed.protocol === 'file:') {
    return underUserData(parsed) ? { permitted: true } : { permitted: false, reason: `${parsed.href} is outside this window's fence: ${permits}` };
  }
  if (allowedOrigin !== undefined && parsed.origin === allowedOrigin) return { permitted: true };
  return { permitted: false, reason: `${parsed.href} is outside this window's fence: ${permits}` };
}

/**
 * Stop the host, once, however the app is ending.
 *
 * The child, not `host`: a boot takes seconds and can take the whole timeout, and a person who
 * closes the window inside that window would otherwise leave a dsh running with nothing left to stop
 * it — holding the home's session lock, so the *next* launch fails for a reason its message cannot
 * explain. `launchHimaHost` hands the child over the instant it is spawned, and that is what this
 * stops: SIGTERM, four seconds, then SIGKILL, the same way whichever end of the boot we are at.
 */
function stopHost(): Promise<number | null> {
  const child = host?.child ?? hostChild;
  if (child === undefined) return Promise.resolve(null);
  stopping ??= stopChild(child);
  return stopping;
}

async function start(): Promise<void> {
  if (theme !== undefined) nativeTheme.themeSource = theme;
  // An explicit display is an operator safety request in either driver or ordinary
  // release mode. Resolve it before BrowserWindow/Host work so it never degrades to
  // the primary display when Catsights disappears.
  const placement = (driver || process.env[DRIVER_DISPLAY_VARIABLE]?.trim())
    ? requestedDisplayBounds(readBounds())
    : { bounds: readBounds(), requested: false };
  const win = new BrowserWindow({
    ...placement.bounds,
    title: APP_NAME,
    // A driver's window is shown once the page is up, and without taking focus; see the end of `start`.
    show: !(driver || placement.requested),
    backgroundColor: '#111827',
    icon: path.join(packageDir, 'assets/icon.png'),
    webPreferences: {
      partition: SESSION_PARTITION,
      // The page is dsh's own web app, loaded over the network from a host we started. It gets the
      // renderer Chromium gives any web page and no more: no Node, no preload bridge, no IPC.
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
    },
  });
  installMenu(win);
  fenceNavigation(win, () => host?.origin);
  // The window is HimaHarness's, whatever the page inside it calls itself. Left alone, Chromium
  // renames the window from the loaded document's <title>, and dsh's own web app titles itself
  // "DeepSeek Harness" — so the workbench a person opened would be labelled as somebody else's
  // product, and D39's "one window titled HimaHarness" would hold for a second and then stop.
  win.on('page-title-updated', (event) => { event.preventDefault(); });
  win.on('resize', () => { writeBounds(win); });
  win.on('move', () => { writeBounds(win); });
  win.on('close', () => { writeBounds(win); });
  // Closing the window ends the app, on every platform including macOS: the host is this window's
  // child, and a workbench with no window is a licence-holding job nobody can see.
  win.on('closed', () => { app.quit(); });

  await win.loadFile(localPage('starting.html', `${APP_NAME} — starting`, `<h1>Starting ${APP_NAME}…</h1><p>Booting the hima profile.</p>`));

  // The home comes before the host, because a host has nothing to boot without it. `pnpm run desktop`
  // on a machine that has never run HimaHarness used to open a window containing dsh's own "profile
  // \"hima\" does not exist" — the four steps that fix it existed only inside the contract suite's
  // support code. Now they are one module, this runs them, and it says what it did on the way past.
  const env = hostEnvironment();
  // A trial never adopts an existing ~/.dsh ledger. A reviewer can still opt
  // into a prepared home explicitly, which is how pilot validation is run.
  if (app.isPackaged && (env.DSH_HOME === undefined || env.DSH_HOME.trim() === '')) {
    env.DSH_HOME = packagedTrialDshHome(app.getPath('userData'), applicationVersion());
    env.DSH_AGENTS_HOME = path.join(env.DSH_HOME, 'agents');
  }
  try {
    const prepared = await prepareHimaHome({ home: resolveDshHome(env) });
    for (const line of [`DSH_HOME is ${prepared.home}`, ...prepared.did]) say(line);
    // `--site local`: the same home gets the local site, the stand-in flow and the shipped pack, so
    // the window that opens can run a generation in seconds. Seeded before the host boots, because
    // the host reads its sites and packs from the home it boots from.
    if (site === LOCAL_SITE_NAME) {
      const seeded = await seedLocalSite({ home: prepared.home, checkout: checkoutRoot() });
      for (const line of seeded.did) say(line);
    }
    // The model stand-in, last, so it sits on top of everything the home was just given — and
    // removed when this boot was given none, so a second boot of one home never runs against the
    // transcript the boot before it left behind (#59).
    if (replay === undefined) { const cleared = await clearReplayOverlay(prepared.home); if (cleared !== undefined) say(cleared); }
    else say(await writeReplayOverlay(prepared.home, replay));
  } catch (err) {
    await showFailure(win, 'The hima profile could not be prepared', 'The window has nothing to boot. This is what went wrong:', String(err));
    return;
  }

  try {
    mkdirSync(hostWorkspace(), { recursive: true });
    host = await launchHimaHost({
      dshEntry: dshEntry(),
      node: nodeExecutable(),
      cwd: hostWorkspace(),
      env,
      profile: HIMA_PROFILE,
      // Published the moment it is spawned, not when it is ready: see `stopHost`.
      onSpawn: (child) => { hostChild = child; },
    });
  } catch (err) {
    // Quitting mid-boot ends the child, which ends the launch in here: that is the person leaving,
    // not a failure to report to them.
    if (quitting) return;
    // A host that failed to boot says why *in the window*. Its stderr in a console nobody opened is
    // the failure mode this shell exists to avoid: the window is the only surface there is.
    const said = err instanceof HostLaunchError ? `${err.reason}\n\n--- stdout ---\n${err.stdout}\n--- stderr ---\n${err.stderr}` : String(err);
    await showFailure(win, 'The hima profile did not start', 'Nothing is running. This is what dsh said:', said);
    return;
  }
  watchHostExit(win, host);

  // Only `GET /?token=…` trades the launch token for the session cookie, so the very first navigation
  // has to be the tokened URL; every later request in this window carries the cookie Chromium kept.
  // The sweep goes first, for the reason `HOST_COOKIE_PREFIX` states.
  await clearStaleHostCookies(win.webContents.session, host.origin);
  await win.loadURL(host.url);

  if (driver) {
    // Shown, so a screenshot captures a painted page, but without taking focus: a suite run must not
    // steal a person's keyboard. A click focuses the window when it needs to.
    const running = host;
    startDriver({
      win,
      host: { url: running.url, origin: running.origin },
      session: () => hostSession(win.webContents.session, running.origin),
      // The fence's words for what the fence refuses; for the one thing the fence permits that the
      // driver still does not open — this app's own local pages — the driver's own.
      refusal: (target) => {
        const verdict = fenceVerdict(target, running.origin);
        return verdict.permitted ? `${target} is one of this app's own pages, and the driver opens paths under the host's origin ${running.origin} only` : verdict.reason;
      },
      quit: () => { app.quit(); },
      // The driver's own lines go where the shell's do: stderr, which in driver mode is the one
      // place a test reads back what happened inside the window.
      note: say,
      input: process.stdin,
      output: process.stdout,
    });
    win.showInactive();
    return;
  }
  if (placement.requested) { win.showInactive(); return; }
  win.show();
}

/**
 * A failure, shown where the person is looking.
 *
 * There is no console in a windowed application and no second window to open, so everything that
 * went wrong is put on the page — which is the whole reason ADR-0003 gives for the shell existing at
 * all. A driver run has a console, and gets it there instead, with a non-zero exit: a test must
 * never wait on a window that is showing an error to nobody.
 *
 * @param win - the window to show it in.
 * @param heading - what failed, in a few words.
 * @param lead - the sentence above the detail.
 * @param said - what was said: stderr, an exit code, an error.
 */
async function showFailure(win: BrowserWindow, heading: string, lead: string, said: string): Promise<void> {
  if (driver) {
    process.stderr.write(`hima-desktop: ${heading}\n${said}\n`);
    await stopHost();
    app.exit(EXIT_FAILED);
    return;
  }
  if (win.isDestroyed()) return;
  await win.loadFile(localPage(
    'host-failed.html',
    `${APP_NAME} — ${heading.toLowerCase()}`,
    `<h1>${escapeHtml(heading)}</h1><p>${escapeHtml(lead)}</p><pre>${escapeHtml(said)}</pre>`,
  ));
}

/** The tail of what a process said, which is the part that explains why it stopped. */
function lastLines(text: string, count: number): string {
  const lines = text.split('\n');
  return lines.length <= count ? text : lines.slice(-count).join('\n');
}

/**
 * A host that dies after it booted is shown, the same way one that never booted is.
 *
 * D39 and ADR-0003 make "the workbench is open" and "a host is running" one fact, and until this
 * existed that held in one direction only: closing the window stopped the host, but a host that died
 * mid-campaign left the window showing the last page it had rendered, with the card's fetches
 * failing as `hima/unreachable` and nowhere saying why. The window is the only surface there is, so
 * the exit code and the tail of the host's own stderr go on it.
 *
 * @param win - the window showing that host's page.
 * @param running - the host to watch.
 */
function watchHostExit(win: BrowserWindow, running: LaunchedHost): void {
  running.child.once('exit', (code, signal) => {
    // Our own stop, or the app on its way out. Both are the host ending because we ended it.
    if (quitting || stopping !== undefined) return;
    const ended = signal === null ? `exit code ${String(code)}` : `signal ${signal}`;
    void showFailure(
      win,
      'The hima profile stopped',
      `The host this window started ended with ${ended}. Nothing is running, and the page this window was showing is no longer live. This is the end of what dsh said:`,
      lastLines(running.stderr(), 40) || '(the host printed nothing on stderr)',
    );
  });
}

app.on('window-all-closed', () => { app.quit(); });
// Quitting waits for the host: a SIGTERM sent as the process is exiting is a SIGTERM that may not
// arrive, and this host holds a session lock and an append-only writer.
let quitting = false;
app.on('before-quit', (event) => {
  if (quitting || (host === undefined && hostChild === undefined)) return;
  quitting = true;
  event.preventDefault();
  void stopHost().finally(() => { app.quit(); });
});
// Ctrl+C on `pnpm run desktop` must stop the host too, not only this process: the default handling
// of these signals ends Electron without `before-quit`, which would leave a dsh child — and whatever
// it holds on a Site — running with nothing left to stop it.
for (const signal of ['SIGINT', 'SIGTERM'] as const) process.on(signal, () => { app.quit(); });

// A second instance would start a second host against the same dsh home, which holds a session lock:
// the window that is already open is the answer, not another one. A driver's window is a test's own,
// on a test's own home, and several of them run at once.
if (!driver && !app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    const [open] = BrowserWindow.getAllWindows();
    if (open) { if (open.isMinimized()) open.restore(); open.focus(); }
  });
  app.whenReady().then(start).catch((err: unknown) => {
    process.stderr.write(`hima-desktop: ${String(err)}\n`);
    app.exit(EXIT_FAILED);
  });
}
