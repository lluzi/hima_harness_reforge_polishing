# Live tool view (Campaign pane Tool tab) — implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development. One task per
> fresh implementer, task review after each, final whole-branch review. Spec:
> `docs/superpowers/specs/2026-10-13-live-tool-view-design.md` (read it first; it names the exact
> symbols and the status union).

**Goal:** a Site may declare a `toolView`; the Host opens an SSH local forward to it and publishes a
ready URL; the Campaign pane shows it in a Tool tab, view-only by default, with Take control.

**Architecture:** copy the LibInsight viewer shape (Host-owned lifecycle + status union + iframe
panel) with a remote target reached through the Site's existing SSH ControlMaster. No new runtime,
no Fabric/DBOS change.

**Tech stack:** TypeScript (Node 24, pnpm), zod, React client plugin, Electron desktop tests through
the existing driver; `node scripts/run-contract-tests.mjs <group> --files <file>`.

## Global constraints

- Worktree `/Users/lluzi/code/hima_harness_reforge_polishing/.claude/worktrees/live-tool-view`, branch
  `feat/live-tool-view`. Never touch the main checkout. Never amend or force-push. Do not push; the
  controller pushes.
- Commit identity: `git -c user.name=lluzi -c user.email=lluzi@Luzis-MacBook-Air.local commit -m "<msg>" -m "Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"`.
- Env for every test run: `PATH=$HOME/.local/node24/bin:$PATH HIMA_POSTGRES_RUNTIME=/Users/lluzi/code/hima_harness_reforge_polishing/.hima-tmp/dbos-migration/u2/runtime-final CI=true`.
  Build before `lib/`-based tests (`pnpm -r build` or the package's build script); never test stale `lib/`.
- Every new test file must be listed exactly once in `test/contract-groups.json` (`local` or `desktop`).
  Local/desktop groups inject `test/contract/support/no-ssh.mjs`, which throws on any `ssh` spawn:
  the Host module must take an injectable `spawn`.
- The frame URL host is `localhost`, never `127.0.0.1` (Host session cookie lives on 127.0.0.1).
- Controls use `data-hima-control` ids named in the spec: `studio-tool`, `tool-frame`,
  `tool-take-control`; state attribute `data-hima-state-control` ∈ `viewing|controlling`;
  section `data-hima-state-viewer` mirrors the status `state`.
- No customer identifiers, IPs other than the existing Site file's, or credentials in tests or docs.
- Tests assert user-observable results or module interfaces, never implementation details; each
  mandated test must fail without the change it covers.

---

### Task 1: Site `toolView` declaration reaches the client

**Files**
- Modify: `packages/harness/src/sites.ts` (`siteSchema` ~115-155; `reviewedSite` key lists ~301-305)
- Modify: `packages/harness/src/remote.ts` (`SiteHeadView` ~580-587; type-only file for the bundle)
- Modify: `packages/harness/src/index.ts` (`siteHeadViewOf` ~427)
- Create: `test/contract/tool-view.test.ts` (group `local`), register in `test/contract-groups.json`

**Interfaces (produces)**
```ts
// sites.ts
export const toolViewSchema = z.object({ kind: z.literal('xpra-html5'), port: z.number().int().min(1).max(65535), label: z.string().min(1).max(40).optional() });
export type ToolViewDeclaration = z.infer<typeof toolViewSchema>;
export type ToolViewKind = ToolViewDeclaration['kind'];
// Site gains `toolView?: ToolViewDeclaration`; SiteHeadView gains `toolView?: { kind: ToolViewKind; label: string }` (label defaults to 'Tool').
```

**Steps**
1. Tests first in `tool-view.test.ts` (use `writeLocalSite`/`installReferenceSite` helpers from
   `test/contract/support/site.ts`, or write a site yml directly under a temp sitesDir):
   - `loadSite` of a Site with `toolView: {kind: xpra-html5, port: 14500, label: MAGE}` exposes it.
   - `reviewedSite` (or the save path that calls it) refuses `toolView: {kind: xpra-html5, port: 14500, extra: 1}` and `kind: vnc`.
   - A Site without `toolView` loads unchanged (`toolView === undefined`).
   - `siteHeadViewOf`-level: the sites list of a booted Host (`bootHimaHost` + `api(...)` GET
     `/hima/api/sites`, see `test/contract/site-surface.host.test.ts`) carries `toolView: {kind, label:'MAGE'}`
     and no `port`; a Site declaring no label reports `label: 'Tool'`.
2. Run them, see them fail. Implement schema, key lists, `Site`/`SiteHeadView` types, `siteHeadViewOf`.
3. Run `tool-view.test.ts`, the existing `test/contract/ssh.test.ts` and `site-surface.host.test.ts`; typecheck.
4. Commit: `feat(sites): Site may declare a toolView; head view carries kind and label`.

---

### Task 2: Host `tool-view` module, routes and client API

**Files**
- Modify: `packages/harness/src/channel.ts` — extract the pure option list of `SshChannel.args()`
  into `export function sshBaseArgs(target: SshTarget, controlPath: string): string[]` (everything
  before `--`, dest), used by `args()` and by the new module.
- Create: `packages/harness/src/tool-view.ts` — exactly the API in the spec §2.
- Modify: `packages/harness/src/remote.ts` — `RemoteOperations.toolView?`, `/tool-view` route
  (copy `/libinsight` 1674-1686), GET `?sessionId&site`, POST `z.strictObject({sessionId, action: z.literal('open'), site, restart?: boolean})`.
- Modify: `packages/harness/src/index.ts` — create next to `libInsight` (~642), `webCtx.effect(() => () => toolView.stop())`,
  op in `registerHimaRoutes` object; export `createToolView`, `toolViewUrl`, types from the package index.
- Modify: `packages/harness/src/client/api.ts` — `fetchToolView(sessionId, site)`, `openToolView(sessionId, site, restart?)`.
- Extend: `test/contract/tool-view.test.ts`; Create: `test/contract/tool-view.host.test.ts` (group `local`).

**Interfaces (consumes)** Task 1's `Site.toolView`, `controlPathFor(site)` and `sshTargetOf(site)` from `channel.ts`/`sites.ts`.

**Steps**
1. Tests first:
   - `toolViewUrl('xpra-html5', 14501)` equals the exact string in spec §2 (origin `http://localhost:14501/`).
   - Local Site declaring port P where a tiny `http.createServer` answers 200: `open` → `ready{url, local:true}`; `status` after → `ready`.
   - Local Site with nothing listening: `open` → `failed` after `readyTimeoutMs: 500` with a reason naming the port.
   - ssh Site (`installReferenceSite('linglong-mage')` or a temp ssh Site) with injected `spawn` that
     records argv and starts a local HTTP listener on the `-L` port: argv contains `-N`,
     `ExitOnForwardFailure=yes`, `-L 127.0.0.1:<local>:127.0.0.1:14500`, `ControlPath=<controlPathFor(site)>`,
     the destination; status becomes `ready{local:false}`; `stop(site)` kills the child (the fake
     records the signal) and status returns `stopped`.
   - Injected spawn whose child exits 255 with stderr `Permission denied` → `failed{reason, log}` containing that text.
   - Unknown Site / Site without toolView → `unavailable` and no spawn.
   - Port memory: second `createToolView` on the same `home` prefers the previous local port for the same Site.
   - Host routes (`tool-view.host.test.ts`): `bootHimaHost` with a local Site + fake page; GET
     `/hima/api/tool-view?sessionId=…&site=…` → `stopped`; POST open → `ready`; missing session → 401/403 as `/libinsight` behaves; unknown site → `unavailable` 200.
2. Implement module (serial per Site, generation counter, `freePort(preferred)` pattern, probe loop,
   stderr ring of 4 KiB, `process.once('exit')` kill), routes, wiring, client fns.
3. Run both test files + `libinsight-viewer.test.ts` + `ssh.test.ts`; typecheck; build.
4. Commits: `feat(host): tool-view forwards a Site's declared tool display and publishes a ready URL`;
   `feat(api): /tool-view status and open routes with client calls`.

---

### Task 3: Tool tab with view-only shield and Take control

**Files**
- Modify: `packages/harness/src/client/CampaignTab.tsx` (`Section`, `SECTIONS`, nav 265-269, body 271-289, props)
- Modify: `packages/harness/src/client/HimaWorkbench.tsx` (~239: pass `toolView` for `view.run.siteId` from the fetched sites)
- Create: `packages/harness/src/client/ToolViewPanel.tsx`
- Modify: `packages/harness/src/client/workbench-style.ts` (`.hima-toolview`, `-bar`, `-frame`, `-shield`, `-note`)
- Create: `test/fixtures/tool-view/page/index.html` (+ `serve.mjs` if the desktop test needs a process): a page with a
  large button that increments a visible counter `data-count` on click and sets `document.title` to `clicked:<n>`.
- Create: `test/contract/tool-view.desktop.test.ts` (group `desktop`), modeled on
  `test/contract/unified-workbench.test.ts` ≥ line 180 and `campaign-workspace.desktop.test.ts` for creating a Run on a local Site.

**Steps**
1. Desktop test first: boot Electron with a local Site that declares `toolView` pointing at the
   fixture page's port and a second local Site without it; create a Campaign on each (existing helpers);
   assert `studio-tool` button exists only on the declaring Site's pane and reads `MAGE`; after click,
   section `data-hima-state-viewer` reaches `ready` and `tool-frame` src starts with `http://localhost:<port>/`;
   click the page button through the frame while `viewing` → counter stays 0; press `tool-take-control`
   → state `controlling`, click again → counter 1; switch to Live and back → the same frame element
   (counter still 1, no reload); press Hand back → `viewing`.
2. Implement `ToolViewPanel` (status poll, auto-open, iframe sandbox as LibInsight, shield div,
   control toggle, status line, Retry on failed) and the tab wiring with the latch pattern.
3. Run the desktop test (one Electron suite at a time), `unified-workbench.test.ts`, typecheck, build.
4. Commit: `feat(client): Tool tab shows the Site's live tool display, view-only with Take control`.

---

### Task 4: Site runbook and Linglong files

**Files**
- Modify: `sites/linglong-mage/site.yml` — add `toolView: {kind: xpra-html5, port: 14500, label: MAGE}`.
- Create: `sites/linglong-mage/tool-view/xpra-start.sh` (spec §6 flags; idempotent: `xpra list` check),
  `sites/linglong-mage/tool-view/mage-xvfb-live.sh` (the launcher with the `live-display` override,
  drop-in replacement for the Site's `mage-inputs/bin/mage-xvfb.sh`; behaviour identical when the
  marker file is absent), `sites/linglong-mage/tool-view/README.md` (install `sudo apt install xpra`,
  start, verify `curl -sI http://127.0.0.1:14500/`, marker file, rollback = delete marker).
- Modify: `sites/linglong-mage/README.md` (one section pointing there); `CONTEXT.md` (vocabulary: Tool view).
- Test: `test/contract/tool-view.test.ts` gains one case: the committed `sites/linglong-mage/site.yml` loads with `toolView.port === 14500`.

Commit: `docs(site): linglong-mage declares the MAGE tool view; xpra and live-display runbook`.

---

### Final review and L4
- Whole-branch review (Opus 5.5 high) with `scripts/review-package $(git merge-base main HEAD) HEAD`.
- Controller runs L4 on Linglong after the user installs xpra: start xpra, enable the marker, run a
  Guide-started Campaign from the packaged App, open the Tool tab, take control, record evidence.
