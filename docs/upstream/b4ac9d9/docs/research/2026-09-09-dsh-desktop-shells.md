# Two existing open-source desktop shells for dsh: can HimaHarness borrow one?

Date: 2026-09-09. Scope: primary sources only — the two repositories' own files read at pinned commits, the GitHub REST API for metadata, and the upstream `deepseek-ai/deepseek-harness` source at `dsh-v0.1.5-alpha.1` where a claim about dsh's own behaviour is load-bearing. No blog posts, no release-page prose beyond the asset table, no third-party summaries. Every line below carries its source tag; `*(inferred)*` marks an engineering judgment of mine rather than a quoted fact.

Pinned refs: **A** = `fendouai/deepseek-harness-desktop` @ `2d1b5051599bd6aafd286f73493521b5d433fed4` (default branch `master`, last commit 2026-08-15) [M1]; **B** = `dataelement/dsh-desktop` @ `c8c33c423b5e8edd03d69ee0640f42e24fe1f7a5` (default branch `main`, last commit 2026-09-09) [M2]; **U** = `deepseek-ai/deepseek-harness` @ `5dda764ed3aa172535a7967b06ff95d9cbfe536a` (= tag `dsh-v0.1.5-alpha.1`), the same ALPHA commit used in `2026-09-08-dsh-architecture-and-integration.md`. API metadata read 2026-09-09.

Both repositories exist and both are real desktop shells for dsh. They are, however, almost opposites: **A is a ~250-line Tauri host living inside a stale fork of the whole harness monorepo; B is a 2,900-line Electron product that vendors and patches 243 dsh tarballs.** Neither is installable as a dependency. The recommendation is at §7.

---

## 1. The dsh-side facts the comparison turns on

These are properties of dsh itself at 0.1.5-alpha.1, established first because both shells are judged against them.

- The `web` app parses `--host`, `--port`, repeatable `--trusted-host`, and `--no-open`; `dsh web` "is a hardcoded alias for `--profile web`", `--no-open` "disables the default-browser handoff for this invocation", and the CLI "intentionally does not support `--host 0.0.0.0` and exits with a usage error" (`apps/cli/reference/README.md` L36, L79, L89) [U1].
- Default is `http://127.0.0.1:3080`; `port` 0 "requests an OS-assigned port; `ctx.webServer.port` reads the listening port afterwards" (`packages/host/webserver/README.md` L39) [U2].
- **The readiness line.** `packages/bundle/web-app/src/index.ts` L271 prints, after the Loader tree settles:
  `console.log(\`dsh web: ${authenticatedUrl}${lanUrl === undefined ? '' : \` (LAN: ${lanUrl})\`}\`)` [U3].
  When the browser handoff is enabled it then prints a *second* line with the same `dsh web: ` prefix — `'dsh web: opening the default browser; pass --no-open to disable'` (L274) [U3]. Any stdout scraper must tolerate two `dsh web: ` lines and an optional ` (LAN: …)` suffix on the first.
- **The token.** `authenticatedUrl(baseUrl)` forces `pathname='/'`, clears search and hash, and sets `?token=<per-process launch token>` (`packages/client/connection/src/browser-auth.ts` L223–230) [U4]. The token is 32 random bytes base64url, minted once per process (L52–58, L20) [U4].
- **The 303 and the cookie.** `authorizeIndex` accepts the token only on `GET /` with exactly one `token` param and a resolvable authority, then `res.writeHead(303, {'cache-control':'no-store', 'location':'/', 'referrer-policy':'no-referrer', 'set-cookie': …})` (L240–265) [U4]. The cookie name is `dsh-auth-` + base64url(sha256(authority)) (L107, L16); its attributes are `Max-Age=…; Path=/; Expires=…; HttpOnly; SameSite=Strict` (L121–122) [U4]. An already-authenticated `GET /?token=…` also gets a 303 to clean `/` (L267–274) [U4].
- The README states the policy in words: "Each process mints a random launch token. `dsh-web-app` prints and opens the ordinary root URL with `?token=...`; `frontend-static` delegates root and index requests to `ctx.connection.authorizeIndex`, which accepts that token only on `GET /`, writes an authority-bound signed cookie, and redirects to clean `/`. A missing, expired, malformed, or wrong-authority cookie returns 401 before RPC dispatch. Static assets remain public. The HTTP carrier accepts no query token outside the root exchange and no Authorization-header token." Cookies default to 30 days via `cookieMaxAgeDays` and "bind the normalized hostname plus port in both their deterministic name and signed payload" (`packages/client/connection/README.md` L35, L37) [U5].
- The signing secret is the `client-connection/browser-session` credential record, persisted by the local provider in `$DSH_HOME/.credentials.yaml` [U5]. *(inferred)* This is why a desktop shell that redirects `DSH_HOME` gets a fresh secret, and why deleting that file invalidates every outstanding cookie.
- Host/Origin fence: "`Host` must be loopback or match a `trustedHosts` entry … A failed Host/Origin check returns 403, while a trusted but unauthenticated request returns 401." [U5]

The owner's premise is therefore correct in every particular: a 303 with a session cookie, minted only by `GET /?token=…`.

---

## 2. Repository A — `fendouai/deepseek-harness-desktop`

### 2.1 What it is

| Fact | Value | Source |
|---|---|---|
| Kind | **A fork of `deepseek-ai/deepseek-harness`** (`"fork": true`, `parent`/`source` = `deepseek-ai/deepseek-harness`), not a standalone shell repository | [M1] |
| Shell technology | **Tauri 2** — `tauri = "2.11.5"`, `tauri-build = "2.5.3"`, `tauri-plugin-shell = "2.3.5"`, `url = "2.5.7"`; `@tauri-apps/cli` `2.11.4` | `apps/desktop/src-tauri/Cargo.toml`, `apps/desktop/package.json` [A1] [A2] |
| Languages | Rust (edition 2024, `rust-version = "1.85"`) for the shell; one static HTML file; Node for the prepare script. Repo language stats are the harness's (TypeScript 23.8 MB, Rust only 5,588 bytes) | [A1] [M1] |
| Shell size | **~250 lines of new code total**: `src-tauri/src/lib.rs` 164 lines / 5,507 bytes, `src-tauri/src/main.rs` 3 lines, `scripts/prepare-runtime.mjs` 96 lines, plus 5 config files and a 23-line `ui/index.html` | [A3] [A4] [A5] [A6] |
| Packaging | `bundle.targets: "all"`, `externalBin: ["binaries/dsh-node"]`, `resources: ["runtime/**/*"]`; a `tauri.macos.conf.json` override sets `targets: ["app"]` but the `build` script never passes `--config`, so it is dead as written *(inferred)* | `src-tauri/tauri.conf.json`, `tauri.macos.conf.json`, `apps/desktop/package.json` [A2] [A7] [A8] |
| Shipped artifact | One release, `v0.1.0-rc.5`, published 2026-08-14, `prerelease: true`, **one asset**: `DeepSeek-Harness_0.1.0-rc.5_aarch64.dmg`, 104,421,245 bytes (≈99.6 MiB). Apple Silicon only; no x64, no Windows, no Linux | [M3] |

### 2.2 How it reaches dsh

It **spawns the dsh CLI as a Tauri sidecar**, with a bundled Node it ships itself.

- `app.shell().sidecar("dsh-node").args([entry, "web", "--port", "0"]).env("DSH_HOME", dsh_home).env("DSH_DESKTOP", "1")` — `lib.rs` L49–56 [A3]. `entry` = `<resource_dir>/runtime/lib/bin.js`, checked to exist first (L38–40, L81–87) [A3].
- Profile: the **`web` alias**, not `--profile <name>` (L53) [A3].
- **It does not pass `--no-open`** [A3]. Against 0.1.5-alpha.1 that means dsh also hands the URL to the user's default browser (`config.openBrowser` defaults `true`, suppressed only by `--no-open` or an inherited `SSH_CONNECTION`/`SSH_TTY`) [U3] [U1] — a second, browser-based session opens beside the app window. *(inferred)* This is the single clearest defect to not copy.
- Port: `--port 0`, i.e. dsh asks the OS. No pre-reservation, no probing [A3].
- URL discovery: scrape stdout. `extract_ready_url` splits on lines, `strip_prefix("dsh web: ")`, takes `.split_whitespace().next()`, parses it as a URL, and accepts only `scheme == "http" && host == "127.0.0.1"` (L89–95) [A3]. Partial lines are handled by `retain_unfinished_line` (L97–101) [A3]. Unit tests assert the loopback accept, the non-loopback reject, and the partial-line retention (L141–157) [A3].
- Token and cookie: **no explicit handling at all.** It navigates the window to whatever URL it scraped (L103–117) [A3]. *(inferred)* This happens to be correct against 0.1.5-alpha.1, because the scraped URL *is* `authenticatedUrl` and already carries `?token=` [U3] [U4] — the query survives `Url::parse` and `runtime_url`. It was written against 0.1.0-rc.5, before the token existed: its own test expects the bare `http://127.0.0.1:49152/` (L143) [A3]. And the `.split_whitespace().next()` happens to reject the `opening the default browser…` line, because `opening` fails `Url::parse` [A3] [U3]. Both are luck, not design; neither is tested against a tokenised line.
- No stale-cookie hygiene, no 431 mitigation (contrast §3.2) [A3].
- Shutdown: on `RunEvent::Exit | RunEvent::ExitRequested`, `child.kill()` — an immediate hard kill, no SIGTERM, no grace period, no wait (L30–34, L128–135) [A3].
- Node: `prepare-runtime.mjs` downloads **Node 24.19.0** from `https://nodejs.org/dist/v24.19.0`, verifies it against the published `SHASUMS256.txt`, extracts it, and copies the binary to `binaries/dsh-node-<target-triple>` (L56–95) [A4]. `DSH_NODE_BINARY` overrides it for release jobs; `DSH_DESKTOP_TARGET` selects the triple (L14–19) [A4].

### 2.3 UI it adds

Almost nothing, deliberately. One 1280×820 window (`tauri.conf.json`) [A7]; a static spinner page as the pre-navigation document (`ui/index.html`) [A6]; on failure it rewrites that page's text through `window.eval` (L119–126) [A3]. **No menu, no tray, no settings, no second window, no auto-update, no renderer code of its own.** The architecture note states the boundary: "Workspace selection and all product interaction continue through the existing Web composition." [A9]

Security posture worth stealing: the Tauri capability file is `{"identifier":"main-local-document","local":true,"windows":["main"],"permissions":["core:default"]}` — so the *remotely loaded loopback page* gets no Tauri IPC at all, and "Sidecar launch and shutdown stay in Rust, so the remotely loaded loopback UI cannot invoke arbitrary shell commands through Tauri" [A10] [A5].

### 2.4 dsh version and 0.1.5-alpha.1 compatibility

- Root `package.json` is `@deepseek-ai/dsh-root` at **`0.1.0-rc.5`** [A11]. `apps/desktop/package.json` and `Cargo.toml` carry the same string [A2] [A1].
- It does **not** consume dsh from npm. `prepare-runtime.mjs` runs `pnpm run build` at the repo root, then `pnpm --config.inject-workspace-packages=true --config.dangerously-allow-all-builds=true --config.node-linker=hoisted --filter @deepseek-ai/dsh deploy --prod <runtimeRoot>` (L24–35) [A4]. The runtime is the fork's own workspace, so "which dsh version it targets" is "whatever this fork is", frozen at 0.1.0-rc.5 [A4] [A11].
- Against 0.1.5-alpha.1: the *shell* would still work (URL scrape survives the token, per §2.2), but the missing `--no-open` is a live defect, and the whole thing must be re-forked and rebased onto a five-releases-newer monorepo to run 0.1.5 at all *(inferred)*.

### 2.5 Coupling and macOS notes

- **Repository-only build.** The prepare step assumes it is inside the harness monorepo (`repositoryRoot = resolve(desktopRoot, '../..')`, `pnpm run build`, `--filter @deepseek-ai/dsh deploy`) [A4]. `pnpm run build` at the root is `build:lib:host` + `build:lib:client` + `build:web`, i.e. `tsdown --env.DSH_BUILD_FACE host|client` — the Typert generation step [A11]. There is no path by which an out-of-tree package reuses this.
- `--config.dangerously-allow-all-builds=true` is passed to the deploy install, with a comment that "the already-reviewed dependency closure must opt in again" (L27–35) [A4]. *(inferred)* That flag runs install scripts for the whole closure; a HimaHarness build that copies it inherits that decision.
- The fork also changes harness internals beyond the shell: it adds `packages/client/ui-avatar` (a VRM avatar/voice client plugin, ~1,000 lines), inserts a `ui-avatar` row into `packages/bundle/web-app/cordis.patch.yml`, edits `packages/extensions/cordis-client-runner/src/client/slot-catalog.ts`, and adds 19 `workspace:^` dependencies to `apps/cli/package.json` [A12]. So the *repository* is not a shell — it is a fork with a shell in it.
- **macOS:** `Info.plist` declares `NSMicrophoneUsageDescription` and `NSSpeechRecognitionUsageDescription`; `Entitlements.plist` grants `com.apple.security.device.audio-input` — both for the avatar/voice feature, not for the shell [A13] [A14]. `tauri.conf.json` has **no `signingIdentity`, no notarization config, no hardened-runtime setting**, and the fork adds no CI workflow (the fork's `.github/` is upstream's issue templates; `.gitlab-ci.yml` contains no `desktop`/`tauri`/`sign`/`notar` match) [A7] [A15]. The published DMG is, on the evidence in the repository, unsigned and un-notarized *(inferred — I could not verify the artifact itself; see §8)*.
- The Node binary is bundled as a Tauri `externalBin` sidecar [A7]; on a signed macOS build every such helper needs its own signature, which nothing here provides *(inferred)*.

### 2.6 Project health

10 stars; 0 forks; **issues disabled** (`has_issues: false`, `open_issues_count: 0`); 1 watcher; created 2026-08-14, last push 2026-08-15 — **the desktop work is 10 commits over two days and has not been touched in 25 days** [M1] [M4]. The contributor list returned by the API (21 entries, `tianyicui` 5,235 commits, … `fendouai` 10) is inherited from the fork parent; **`fendouai` is the sole author of every desktop commit** [M4] [M5]. License: MIT, and the `LICENSE` file is upstream's — "Copyright (c) 2026 DeepSeek" [A16]; root `package.json` `"license": "MIT"` [A11]. SPDX: `MIT` [M1].

---

## 3. Repository B — `dataelement/dsh-desktop`

### 3.1 What it is

| Fact | Value | Source |
|---|---|---|
| Kind | Standalone repository (`"fork": false`), authored by DataElement, homepage `https://dshdesktop.com` | [M2] |
| Shell technology | **Electron** — `electron@43.4.0`, `electron-builder@26.15.3`, `electron-vite@5.0.0`, `electron-updater@^6.8.9`, `patch-package@^8.0.1`, `typescript@5.9.3`, `vitest@^4.1.10` | `package.json` [B1] |
| Languages | TypeScript 2.60 MB, JavaScript 2.15 MB, HTML 605 KB, CSS 64 KB, NSIS 2.5 KB | [M6] |
| Main-process size | `src/main/` is 53 files; `src/main/index.ts` alone is **2,895 lines / 110 KB**; `src/main/runtime/harness-runtime.ts` is 29.9 KB; plus `src/preload/` (7 files) and `src/shared/` (2) | [B2] [B3] [B4] |
| Packaging | electron-builder: `appId: io.dsh.desktop`, `productName: "DSH Desktop"`, `asar: false`, `compression: maximum`; mac targets `["dmg","zip"]` with `hardenedRuntime: true`, `gatekeeperAssess: false`, dmg format `UDBZ`; win target `nsis` x64; `publish` = generic provider at `https://dshdesktop.com/updates/latest/` | `package.json` `build` [B1] |
| Shipped artifacts | 39 releases. Latest prerelease `0.8.0-rc.4` (2026-09-08): `dsh-desktop-mac-arm64.dmg` 192,889,983 B (≈184 MiB), `dsh-desktop-mac-x64.dmg` 197,598,363 B, `dsh-desktop-windows-x64-setup.exe` 180,290,352 B, plus `.zip`, `.blockmap`, `latest-mac.yml`, `latest.yml`. Latest stable `v0.7.2` (2026-09-03) | [M7] |

### 3.2 How it reaches dsh

It **spawns a bundled dsh entry through a bundled Node (or an Electron UtilityProcess on macOS)** — never an installed `dsh` on PATH, never an already-running server.

- Argument builder, `harness-runtime.ts` L184–200 [B4]:
  ```ts
  return [
    ...(profile === 'web' ? ['web'] : ['--profile', profile]),
    ...(patchPath ? ['--patch', patchPath] : []),
    // The desktop window is the only intended surface. Without this, Harness
    // hands the same loopback URL to the system browser on every launch.
    '--no-open',
    '--host', '127.0.0.1',
    '--port', String(port)
  ]
  ```
  So: `web` alias for the normal profile, `--profile <name>` for Safe Mode, always `--no-open`, always an explicit loopback host and port, and its own `--patch` overlay [B4].
- Node arguments wrap that with `['--expose-internals', nodeEntryPath, dshEntryPath, ...harnessArgs]` (L277–290) [B4]. `--expose-internals` is granted because "Cordis HMR's `--expose-internals` permission is granted to that isolated process and never to the web renderer" [B5].
- **Port discovery is a pre-reservation, not `--port 0`.** `reservePort()` opens a `net` server on `127.0.0.1:0`, reads `server.address().port`, closes it, and returns the number (L781–797) [B4]. The URL is then `http://127.0.0.1:${port}`, known before the child starts (L383–384) [B4]. *(inferred)* This trades a small TOCTOU race for a URL the shell owns from the first instant — which is what lets it build the mobile bridge and the health probe without waiting on stdout.
- **Token extraction** (L160–182) [B4], with the mechanism spelled out in the doc comment: "Since 0.1.2-alpha.1 the Host authenticates the whole API before dispatch: `dsh-web-app` prints one root URL carrying a per-process token, and only `GET /?token=...` exchanges it for the signed, authority-bound session cookie. API paths and Authorization headers do not accept the token, so every desktop-side consumer — the window and the mobile bridge alike — has to start from this line."
  ```ts
  export function extractLaunchToken(line: string): string | undefined {
    const match = /\bdsh web:\s*(\S+)/u.exec(line)
    if (!match?.[1]) return undefined
    try {
      const token = new URL(match[1]).searchParams.get('token')
      return token === null || token === '' ? undefined : token
    } catch { return undefined }
  }
  ```
  Fed line-by-line from both stdout and stderr with a remainder buffer, first successful parse wins: `this.launchToken ??= extractLaunchToken(line)` (L529–537) [B4].
- **Readiness is token AND HTTP, with a stability window.** `isHarnessStartupProbeHealthy(status, launchToken)` returns `launchToken !== undefined && status >= 200 && status < 500` — "The unauthenticated readiness probe is expected to receive 401, so any non-server-error response is acceptable once the token is available" (L306–320) [B4]. `waitUntilReady` polls `fetch(url, {redirect:'manual', signal: AbortSignal.timeout(1000)})` every 100 ms and requires the healthy state to hold for 500 ms before declaring ready (L799–826, L292–304) [B4]. Timeout is 45 s, or 120 s on Windows (L392–393) [B4].
- **Cookie handling** lives in `window-navigation.ts` [B6]. `desktopHarnessUrl(url, platform, authToken)` sets `?token=` on the first navigation, with the reasoning stated verbatim (L18–24): "Only `GET /?token=...` trades the per-process launch token for the signed session cookie; API paths and Authorization headers refuse it. So the window's first navigation has to carry the token, and Chromium keeps the cookie for every later request on this authority. A reload after the exchange sends a stale token, which the Host redirects to a clean `/` whenever the cookie is still valid."
- **The stale-cookie bug they hit, and the fix** (L46–73) [B6]: "Harness names its browser-session cookie from the request authority, which includes the random port. Cookies themselves are not port-scoped, so every restart otherwise leaves another 30-day cookie for 127.0.0.1 until Chromium eventually sends a header large enough for Node to reject with HTTP 431." `clearStaleHarnessAuthCookies` filters `session.cookies.get({url: origin})` for names starting with `dsh-auth-` and removes them, only for hostnames in `['127.0.0.1','localhost','::1']`, and only when a token is in hand [B6]. It runs *before* every `loadURL` (`index.ts` L991–1010) [B2]. This is a real, non-obvious defect of the random-port + 30-day-cookie combination and matches the upstream cookie naming exactly [U4] [U5].
- `shouldLoadHarnessUrl` skips the navigation entirely when the current URL already has the same origin (L3–11) [B6]; `isAbortedNavigationError` swallows `ERR_ABORTED (-3)` (L75–85) [B6].
- **Shutdown is graceful with an escalation** (`harness-runtime.ts` L510–521) [B4]: `child.kill('SIGTERM')`, race the `exit` event against a 4,000 ms timer, then `child.kill('SIGKILL')` if it is still alive. `stop()` also clears `url` and `launchToken` and closes the log (L493–508) [B4].
- Spawn environment (L233–275) [B4]: `DSH_HOME` set to the app's harness directory, `NO_COLOR=1`, `ELECTRON_RUN_AS_NODE` explicitly stripped, PATH resolved through a login+interactive shell because "launchd … never sources the user's shell profile … This leaves PATH without Homebrew" (L36–49), a Windows-specific case-insensitive PATH lookup (L202–231), `windowsHide: true`, and `detached: true` on Windows so a child's `os.kill(pid,0)` cannot Ctrl+C the desktop app (L247–253) [B4].

### 3.3 UI it adds — a lot, and it does touch dsh's page

Beyond loading the page: a `Tray` with a context menu (`index.ts` L173, L889–906); a full application menu via `Menu.setApplicationMenu` (L2506); a second `BrowserWindow` for mobile pairing (L2554); a custom title bar on Windows via an attached menu view (`windows-menu-view.ts`, `preload/windows-titlebar.ts`); macOS `titleBarStyle:'hidden'` with manually positioned traffic lights (L933–946); close-to-tray; a splash page, a plugin-recovery page, and a Safe Mode page; `electron-updater` auto-update; and **21 `ipcMain.handle` channels** (directory picker, harness restart, market uninstall, safe-mode enter/exit/manage, plugin reset, recovery actions, zoom, theme, about) [B2] [B7].

Renderer security is textbook: `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true`, `webSecurity: true`, a preload bridge (L925–931) [B2]; `isTrustedAppUrl` admits only `file:`, `dsh-recovery:`, and `http:` on `127.0.0.1`/`localhost`, and the only grantable permission is `clipboard-sanitized-write` from a main frame on a harness URL (`security-policy.ts`) [B8].

**It does touch dsh's internals, heavily.** Twenty `patch-package` patches are applied at `postinstall` [B1] [B9], including 68 KB into `dsh-client-ui-workspace`, 47 KB into `dsh-api-session-controller`, 46 KB into `dsh-client-ui-settings-models`, 35 KB into `dsh-client-ui-agent-preset`, 24 KB into `dsh-client-ui-conversation`, plus `dsh-client-modules`, `dsh-client-ui-{chat,deliverables,directory-picker-native,layout,model-selection,sidebar,trajectory}`, `dsh-llm-{deepseek,pi-ai}`, `dsh-session-persistence{,-jsonl}`, `dsh-workspace`, `@deepseek-ai/cordis-plugin-loader`, and a patch that injects five desktop packages into `@deepseek-ai/dsh`'s own `dependencies` [B9] [B10]. Its own `build/dsh-desktop.patch.yml` overlay disables the `ui-brand-official` row and inserts four desktop client plugins plus `dsh-ppt-composer`, and reconfigures `dsh-market` with `allowRestart: false` because "The desktop shell has the real lifecycle authority" [B11]. It also ships an `dsh-desktop-hmr-fallback` plugin because "Harness creates the full Cordis HMR service after boot when no `hmr` service exists, and that service throws without Node's internal module loader — which a packaged Electron app cannot provide, so every signed macOS launch failed profile boot at that step" [B11]. Their own doc names the cost: "tracks unavoidable upstream package changes as reproducible `patch-package` files … making upstream upgrades an explicit compatibility exercise" [B5].

### 3.4 dsh version and 0.1.5-alpha.1 compatibility

- It **vendors the entire dsh dependency set as local tarballs and pins it**: 226 of its 240 runtime dependencies are `@deepseek-ai/*` entries of the form `"file:packages/harness-0.1.2-rc.1/npm-dsh/deepseek-ai-dsh-<pkg>-0.1.2-rc.1.tgz"`; the directory holds **243 tarballs** plus 10 vendored cordis/cosmokit tarballs [B1] [B12].
- The README says so: "DSH Desktop is an early preview built on the rapidly evolving `@deepseek-ai/dsh@0.1.2-rc.1`." [B13]
- Its patch filenames all carry `+0.1.2-rc.1` [B9], and `patch-package` refuses to apply against a different version *(inferred)*.
- Upgrade history in `docs/` stops at `harness-0.1.2-rc.1-upgrade.md`; there is no 0.1.3, 0.1.4, or 0.1.5 upgrade document [B14]. **As of this commit it does not run against 0.1.5-alpha.1**, and moving it there means redoing 20 patches against a tree that changed the session format twice (v2, v3), the `AgentSetup` signature, the `Inbox` API, `persona` → `personaPrefix/personaSuffix`, and the commands attachment vocabulary (§8 of `2026-09-08-dsh-architecture-and-integration.md`).

### 3.5 Coupling a plugin bundle must not inherit

- **Typert / private routes.** The mobile bridge proxies `/api/remote.mux` by constant (`const REMOTE_STREAM_MUX_PATH = '/api/remote.mux'`), plus `/api/status`, `/api/session/stream`, `/api/rpc`, and mints its own `dsh_mobile` cookie — and its own comment records the breakage this style causes: "0.1.2-alpha.1 deleted `dsh-host-apiproxy`, whose string-keyed `/api/<name>` [routes] …" [B15]. `/api/remote.mux` is exactly the API Gateway WebSocket the upstream README says the Gateway owns [U5].
- **A second, LAN-exposed surface.** Bridge + pairing token + optional Cloudflare Quick Tunnel and Pinggy tunnel [B5] [B16]. That is a product decision, not a shell mechanism.
- **Repository-only build steps**: `postinstall` runs `patch-package && node scripts/install-brand-assets.mjs && install-electron --no`; `build` runs `npm run build:market && electron-vite build` [B1].
- **Preset transfer / market / PPT.** `dsh-desktop-preset-transfer` registers on "the Connection fetch-route seam" to replace routes upstream deleted [B11]; `dsh-ppt-composer` and `dsh-ppt` are vendored `.tgz` product bundles [B1].
- Node/pnpm as npm dependencies: `"node": "24.9.0"` and `"pnpm": "10.34.5"` are declared as runtime dependencies, so the app carries its own Node and pnpm [B1]. No `engines` field [B1].

### 3.6 macOS specifics worth knowing

- **The macOS runtime is an Electron `UtilityProcess`, not a spawned Node.** `disclaimed-utility-process.ts` forks the entry with `execArgv:['--expose-internals']`, `stdio:'pipe'`, `serviceName:'DSH Harness'`, and `disclaim: true`, with the reason: "Harness loads user-installed plugins and can launch third-party tools. Keep their TCC requests out of DSH Desktop's responsibility chain in production." [B17] The kill adapter special-cases SIGKILL through `process.kill(pid, 'SIGKILL')` because `UtilityProcess.kill()` takes no signal [B17].
- Because of that, `build/harness-node-entry.mjs` sets `ELECTRON_RUN_AS_NODE=1` when `process.versions.electron !== undefined` — "On macOS Harness runs inside an Electron utility process (TCC responsibility isolation), so `process.execPath` and `argv0` point at the Electron helper instead of a Node binary. Plugins re-invoke the dsh CLI through the executable running them … and without Node mode that child boots as an Electron app, where the leading `--expose-internals` shifts argv and the CLI answers `--profile <name> is required` instead of installing." [B18] *(inferred)* Any Electron-based HimaHarness shell that lets dsh plugins re-invoke the CLI will hit this exact trap.
- **Signing and notarization are real and complete.** `.github/workflows/release.yml` builds on `macos-15` (arm64) and `macos-15-intel`, requires `CSC_LINK`, `CSC_KEY_PASSWORD`, `APPLE_API_KEY_CONTENT`, `APPLE_API_KEY_ID`, `APPLE_API_ISSUER`, `APPLE_TEAM_ID`; builds a dedicated signing keychain (`scripts/prepare-macos-signing-keychain.mjs`), sets `CSC_IDENTITY_AUTO_DISCOVERY: 'false'`, then `codesign --sign "<Developer ID Application>" --timestamp --force` the DMG, `xcrun notarytool submit`, `xcrun stapler staple`, and verifies with `codesign --verify --deep --strict` + `xcrun stapler validate` on both the `.app` and the `.dmg` [B19]. README: "macOS releases are code-signed and notarized by Apple." [B13]
- `asar: false` — the whole `node_modules` ships unpacked, which is why the DMG is ~184 MiB [B1] [M7]. *(inferred)* `asar: false` is likely forced by dsh's pnpm-managed profile installs writing into the app tree.

### 3.7 Project health

4,688 stars; 248 forks; 43 watchers; **76 open issues and 14 open pull requests** (`open_issues_count: 90` counts both); created 2026-08-13, last push 2026-09-09 — actively developed, several commits per day [M2] [M8]. 17 contributors, of whom two dominate (`yaojin3616` 219 commits, `wisdomqin` 148); the remaining 15 have 1–9 each [M9]. Not archived. 39 releases, with stable (`v0.7.2`) and preview (`0.8.0-rc.4`) channels [M7]. License: **MIT**, `LICENSE` is "Copyright (c) 2026 DataElement", `package.json` `"license": "MIT"`, SPDX `MIT` [B20] [B1] [M2]. Attribution note in the README: "DeepSeek Harness and its dependencies remain subject to their respective upstream licenses and trademark policies. DSH Desktop is an independent community desktop application." [B13]

---

## 4. (a) Can either be used as a dependency as is?

**No — neither, and not close.**

| Blocker | A | B |
|---|---|---|
| Published to npm or any registry | No — `"private": true` in `apps/desktop/package.json`; the only artifact is one DMG [A2] [M3] | No — `"private": true` at the root; artifacts are DMG/ZIP/EXE installers [B1] [M7] |
| Buildable outside its own repository | No — `prepare-runtime.mjs` hard-codes `repositoryRoot = <desktop>/../..`, runs the harness's own `pnpm run build`, and deploys the workspace package `@deepseek-ai/dsh` [A4] | No — `postinstall` applies 20 patches keyed to `0.1.2-rc.1` and installs from 243 vendored tarballs [B1] [B9] [B12] |
| Version compatibility with 0.1.5-alpha.1 | Fork frozen at 0.1.0-rc.5; shell logic survives but `--no-open` is missing [A11] [A3] | Hard-pinned to 0.1.2-rc.1 by `file:` deps and patch filenames; no 0.1.3+ upgrade doc [B1] [B9] [B14] |
| Respects "plugin bundle, not a fork" | No — it *is* a fork, and it edits `web-app/cordis.patch.yml`, `slot-catalog.ts`, and `apps/cli/package.json` [A12] | No — it patches 20 dsh packages, including `dsh`'s own `package.json` and built client bundles [B9] [B10] |
| Scope match ("one native window around `dsh --profile hima`") | Close, but the profile is hard-coded to the `web` alias and there is no `--profile` path [A3] | Far larger: tray, menus, mobile bridge + tunnels, auto-update, plugin market, Safe Mode, PPT runtime [B2] [B5] [B11] |

The one thing that *is* directly reusable from A is a `--profile` generalisation of ~40 lines of Rust; the one thing directly reusable from B is ~120 lines of TypeScript across three functions. Both are cheaper to re-derive than to depend on. *(inferred)*

---

## 5. (b) Patterns worth reusing in `packages/desktop`, with file and lines

Ordered by value. B is the better teacher on every dsh-facing concern; A is the better teacher on shell minimalism.

### 5.1 Launch — take B's argument builder, generalised to `--profile hima`

`dataelement/dsh-desktop` `src/main/runtime/harness-runtime.ts` **L184–200** (`buildHarnessArguments`) [B4]. It already has the `web`-alias-versus-`--profile` branch we need inverted, `--patch` for our privacy overlay, `--no-open`, explicit `--host 127.0.0.1`, explicit `--port`. Pair with **L233–275** (`buildHarnessSpawnOptions`) for `DSH_HOME`, `NO_COLOR=1`, stripping `ELECTRON_RUN_AS_NODE`, and the login-shell PATH capture — the last matters on macOS the moment the app is launched from Finder rather than a terminal [B4]. Compare against A's `apps/desktop/src-tauri/src/lib.rs` **L49–56**, which is the same idea in nine lines but **omits `--no-open`** — copy B here, not A [A3] [U3].

### 5.2 Port and URL discovery — take B's pre-reservation, keep A's scraper as a cross-check

B `harness-runtime.ts` **L781–797** (`reservePort`: bind `127.0.0.1:0`, read the port, close, reuse) and **L383–384** (build `http://127.0.0.1:${port}` before spawning) [B4]. This gives our window a URL before dsh prints anything, which we need if we ever want a health page or a "still starting" state that names the address.

A `lib.rs` **L89–101** (`extract_ready_url` + `retain_unfinished_line`) is the cleanest stdout-scraping code of the two, including the partial-line buffer and the loopback-only accept [A3]. *(inferred)* Use B's port reservation as the source of truth and A's scraper only to confirm the port dsh actually bound — because `--port <n>` can still fail, and the readiness line is the only proof it did not.

Watch the two `dsh web: ` lines and the ` (LAN: …)` suffix [U3]: A's `.split_whitespace().next()` and B's `/\bdsh web:\s*(\S+)/u` both survive them by accident. Ours should reject non-URL candidates explicitly and take the first `token`-bearing URL, not the first line.

### 5.3 Token and cookie — take B's, wholesale

`src/main/window-navigation.ts` **L13–39** (`desktopHarnessUrl` — put `?token=` on the *first* navigation only) and **L41–73** (`clearStaleHarnessAuthCookies` — delete every `dsh-auth-*` cookie on the loopback origin before loading) [B6]; the caller sequence is `src/main/index.ts` **L985–1019** (stop, clear cookies, `loadURL`, with a navigation-version guard against races) [B2]. Also **L3–11** (`shouldLoadHarnessUrl`: skip the navigation when the origin is unchanged, so a reload does not re-send a stale token) [B6].

The 431 hazard is the finding to carry into our own design: dsh's cookie name is derived from the authority *including the port*, cookies are not port-scoped, and the default lifetime is 30 days — so a random port per launch accumulates one `dsh-auth-*` cookie per launch on `127.0.0.1` until the request header exceeds Node's limit [B6] [U4] [U5]. *(inferred)* We inherit this the moment we pick a free port ourselves, which the owner's design does.

Readiness gate: B `harness-runtime.ts` **L306–320** (`isHarnessStartupProbeHealthy` — 401 is success once the token is known) and **L799–826** + **L292–304** (`waitUntilReady` with `redirect:'manual'`, 1 s per-request timeout, 100 ms poll, 500 ms stability window, 45 s / 120 s-on-Windows budget) [B4]. `redirect: 'manual'` matters: an automatic redirect follower would consume the 303 and burn the token outside the browser session [U4] *(inferred)*.

### 5.4 Shutdown — B's, not A's

B `harness-runtime.ts` **L510–521** (`stopChild`: SIGTERM, race `exit` against 4 s, then SIGKILL) [B4]. A's `lib.rs` **L128–135** is an unconditional `child.kill()` on `RunEvent::Exit | ExitRequested` with no grace period [A3] — against a dsh that holds a session lock and an append-only JSONL writer, a graceful term is the right default *(inferred)*.

Also worth copying from B: the child-lifecycle guard pattern `if (this.child !== child) return` on every async callback (L445–465, L479) so a superseded launch cannot overwrite the state of the current one [B4]; and the stderr-driven early abort (L423–443) that detects a rejected dsh entry and stops waiting for the HTTP timeout [B4].

### 5.5 Renderer isolation — take from both

A's Tauri capability file `apps/desktop/src-tauri/capabilities/default.json` (whole file, 8 lines): `"local": true` scopes `core:default` to the startup document only, so the remotely-loaded dsh page has no IPC surface [A10] [A5]. B's equivalent is `src/main/security-policy.ts` (whole file, 34 lines: `isTrustedAppUrl`, `canGrantWindowPermission`) plus the `webPreferences` block at `index.ts` **L925–931** [B8] [B2].

### 5.6 macOS specifics — B, if and only if we choose Electron

`src/main/runtime/disclaimed-utility-process.ts` **L17–46** (`disclaim: true`, TCC responsibility isolation) [B17] and `build/harness-node-entry.mjs` **L6–17** (`ELECTRON_RUN_AS_NODE=1` so dsh plugins that re-invoke the CLI do not boot an Electron app) [B18]. If we choose Tauri, A's `scripts/prepare-runtime.mjs` **L56–95** is the checksummed-Node-download pattern (fetch `SHASUMS256.txt`, sha256 the archive, fail on mismatch) [A4] — but note it downloads at build time from `nodejs.org`, which we may want to replace with a vendored binary.

### 5.7 Do not copy

- A: the missing `--no-open` [A3]; `--config.dangerously-allow-all-builds=true` in the deploy step [A4]; the whole `prepare-runtime.mjs` repository-root assumption [A4].
- B: every `patches/*.patch` [B9]; the `/api/remote.mux` proxying [B15]; the `dsh-desktop.patch.yml` row-disabling of `ui-brand-official` [B11]; the LAN/tunnel bridge [B5]. All four are exactly the "coupling to dsh internals a plugin bundle should not depend on" the task asks about.

---

## 6. (c) What the licenses permit and require

Both are **MIT** — SPDX id `MIT` from the GitHub license API for both repositories [M1] [M2], from `LICENSE` in both trees [A16] [B20], and from `"license": "MIT"` in both `package.json`s [A11] [B1].

MIT permits use, copying, modification, merging, publication, distribution, sublicensing and sale, with one condition: "The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software" [A16] [B20]. Practically, for HimaHarness:

- **Copying code or patterns from either into `packages/desktop` is permitted**, including into a closed distribution.
- **The requirement is attribution retention.** If we copy a substantial portion (B's `window-navigation.ts` functions, B's `harness-runtime.ts` launch/readiness/stop block, A's `lib.rs`), we must carry the corresponding copyright line and the MIT text — "Copyright (c) 2026 DataElement" for B [B20], "Copyright (c) 2026 DeepSeek" for A, because A's LICENSE is the upstream harness file unchanged and A added no copyright line of its own [A16]. *(inferred)* A `THIRD_PARTY_NOTICES.md` (or a header comment naming repo, commit, and license) discharges this; the upstream harness fork already uses that convention [A17].
- **MIT carries no copyleft**, so nothing propagates to the rest of HimaHarness, and no source disclosure is triggered.
- Neither license grants trademark rights. B's README states the limit explicitly: "DeepSeek Harness and its dependencies remain subject to their respective upstream licenses and trademark policies." [B13] A's shell ships `productName: "DeepSeek Harness"` and `identifier: "ai.deepseek.harness"` [A7] — *(inferred)* we must not reuse either string, nor A's icons, which are the upstream product's.
- One transitive caution: B vendors 243 `@deepseek-ai/*` tarballs and a `dsh-ppt` bundle into its own tree [B12] [B1]. *(inferred)* Their licenses are the upstream ones, not DataElement's MIT; anything we lift from `packages/harness-0.1.2-rc.1/` is really upstream code and should be taken from npm instead.

---

## 7. (d) Recommendation

**Borrow the patterns; depend on neither; fork neither.**

**Do not depend.** Neither ships an installable artifact — both are `private: true` and publish only end-user installers [A2] [B1] [M3] [M7] — and neither builds outside its own repository [A4] [B1]. Even if they did, A is frozen at dsh 0.1.0-rc.5 with issues disabled and no commit in 25 days [A11] [M1], and B is hard-pinned to 0.1.2-rc.1 by 226 `file:` dependencies and 20 version-keyed patches [B1] [B9].

**Do not fork A.** Forking A means forking the entire harness monorepo, because A *is* that fork — its desktop app builds only from a workspace `pnpm --filter @deepseek-ai/dsh deploy` [A4] [M1]. That directly contradicts the "HimaHarness is a plugin bundle" decision: we would own a harness rebase forever instead of a `cordis.patch.yml`. The shell inside it is only ~250 lines [A3] [A4] — cheaper to rewrite than to inherit a fork for.

**Do not fork B.** B is a full product, not a shell: tray, application menu, custom title bars, 21 IPC channels, `electron-updater`, a plugin market and Safe Mode with recovery flows, a LAN mobile bridge with Cloudflare and Pinggy tunnels, and a PPT runtime — 2,895 lines in `index.ts` alone [B2] [B5] [B11]. Forking it means adopting its 20 patches into dsh's built client bundles [B9], its `/api/remote.mux` coupling [B15], and its 0.1.2-rc.1 pin [B1], then redoing all of it against a 0.1.5-alpha.1 tree whose session format, `AgentSetup` signature, `Inbox`, `persona` config, and command attachments all changed. That is the opposite of "smallest reversible verified change".

**Borrow, specifically.** Write our own `packages/desktop` — the shell is small — and lift these, with attribution:

1. **B's four dsh-facing functions**, which encode knowledge we would otherwise pay for in bugs: `buildHarnessArguments` (L184–200), `extractLaunchToken` (L160–182), `isHarnessStartupProbeHealthy` + `waitUntilReady` (L306–320, L799–826), `stopChild` (L510–521) [B4]; and `desktopHarnessUrl` + `clearStaleHarnessAuthCookies` + `shouldLoadHarnessUrl` from `window-navigation.ts` [B6]. The 431 stale-cookie finding alone justifies the read.
2. **A's shape**: one window, a local spinner document, navigate on readiness, no IPC for the remote page, nothing else [A3] [A6] [A10]. A's architecture note is a good statement of the boundary we want — "Workspace selection and all product interaction continue through the existing Web composition" [A9].
3. **Our own additions**: `--profile hima` instead of the `web` alias; our privacy overlay as the `--patch` argument (§9 of the 2026-09-08 note); a `dsh --profile hima --dump-config` composition check before the window opens *(inferred)*.

**Shell technology.** *(inferred, and the one place the two repositories give genuinely conflicting evidence.)* A argues for Tauri and states the reason — "Electron includes Chromium and Node, but duplicates runtime facilities that the product already carries in the dsh process and produces a larger distribution" [A9] — and the artifact sizes bear it out: 99.6 MiB versus 184 MiB [M3] [M7]. B argues for Electron by demonstration: `disclaim: true` TCC isolation, `UtilityProcess`, `session.cookies` access, `electron-updater`, and a signing pipeline that actually ships [B17] [B6] [B19]. The deciding factor for us is the cookie work: `clearStaleHarnessAuthCookies` needs programmatic access to the WebView's cookie jar, which Electron's `session.cookies` gives directly [B6] and Tauri's WebView does not expose in A's code at all — A simply has no cookie handling [A3]. Either can be made to work; **Electron reaches a correct token/cookie/health story with less new invention**, at the cost of ~85 MiB.

**macOS.** Whichever we choose, plan for a Developer ID identity, hardened runtime, and notarization from the start: B's `release.yml` shows the full shape (keychain build, `CSC_IDENTITY_AUTO_DISCOVERY: 'false'`, `codesign --timestamp`, `notarytool submit`, `stapler staple`, then `codesign --verify --deep --strict` and `stapler validate`) [B19]. A ships an unsigned-looking DMG with no signing configuration anywhere in the repository [A7] [A15]. If we bundle a Node binary as a sidecar or helper, it needs its own signature [A7] *(inferred)*.

---

## 8. What I could not verify

- **Whether A's published DMG is actually unsigned/un-notarized.** The repository contains no signing identity, no notarization config, and no desktop CI [A7] [A15], but I did not download the 99.6 MiB artifact to run `codesign -dv` / `spctl -a` against it. The claim in §2.5 is inferred from the absence of configuration.
- **Installed-on-disk footprint for either app.** I have download sizes only (compressed DMG/EXE) [M3] [M7]; `asar: false` and an unpacked `node_modules` mean B's installed size is materially larger than 184 MiB [B1], but I have no measured number.
- **Whether B runs against 0.1.5-alpha.1 in practice.** The evidence is one-directional: `file:` deps and patch filenames pin 0.1.2-rc.1 [B1] [B9] and the newest upgrade doc is `harness-0.1.2-rc.1-upgrade.md` [B14]. I did not attempt an install or check whether an unreleased branch has started the 0.1.5 work; the 14 open PRs [M8] were not read individually.
- **Whether A's shell in fact works against 0.1.5-alpha.1.** §2.2 reasons from the source of both sides [A3] [U3] [U4] and concludes the scraper survives the tokenised line, but I did not build A against a 0.1.5 tree and run it. A's own tests assert only the pre-token line shape [A3].
- **Contributor attribution for A's desktop code.** The GitHub contributors endpoint on a fork returns the parent's list [M4]; I established `fendouai` as sole desktop author from the commit list and the compare diff [M5] [A12], which is sound but is not the same as the API stating it.
- **What B's 20 patches actually change.** I read the patch inventory, sizes, and one patch in full (`@deepseek-ai+dsh+0.1.2-rc.1.patch`, which injects five desktop packages into dsh's `dependencies`) [B9] [B10]. The four large ones (68 KB, 47 KB, 46 KB, 35 KB) were not read line by line; the "heavy modification of built client bundles" characterisation rests on their size, their targets, and B's own description of them [B5].
- **`.credentials.yaml` interaction across desktop and CLI.** Upstream says the cookie secret is the `client-connection/browser-session` record under `$DSH_HOME` [U5], and both shells redirect `DSH_HOME` [A3] [B4], so a desktop and a CLI launch have different secrets. Neither repository comments on this and I did not test it.

---

## Sources

Repository **A** — `fendouai/deepseek-harness-desktop` @ `2d1b5051599bd6aafd286f73493521b5d433fed4` (raw file base: `https://raw.githubusercontent.com/fendouai/deepseek-harness-desktop/2d1b5051599bd6aafd286f73493521b5d433fed4/`):

- [A1] `apps/desktop/src-tauri/Cargo.toml`
- [A2] `apps/desktop/package.json`
- [A3] `apps/desktop/src-tauri/src/lib.rs` (L9, L30–34, L37–56, L59–79, L81–101, L103–117, L119–126, L128–135, L141–163)
- [A4] `apps/desktop/scripts/prepare-runtime.mjs` (L14–19, L24–35, L37–43, L56–95)
- [A5] `apps/desktop/README.md`
- [A6] `apps/desktop/ui/index.html`
- [A7] `apps/desktop/src-tauri/tauri.conf.json`
- [A8] `apps/desktop/src-tauri/tauri.macos.conf.json`
- [A9] `.agents/notes/implemented/architecture/2026-08-14-tauri-desktop-sidecar-host.md`
- [A10] `apps/desktop/src-tauri/capabilities/default.json`
- [A11] `package.json` (repository root)
- [A12] `gh api repos/fendouai/deepseek-harness-desktop/compare/e779fdbc5e61^...2d1b5051599b` — file list of the 10 desktop commits (adds `apps/desktop/**` and `packages/client/ui-avatar/**`; modifies `packages/bundle/web-app/cordis.patch.yml`, `packages/extensions/cordis-client-runner/src/client/slot-catalog.ts`, `apps/cli/package.json`)
- [A13] `apps/desktop/src-tauri/Info.plist`
- [A14] `apps/desktop/src-tauri/Entitlements.plist`
- [A15] `.github/` tree listing (upstream issue templates only) and `.gitlab-ci.yml` (`grep -icE 'desktop|tauri|sign|notar'` → 0)
- [A16] `LICENSE`
- [A17] `THIRD_PARTY_NOTICES.md`

Repository **B** — `dataelement/dsh-desktop` @ `c8c33c423b5e8edd03d69ee0640f42e24fe1f7a5` (raw file base: `https://raw.githubusercontent.com/dataelement/dsh-desktop/c8c33c423b5e8edd03d69ee0640f42e24fe1f7a5/`):

- [B1] `package.json` (scripts, `dependencies`, `devDependencies`, `build`)
- [B2] `src/main/index.ts` (L173, L889–906, L905–949, L950–982, L985–1029, L1031–1041, L1340–1410, L2506, L2554, L2635–2820; 21 `ipcMain.handle` registrations)
- [B3] `git/trees` listing of `src/`
- [B4] `src/main/runtime/harness-runtime.ts` (L36–130, L160–182, L184–200, L202–231, L233–275, L277–290, L292–304, L306–320, L322–347, L349–491, L493–521, L529–545, L772–779, L781–797, L799–826)
- [B5] `docs/architecture.md`
- [B6] `src/main/window-navigation.ts` (whole file, 85 lines)
- [B7] `src/preload/` tree listing (`index.ts`, `boot-failure.ts`, `desktop-storage.ts`, `plugin-error-view.ts`, `update-view.ts`, `windows-menu.ts`, `windows-titlebar.ts`)
- [B8] `src/main/security-policy.ts` (whole file, 34 lines)
- [B9] `patches/` directory listing with blob sizes (21 files)
- [B10] `patches/@deepseek-ai+dsh+0.1.2-rc.1.patch`
- [B11] `build/dsh-desktop.patch.yml` (whole file, 56 lines)
- [B12] `packages/harness-0.1.2-rc.1/` tree listing (`npm-dsh/` 243 blobs, `npm-vendor/` 10 blobs, `README.md`)
- [B13] `README.md` (L28, L126–130)
- [B14] `docs/` tree listing (`harness-0.1.2-{alpha.3,alpha.4,rc.1}-upgrade.md`, `harness-0.1.2-upgrade.md`)
- [B15] `src/main/mobile/lan-mobile-bridge.ts` (L32, L46, L88, L387–404, L673–730, L815–830)
- [B16] `src/main/mobile/{cloudflared-tunnel,pinggy-tunnel,internet-tunnel}.ts` (tree listing)
- [B17] `src/main/runtime/disclaimed-utility-process.ts` (whole file, 108 lines)
- [B18] `build/harness-node-entry.mjs` (L6–17, L43–53)
- [B19] `.github/workflows/release.yml` (L34–169 macOS arm64 job; L170+ Intel job)
- [B20] `LICENSE`

Upstream **U** — `deepseek-ai/deepseek-harness` @ `5dda764ed3aa172535a7967b06ff95d9cbfe536a` (`dsh-v0.1.5-alpha.1`):

- [U1] `apps/cli/reference/README.md` (L26, L36, L79, L82–89)
- [U2] `packages/host/webserver/README.md` (L39, L113)
- [U3] `packages/bundle/web-app/src/index.ts` (L46, L61, L185, L229, L252–285)
- [U4] `packages/client/connection/src/browser-auth.ts` (L12–20, L52–58, L69–78, L107, L121–122, L186–195, L218–230, L232–275, L299–301)
- [U5] `packages/client/connection/README.md` (L28, L33–39, L67–68)

GitHub API **M** (read 2026-09-09; `https://api.github.com/…`):

- [M1] `repos/fendouai/deepseek-harness-desktop` — fork=true, parent/source=`deepseek-ai/deepseek-harness`, stars 10, forks 0, subscribers 1, `has_issues` false, `open_issues_count` 0, license spdx `MIT`, default branch `master`, created 2026-08-14T13:34:11Z, pushed 2026-08-15T09:58:19Z, size 128,652 KB, language TypeScript, homepage `https://deepseek.com/harness`
- [M2] `repos/dataelement/dsh-desktop` — fork=false, stars 4,688, forks 248, subscribers 43, `open_issues_count` 90, license spdx `MIT`, default branch `main`, created 2026-08-13T13:45:50Z, pushed 2026-09-09T12:23:53Z, size 239,142 KB, language TypeScript, homepage `https://dshdesktop.com`
- [M3] `repos/fendouai/deepseek-harness-desktop/releases` — one entry, `v0.1.0-rc.5`, 2026-08-14T14:48:20Z, prerelease, asset `DeepSeek-Harness_0.1.0-rc.5_aarch64.dmg` 104,421,245 B; `…/tags` — one tag
- [M4] `repos/fendouai/deepseek-harness-desktop/contributors` (fork-inherited list, 21 entries)
- [M5] `repos/fendouai/deepseek-harness-desktop/commits?per_page=10` (all 10 desktop commits authored by `fendouai`, 2026-08-14 → 2026-08-15)
- [M6] `repos/dataelement/dsh-desktop/languages`
- [M7] `repos/dataelement/dsh-desktop/releases?per_page=100` — 39 releases; `0.8.0-rc.4` 2026-09-08T13:25:50Z with the asset sizes quoted in §3.1; `v0.7.2` 2026-09-03T08:17:15Z stable
- [M8] `search/issues?q=repo:dataelement/dsh-desktop+type:issue+state:open` → 76; `…+type:pr+state:open` → 14
- [M9] `repos/dataelement/dsh-desktop/contributors?per_page=100` — 17 entries
