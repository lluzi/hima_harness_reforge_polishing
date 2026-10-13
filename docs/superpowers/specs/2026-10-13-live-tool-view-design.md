# Live tool view in the Campaign pane — design

Date: 2026-10-13. Branch `feat/live-tool-view` (from `main` 5d2ea5bd). Product scope: Harness Host,
client plugin, Site declaration. No Pack, Fabric or DBOS change.

## User scenario

A person runs a Campaign on an SSH Site whose tool has a GUI (today: MAGE on `linglong-mage`). In
the Campaign pane they open a **Tool** tab beside Live, Generations, Evidence and Report and see the
tool's real display, live, inside the HimaHarness window while the resident agent drives it. The view
is **view-only by default**; a **Take control** button lets the person click and type into the tool
(zoom, menus, Tcl in the tool terminal). **Hand back** restores view-only. Nothing about the Run,
its tasks or its evidence changes because the tab is open.

## Current behaviour (evidence)

- MAGE runs under a private Xvfb per round (`mage-inputs/bin/mage-xvfb.sh` on the Site; unix socket,
  killed after each round). Nothing can observe it.
- The App already embeds a running web app in an iframe with a Host-owned lifecycle: LibInsight
  (`packages/harness/src/libinsight-viewer.ts`, routes `/libinsight` in `remote.ts:1674-1686`, client
  `LibInsightAppPanel.tsx`, status union `unavailable|stopped|starting|ready|failed`).
- The Campaign pane tabs are local state in `CampaignTab.tsx:42-46` (`Section`, `SECTIONS`), rendered
  at lines 265-289 with `data-hima-control="studio-<key>"`.
- Sites: `sites.ts` `siteSchema` (115-155); `reviewedSite` rejects unknown keys (301-305) while
  `loadSite` strips them; the client sees only `SiteHeadView {name, kind, readiness, capacity}`.
- `SshChannel` (`channel.ts:405`) runs one short-lived `ssh` per command over a ControlMaster socket
  (`args()` 536-552). No port forward exists anywhere.
- Electron (`packages/desktop/src/main.ts`): `will-frame-navigate` (454-461) already permits
  subframes on `http://localhost:<port>` and `127.0.0.1` for any port except the Host's; every
  permission request is denied (464); no CSP on the workbench page. LibInsight publishes
  `http://localhost:<port>/` so the Host's `127.0.0.1` session cookie never reaches the frame.
- Linglong: Ubuntu 24.04, `xpra` 3.1.5 in apt (not installed; needs sudo). The xpra server serves
  the HTML5 client itself (`--html=on`, `--bind-tcp=127.0.0.1:<port>`); every client option is a URL
  query parameter (`keyboard`, `floating_menu`, `autohide`, `sound`, `clipboard`, `printing`,
  `file_transfer`, `sharing`, `steal`, `reconnect`, `keyboard_layout`, `remote_logging`).

## Design

### 1. Site declaration (owner: `sites.ts`)

```yaml
toolView:
  kind: xpra-html5      # the only kind in this slice
  port: 14500           # loopback port on the Site where xpra serves the HTML5 client
  label: MAGE           # optional, shown in the tab; default "Tool"
```

- `siteSchema` gains `toolView?: { kind: 'xpra-html5'; port: int 1..65535; label?: string }`.
- `reviewedSite` key lists gain `toolView` and a nested list `kind, port, label`.
- `SiteHeadView` gains `toolView?: { kind, label }` (no port; the client never dials the Site).
- Allowed on `kind: local` Sites too: then the Host publishes `http://localhost:<port>/` directly.
  That is what every local test uses (a fake page stands in for xpra).

### 2. Host module `packages/harness/src/tool-view.ts` (new; modeled on `libinsight-viewer.ts`)

```ts
export type ToolViewStatus =
  | { state: 'unavailable'; site: string; reason: string }            // Site has no toolView / unknown Site
  | { state: 'stopped'; site: string; kind: ToolViewKind; label: string }
  | { state: 'starting'; site: string; kind: ToolViewKind; label: string }
  | { state: 'ready'; site: string; kind: ToolViewKind; label: string; url: string; local: boolean }
  | { state: 'failed'; site: string; kind: ToolViewKind; label: string; reason: string; log: string };
export interface ToolViewOptions {
  sitesDir: string;                     // where loadSite reads
  home: string;                         // <home>/tool-view.json remembers local ports per Site
  spawn?: typeof import('node:child_process').spawn;   // injectable for tests (no-ssh guard)
  readyTimeoutMs?: number;              // default 15_000
  probe?: (url: string) => Promise<boolean>;           // default: HTTP GET returns 2xx/3xx
}
export interface ToolView {
  status(site: string): Promise<ToolViewStatus>;
  open(site: string, request?: { restart?: boolean }): Promise<ToolViewStatus>;
  stop(site?: string): Promise<void>;   // no arg: stop every forward (Host shutdown)
}
export function createToolView(options: ToolViewOptions): ToolView;
export function toolViewUrl(kind: ToolViewKind, localPort: number): string;   // pure, unit-tested
```

- **ssh Site:** `open` spawns one long-lived `ssh -N -o ExitOnForwardFailure=yes -L 127.0.0.1:<local>:127.0.0.1:<remote>`
  with the same options `SshChannel.args()` uses (BatchMode, ConnectTimeout, ControlMaster=auto,
  ControlPath = `controlPathFor(site)`, ControlPersist, `-p`, `-J`), so it rides the existing master.
  Export the option builder from `channel.ts` as `sshBaseArgs(target)` (pure) instead of duplicating.
- **local Site:** no process; `ready` with `local: true` once the probe answers.
- Readiness: poll `probe(http://127.0.0.1:<local>/)` until success or `readyTimeoutMs`, then `ready`
  with `url = toolViewUrl(kind, local)`; on child exit before ready → `failed{reason, log}` (last 4 KiB
  of stderr). Local port: `freePort(preferred)` as LibInsight does, remembered per Site so the origin
  stays stable.
- `toolViewUrl('xpra-html5', p)` = `http://localhost:${p}/?` + `keyboard=true&floating_menu=false&autohide=true&sound=false&clipboard=false&printing=false&file_transfer=false&sharing=true&steal=false&reconnect=true&remote_logging=false&keyboard_layout=us`.
  (`localhost`, never `127.0.0.1`, for the cookie reason above.)
- Serial start/stop per Site with a generation counter, as LibInsight does. `stop()` on Host shutdown
  via `webCtx.effect` next to `index.ts:643`.

### 3. Routes and client API

- `RemoteOperations.toolView?(request: {action:'status'|'open'; site; restart?})` → `ToolViewStatus`.
- `route()` branch `/tool-view` copied from `/libinsight`: GET `?sessionId&site` → status; POST
  `z.strictObject({sessionId, action:'open', site, restart?})` → open; 503 without the op; 405 else.
- `client/api.ts`: `fetchToolView(sessionId, site)`, `openToolView(sessionId, site, restart?)` via `runRequest`.

### 4. Campaign pane (owner: `client/CampaignTab.tsx`, new `client/ToolViewPanel.tsx`)

- `Section` gains `'tool'`; the Tool button is rendered only when the Run's Site declares a toolView
  (`CampaignTab` receives `toolView?: {kind,label}` resolved by `HimaWorkbench` from the sites list
  it already fetches, keyed by `view.run.siteId`). Button label = `label`, control id `studio-tool`.
- `ToolViewPanel` props `{sessionId, site, label, hidden}`: first look GET status, auto-`open` when
  `stopped`; 15 s re-poll while visible; iframe with the LibInsight sandbox
  (`allow-scripts allow-same-origin allow-forms`), `referrerPolicy='no-referrer'`, `data-hima-control='tool-frame'`.
- **Control shield:** a transparent `div.hima-toolview-shield` over the iframe captures all pointer
  input while `control === 'viewing'`; the iframe is also `tabIndex=-1` and blurred on hand-back.
  Button `data-hima-control='tool-take-control'` toggles `viewing ↔ controlling`;
  `data-hima-state-control` on the section reflects it. Default `viewing` on every mount and
  whenever the status leaves `ready`.
- Status line under the bar: "Live display of <label> on <site> · view only" / "· you are in control";
  `failed` shows the reason and a Retry (open with restart); `unavailable` never renders (no tab).
- Keep the panel mounted once seen (latch, like LibInsight at `HimaWorkbench.tsx:142`) and `hidden`
  when another section is selected, so the xpra session survives tab switches.

### 5. Electron

No change expected: subframe navigation to `http://localhost:<port>` is allowed, permissions are
denied (xpra clipboard/sound stay off by URL). The L3 test proves it.

### 6. Site side (Linglong; documented in `sites/linglong-mage/README.md`, scripts under `sites/linglong-mage/tool-view/`)

- `xpra-start.sh`: `xpra start :1100 --bind-tcp=127.0.0.1:14500 --html=on --daemon=yes --mdns=no --notifications=no --pulseaudio=no --speaker=off --microphone=off --webcam=no --dbus-launch= --xvfb="/usr/bin/Xvfb -ac +extension Composite -screen 0 1920x1200x24 -nolisten tcp -noreset" --start=xterm`
  (`-ac` so the resident container, which shares `/tmp/.X11-unix`, can connect without the cookie).
- `mage-xvfb.sh` override: if `$MAGE_INPUTS/live-display` exists and names a live display, export it
  as `DISPLAY` and skip the private Xvfb; otherwise current behaviour. One MAGE session at a time,
  matching the Site's `licences.mage: 1`.
- Site file: `toolView: {kind: xpra-html5, port: 14500, label: MAGE}`.

## Preserved

Run semantics, Permit, Channel allowlist (the forward is a separate `ssh -N`, not an `exec` verb),
LibInsight, existing tabs and tests, Sites without `toolView` (no tab, no process).

## Risks and limits

- xpra 3.1.5's bundled HTML5 client is old; if input or rendering misbehaves, the xpra.org apt repo
  (xpra 6.x) is the fallback. Not a code change.
- Two hands on one display: the shield makes handover explicit; the agent only drives MAGE while a
  `mage-round` runs. No locking in this slice.
- The forward dies with the Host; the xpra session persists on the Site (`--daemon`), so reopening
  the App reattaches.

## Tests (per `docs/testing-strategy.md`)

- L0: typecheck/build.
- L2 local: `test/contract/tool-view.test.ts` (schema, `toolViewUrl`, local Site ready, ssh Site via
  injected spawner → ready / failed-with-log / stop kills, port memory, unknown Site unavailable);
  `test/contract/tool-view.host.test.ts` (routes through a real Host with a local Site and a fake page).
- L3 desktop: `test/contract/tool-view.desktop.test.ts` with fixture `test/fixtures/tool-view/page/`
  (a page that records clicks): tab appears for a declaring Site only, frame loads, shield blocks a
  click, Take control lets the click register, frame survives a tab switch.
- L4: real xpra on Linglong (after `sudo apt install xpra`), MAGE on the shared display, Guide-started
  Campaign, Tool tab live and clickable. Evidence under `.hima-tmp/`.
