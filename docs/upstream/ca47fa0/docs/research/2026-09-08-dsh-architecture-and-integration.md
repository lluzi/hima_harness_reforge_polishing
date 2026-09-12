# DeepSeek Harness (dsh): architecture and integration surface for a HimaHarness plugin bundle

Date: 2026-09-08. Scope: primary sources only (official docs site, `deepseek-ai/deepseek-harness` source at pinned commits, published npm tarballs, GitHub release notes). No blog posts or third-party summaries were used. Two internal lead files were consulted only to decide what to look for; every claim below is re-derived from a primary source cited in the Sources list (`[Dn]` docs site, `[Rn]` repository file at a commit, `[Nn]` npm artifact, `[Gn]` GitHub release).

## Evidence grade

- **DOCUMENTED-PUBLIC (guide)** — taught on the docs site under `/en/guide/` or `/en/develop/` (the tutorial path for plugin authors).
- **DOCUMENTED-PUBLIC (reference)** — published on the docs site under `/en/reference/` (architecture, subsystem pages whose `Cordis API` blocks are generated from source JSDoc, cookbook). Route existence verified against the site's `llms.txt` [D32]; content read from the repository file the site projects.
- **SOURCE-ONLY** — visible only in package READMEs, `AGENTS.md`, or `src/` on GitHub (not on the docs site). Package READMEs are maintained and CI-verified, but they are not the "official guide".
- **INTERNAL** — explicitly marked unreleased, experimental, POC, lower-compatibility, or "not a stable interface" by the repository.
- **INFERRED** — an engineering judgment of mine derived from the above; marked inline as *(inferred)*.

Pinned refs: `dsh-v0.1.2-rc.1` = commit `a66e4702047846cdaa10c66c9d3df3951f5ea70d` (2026-09-03) [R0]; `dsh-v0.1.5-alpha.1` = commit `5dda764ed3aa172535a7967b06ff95d9cbfe536a` (2026-09-08) [R0]. "@RC" and "@ALPHA" below refer to these two commits. npm state was read on 2026-09-08 [N1].

---

## 1. Architecture overview

### 1.1 The running process ("Host") is a Cordis plugin tree composed at boot

"Cordis is the framework under dsh: plugins contribute services, typed events, and reversible effects to a shared context. Every part of the product is a plugin, including the model adapter, the tool registry, the session log, and the agent loop itself, so each is replaceable from configuration. There is no privileged core to patch: you extend dsh by mounting a plugin beside the others, and registrations are effects that unwind when their plugin unloads." — `docs/architecture.md@RC` [R1], published as `/en/reference/` [D11].

"A running `dsh` is a plugin tree composed at boot from ordered layers." [R1]. The framework is a vendored, renamed fork: `@deepseek-ai/cordis` 4.0.0-rc.7 plus `cordis-plugin-{loader,include,group,timer,hmr,logger-console}`, `@deepseek-ai/schemastery` 3.18.0, `@deepseek-ai/cosmokit` 1.8.1 — "copied into this monorepo instead of being depended on via npm, so that the harness fully owns its framework layer (auditable, patchable, pinned)" (`vendor/README.md@ALPHA` [R16]).

"Host" has two meanings in dsh vocabulary, and both matter for HimaHarness:

1. The **host composition / host plane** — the base+mode bundle tree that owns "the registries themselves, the sandbox and approval stack, persistence, and the model route", as opposed to the **agent plane** (an agent preset's `agent.cordis.yml`, mounted once per process as a standing scope that sessions join) — `packages/preset/agent-presets/presets/standard/agent.cordis.yml@RC` header comment [R19].
2. The **Web-GUI Host half** — `packages/host/` ("Web-GUI host half: API gateway + HTTP route server") versus `packages/client/` ("Web-GUI browser half: shell, wire, object services, slots, `ui-*` plugins") — `packages/README.md@ALPHA` [R6]; and the "Host application" layer in `docs/subsystems/web-client.md@ALPHA` [R9f] ("Own authoritative state, persistence, mutation ordering, access policy, and stream production").

### 1.2 Profiles, bundles, presets

| Concept | Definition (verbatim where possible) | Manifest / file | Source |
|---|---|---|---|
| **Profile** | "a named composition stored in the Harness home. It lists the bundles it stacks, holds any out-of-tree plugins it installs, and keeps the user's own `cordis.patch.yml`. `web`, `headless`, `sdk`, `sdk-minimal`, and `acp` ship as templates." | `$DSH_HOME/profiles/<name>/package.json` with `dsh.profile.bundles` (ordered) and `dsh.profile.patchReload: live \| startup`; plus `cordis.patch.yml` | [R1] [R2] [D5] |
| **Bundle** | "a distribution format for Cordis config rows and the code they mount, so whatever it inserts stays patchable by the layers above it." "A bundle is an npm package that ships a configuration layer." | `package.json` → `"dsh": { "bundle": { "patch": "./cordis.patch.yml" } }` | [R1] [D5] |
| **Agent preset** | "A session composed from a preset runs the plugins that preset's `agent.cordis.yml` names: its tools, prompt sections, and skills. Sessions joined to the same preset share one installed composition, and each session's state stays separate." Shipped presets: `cordis`, `minimal`, `ptc`, `standard`; user presets under `<dshHome>/.agent-presets`. | `<preset>/agent.cordis.yml` + `preset.yml` (`name`, `description`, `order`) | [R14i] [R19] |
| **Overlay** | `dsh --profile <p> --patch <file>` applies extra layers in argv order; the launcher appends its own telemetry-switch overlay last. | any YAML patch file | [R4] [R13g] |

"A bundle is what you author and distribute; a profile is what a user boots with `dsh --profile <name>`. Nothing is both." [D5].

### 1.3 How `cordis.patch.yml` composes plugins

The effective tree "composes over an empty root by applying, in order: 1. Each bundle patch named in the profile's `dsh.profile.bundles` list, in list order — `@deepseek-ai/dsh-base` first, then each installed bundle in the order it was added. 2. The profile's own `cordis.patch.yml`. 3. The home-level `$DSH_HOME/cordis.patch.yml` — machine-local preferences shared by every profile. 4. Each `--patch <path>` overlay, in argv order." [D5] (same list in `apps/cli/reference/README.md@ALPHA` [R4]). The launcher then pushes one more overlay when `DSH_TELEMETRY_DISABLED` is set (`apps/cli/src/profile-boot.ts@RC` L76–97, L170–171 [R13g]).

Patch semantics: "Later layers win per row, and a patch replaces a row's entire `config` value rather than deep-merging keys." [D5]. A patch document is a YAML array of either `- insert: [ {id, name, config?, disabled?, inject?} ... ]` rows or `- id: <existing-row-id>` entries that replace that row's `config` / `disabled` (examples: `docs/user/develop/basic/publish.md@ALPHA` [R20], `packages/bundle/web-app/cordis.patch.yml@RC` [R3b], `packages/bundle/base/cordis.patch.yml@RC` [R3a]). `!!js` values are expression nodes: "Loader interpolates an entry's `config` (after declared injections activate, against that plugin context — `ctx.serviceName`) and its `disabled` field (at every mount decision, against the loader context)" (`docs/cordis-primer.md@ALPHA` [R17], `/en/reference/cordis-primer` [D12]). Service isolation uses `cordis:group` rows with `group: true` and `isolate: { <service>: true }` [D7] [R19]. Preview the composed tree with `dsh --profile <p> --dump-config` [R1] [R4]; note "Nothing promises byte stability across package versions" for that dump (`packages/boot/app-boot/README.md@RC`, Dev Note [R2]).

Bundle resolution: "In-box bundle names always resolve from the dsh installation itself; pnpm manages only out-of-tree packages, so your bundle can rely on `@deepseek-ai/dsh-base` being present and current." [D5]. Out-of-tree bundles install with `dsh plugin --profile <name> add <package|./dir|github:owner/repo#sha|./x.tgz>`; after every pnpm run "each dependency resolving to a package whose manifest declares `"dsh": { "bundle": { "patch": "./cordis.patch.yml" } }` joins the layer stack" [R4]. Bundle membership changes need a Host restart; `cordis.patch.yml` edits hot-reload in `live` profiles [R4].

### 1.4 What `dsh-base` provides

"`dsh-base` is the shared first layer of the `web`, `headless`, `sdk`, and `acp` profiles: model adapters, tools, persistence, sandbox and approval policy, settings, credentials, telemetry." [R1]. The patch at @RC is one `insert` of 85 rows (84 at @ALPHA) [R3a]. Row ids, in file order (all names are `@deepseek-ai/…`): `timer`, `hmr`, `llm`, `deepseek-llm-api-extensions`, `session`, `session-log-deepseek`, `typert`, `typert-loader`, `typert-gateway`, `session-title`, `session-title-llm`, `user-questions`, `agent`, `plugin-package-inventory-deepseek`, `agent-default-model` (`deepseek-official` / `deepseek-v4-flash`), `jobs` (`dsh-jobs-local`), `llm-retry`, `settings` (`dsh-settings-file`), `credentials` (`dsh-credentials-local`), `llm-pi-ai`, `session-persistence-jsonl`, `attachment-local`, `session-query-sqlite`, `session-projection`, `storage`, `storage-json` (root `dshHomePath('storages')`), `storage-domain`, `session-projection-cache`, `session-telemetry-otel`, `subprocess` (`dsh-subprocess-local`), `sandbox` (`dsh-sandbox-local`), `sandbox-policy`, `bash-sandbox`, `pwsh-sandbox`, `approval` (`dsh-user-approval`), `permission` (`dsh-permission-presets`), `shell-env`, `tool-bash`, `tool-pwsh`, `tool-jobs`, `fs-observation-policy`, `tool-fs`, `tool-fs-search`, `agent-instructions`, `skill`, `skill-filesystem`, `skill-badge` (disabled), `tool-skill`, `commands`, `command-feedback`, `goal`, `goal-round-driver`, `command-goal`, `plan-mode`, `token-meter`, `compaction-basic`, `command-compact`, `subagent`, `subagent-spawn-in-process`, `subagent-fork-in-process`, `tool-subagent-control`, `tool-subagent-list-agents`, `tool-subagent`, `tool-subagent-fork`, `workflow-worker-thread`, `tool-workflow`, `timeout-policy`, `spill-local`, `spill-policy`, `session-checkpoint-policy`, `tool-result-pruner`, `tool-todo`, `tool-goal`, `tool-ralph`, `tool-str-replace-editor` (removed @ALPHA), `repeat-tool-reminder`, `web`, `web-search-deepseek`, `web-fetch-http`, `tool-web`, `tools`, `system-prompt`, `agent-loop`, `fs-sandbox`, `llm-deepseek` [R3a]. The generated per-profile graph is `apps/cli/composition.md@ALPHA` [R21].

Base defaults that matter for a plugin: sandboxed filesystem is "the single file-write path: adding the plain filesystem provider on top of it makes the profile fail to load" (`packages/bundle/base/README.md@RC` [R3c]); new sessions "default to the `workspace-write` permission preset" [R4].

### 1.5 How the shipped profiles differ

| Profile | Layers | patchReload | Adds over base (row ids from the mode bundle) | Notes |
|---|---|---|---|---|
| `web` (`dsh web` alias) | base + `dsh-web-app` | `live` | replaces `system-prompt`, `session-query-sqlite`, `tools` rows; inserts `subagent-model-selection-settings`, `code-runtime` (`dsh-code-runtime-worker-thread`), `message-feedback`, `session-log-download`, `workspace`, `session-reference`, `file-reference-local`, `session-stats`, `session-turn-outline`, `directory-picker`, `plugin-inventory`, `session-controller`, `settings-controller`, `workspace-controller`, `cordis-host-runner`, `web-startup`, `webserver`, `web-runtime`, `client-hmr`, `modules` (`dsh-client-modules`), `connection`, `api-remotes`, `cordis-client-runner`, `ui-theme`, `locale`, `ui-layout`, `ui-renderer`, `ui-session`, `ui-sidebar`, … and `agent-presets` (default `standard`); disables base `tool-*` rows (`tool-todo`, `tool-web`, …) so tools come from presets | `packages/bundle/web-app/cordis.patch.yml@RC` [R3b]; "The Web app disables the base tool row and exposes the same tools through its `cordis`, `ptc`, and `standard` agent presets" [R4] |
| `headless` | base + `dsh-headless` | `startup` | replaces `system-prompt`, `tools`; inserts `code-runtime`, `headless-startup`, `headless-runner` | one fresh persisted Agent, prints final text, exits; "mounts no browser Connection, HTTP server, Web runtime, or browser client, and opens no listening port" [R4]. Its creation `setup` only installs model selection (`packages/bundle/headless/src/index.ts@RC` L185–191 [R15b]); no agent-preset mount. |
| `sdk` | base + `dsh-sdk-app` | `startup` | replaces `system-prompt`, `session-title-llm`; inserts `sdk-app-startup`, `sdk-jsonrpc-server` | JSON-RPC over stdio; the TypeScript/Python SDK clients spawn `dsh --profile sdk` [R1] |
| `acp` | base + `dsh-acp-app` | `startup` | replaces `system-prompt`, `session-title-llm`; inserts `acp-app-startup`, `acp` | Agent Client Protocol over stdio; "registers a one-shot machine permission answerer for agents it owns" [D14] |
| `sdk-minimal` | standalone `dsh-sdk-minimal` only | `startup` | complete tree of ~35 rows (no web, no approval/permission services, `danger-full-access` pinned) | "does not apply `dsh-base`" [R1]; "mounts no approval or permission-settings service" [R4] |

Agent presets are mounted only where a creator calls `ctx.agentPresets.mount(agentCtx, id)` inside the `setup` callback of `ctx.agents.create`: the Web session controller (`packages/api/session-controller/src/agent.ts@RC` L378–385 [R15a]) and the webhook session creator (`packages/webhook/webhook/src/session.ts@RC` L129–142 [R15c]). *(inferred)* A custom automation profile that wants preset-composed agents must do the same in its own creation path.

Launch invariant: "Every supported Node application starts at the `dsh` CLI with a named profile … custom plugin composition remains a profile plus ordered patch files, not another executable or inline application tree." [R1]. The `desktop` profile name is reserved for the Electron app (CLI README in the 0.1.5-alpha.1 tarball [N2]).

---

## 2. Public extension points

Classification key: **G** = DOCUMENTED-PUBLIC (guide/develop tutorials); **Ref** = DOCUMENTED-PUBLIC (reference site); **S** = SOURCE-ONLY (README/src on GitHub); **I** = INTERNAL. "Δ" marks a seam whose published `.d.ts` changed between `0.1.2-rc.1` and `0.1.5-alpha.1` (details in §8).

| Seam | Surface | Class | Where documented | Δ |
|---|---|---|---|---|
| Plugin module | `export const name`, `export const inject = [...]`, `export function apply(ctx, config)`; object form; class form `extends Service` with `super(ctx, 'key')`; `export const Config = Schema.object(...)` (Schemastery) | G | `/en/develop/basic/` [D2], `/en/develop/basic/config` [D4] | — |
| Lifecycle | `ctx.effect(() => disposer)`, `ctx.plugin(child)`, `fiber.dispose()`, HMR; disposer order caveat | G | `/en/develop/framework/` [D6] | — |
| Services | `ctx.<key>` via declaration merging on `Context`; `ctx.get('key')` optional; `cordis:group` + `isolate` | G | `/en/develop/framework/service` [D7] | — |
| Events | `ctx.on/emit/bail/serial/waterfall`; `next()` mandatory in waterfalls; typed via `interface Events` merge; durable session events observed via `session/event` | G | `/en/develop/framework/events` [D8]; dispatch modes `/en/reference/cordis-primer` [D12] | — |
| Three-role capability seam | Service Definition / Provider / Consumer packages | G | `/en/develop/practice/` [D9]; `/en/reference/capability-seams` (generated graph) [R22] | — |
| Tools | `ctx.tools.register(defineTool({name, description, parameters, output:{schema, render}, execute}))` | G | `/en/develop/basic/tool` [D3] | — |
| Tools (policy) | `ctx.tools.guard(g)`, `ctx.tools.restrict({allow\|deny})`, `ctx.tools.get(name, scope)`, `ctx.tools.schemas(scope)`, `ctx.tools.presentAs(mode)`, `ctx.tools.executionMode(exec)`; waterfalls `tools/pre-execute` → guard → `tools/execute` → `tools/post-execute` → emit `tools/result`; `tools/change` | Ref | `/en/reference/subsystems/tools` [D24]; `/en/reference/cookbook/adding-a-tool` [D15]; `/en/reference/cookbook/extension-cookbook` [D14]; `packages/core/tools/README.md@RC` [R14a] | Δ (PTC session-event names only) |
| Agent registry | `ctx.agents.create({sessionId, meta, agentOptions, setup}) → Promise<AgentHandle>`, `resume({resumeSessionId, …})`, `get(id)`, `list()`, `roots()`, `isOwnedBy`, `setFactory`, `currentInitiator/requireInitiator/withInitiator` | Ref | `/en/reference/subsystems/core` [D25]; published `dsh-agent` `index.d.ts` [N3a] | **Δ** (`AgentSetup` signature, `parentAgent`, `ctx.agent` removed, `Inbox` type-only) |
| Agent driver | `agent.followup(msg)`, `steer(msg)`, `inject(msg)`, `send(msg, target, wakeup)`, `cancel(cause, opts)`, `whenIdle()`, `agent.ctx` (scoped registrations), `agent.session`, `agent.inbox` | Ref | [D25]; `runtime-types.d.ts` in `dsh-agent` [N3a] | Δ (`Inbox` shape) |
| Agent hooks | `agent/pre-step` (waterfall, reject/rewrite), `agent/request` (waterfall), `agent/request-error`, `agent/turn-stopping` (serial), `agent/session-start`, `agent/created/disposed/status/error`, `agent/inbox/*`, **new** `agent/assistant-stream` | Ref | [D25]; `/en/reference/` turn-flow diagram [D11]; `/en/reference/agent-lifecycle` | Δ (new event) |
| System prompt | `ctx.systemPrompt.section({name, order, text\|resolve, complete?})`, `.variable(name, fn)`, `.getSectionOrder`, `.getContextOrder`, `.suppressRuntimeContext()`; scoped shadowing via `agent.ctx`; `system-prompt/assemble` waterfall | Ref | `/en/reference/subsystems/system-prompt`; `packages/core/system-prompt/README.md@RC` [R14b] | **Δ** (`persona` → `personaPrefix`/`personaSuffix`; order constants) |
| Skills | `ctx.skills.registerProvider((control) => SkillProvider)`, `ctx.skills.register(skill)`, `list/snapshot/get`, `skills/change`; `dsh-skill-filesystem` roots/config; `dsh-tool-skill` catalog + `skill` tool | Ref | `/en/reference/subsystems/skills` [D19]; READMEs [R11a–c] | — |
| Agent presets | `ctx.agentPresets.resolve(id)`, `.mount(agentCtx, id)`, `.composeFrom(agentCtx, parentCtx)`, `.composedPreset(agentCtx)`, `.serviceFor(agent, key)`, `select`, authoring (`create` copy-only, `remove`); `agent-preset/selected` event | Ref (API) / S (authoring format) | `/en/reference/subsystems/core` [D25]; `packages/preset/agent-presets/README.md@RC` [R14i]; `presets/standard/agent.cordis.yml@RC` [R19] | — |
| Approval | `ctx.approval.request(req) → 'allowed-once'\|'rejected'\|'cancelled'\|'unavailable'`, `.setPolicy(agent, 'ask'\|'never')`, `.effectivePolicy(session)`, `.overrideOf(session)`; `approval/request` waterfall (answerers); `approval/asked`, `approval/decided` log events | Ref | `/en/reference/subsystems/approval` [D16] | — |
| Permission presets | `ctx.permissionPresets.current/resolve/optionOf/set/selectFor/names`; `permission/preset` event; `permission` settings namespace (`defaultPreset`) | Ref | `/en/reference/subsystems/permission-presets` [D17] | — |
| Commands (slash) | `ctx.commands.register({name, description, input?, handler})`, `execute(agent, line, attachments, signal)`, `list(agent)`, `find(agent, name)`; agent-scoped shadowing; `command/run`, `command/done` | Ref | `/en/reference/subsystems/commands` [D26]; README [R14c] | **Δ** (`input.images` → `input.attachments`; `execute` arg type; `registerFileReceiptResolver`) |
| Code runtime (PTC) | `ctx.codeRuntime.run({program, bindings, signal})`; backend `language`/`isolation` descriptors; `dsh-tools` `mode: native\|ptc\|both` | Ref | `/en/reference/subsystems/code-runtime` [D27]; README [R14d] | Δ (session event ids `tool/code-dispatch*` → `tool/ptc-dispatch*`) |
| MCP bridge | one `@deepseek-ai/dsh-mcp-client` row per server (`serverName`, `transport: stdio\|streamable-http`, reconnect); tools appear as `mcp__<server>__<tool>` | G (config) / S (behavior) | `/en/guide/mcp-memory` [D33]; `packages/mcp/mcp-client/README.md@RC` [R14e] | — |
| Sessions | `ctx.sessions` (`create`, `get`, `fork`, `append`, `snapshotEvents`, `deriveMessages`), `SessionEventMap` merge for durable state | Ref | `/en/reference/subsystems/session`; `persistence-catalog` | Δ (`fromRestore`, `SurfaceIntent<T>`, removed `decodeStorageRecord/packChunkRuns` exports) |
| Session persistence | `ctx.sessionPersistence.create/open/stat/list/locate` returning `SessionHandle` (`read/append/flush/close`) | Ref | `/en/reference/subsystems/persistence` [D22] | **Δ** (handle API introduced 0.1.3-alpha.1; format v2 then v3) |
| Storage domain | `defineDomain({name, version, tables: {t: domainTable(zodSchema)}})`; `await ctx.storageDomain.open(spec)`; `domain.table(t).get/put/update`; `domain/changed`; backends `dsh-storage-json` / `dsh-storage-sqlite` | Ref | `/en/reference/subsystems/storage` [D23]; README [R12e] | — |
| Settings | `ctx.settings` namespaces over `$DSH_HOME/settings.yaml` (file provider, hot reload, leaf-diff writes) | Ref | `/en/reference/subsystems/settings`; `/en/reference/cookbook/adding-a-settings-card`; README [R14j] | — |
| Subprocess | `ctx.subprocess.resolveExecutable`, `.spawn({argv, cwd, stdio, graceMs, signal, env})`, `.spawnTerminal(...)`; `scrubbedParentEnv` | Ref | `/en/reference/subsystems/subprocess`; README [R14f] | Δ (`pid` removed from ordinary handle) |
| Shell | `ctx.shell.resolve(req)`, `.run(spec)`, `.start(spec)`; one executor per composition (`dsh-bash-local` / `dsh-bash-sandbox` / pwsh twins) | G/Ref | `/en/develop/practice/` uses it as the worked example [D9]; `/en/reference/subsystems/shell`; README [R14g] | — |
| Sandbox | `ctx.sandbox` backends; modes `read-only \| workspace-write \| danger-full-access`; `dsh-sandbox-policy` (`setSandboxMode`, `sandbox/mode` event); escalation `sandbox_permissions` + `justification` | Ref | `/en/reference/subsystems/sandbox`; README [R14h] | — |
| Jobs | `ctx.jobs.start({kind, label, owner, run(): JobHooks})`; `JobKindMap` merge; `job_output/list/kill` tools | Ref | `/en/reference/subsystems/jobs` [D20] | — |
| Workflow | `ctx.workflowEngine.start({script, meta, args, parent, signal})`; script hooks `agent/parallel/pipeline/phase/log` | Ref | `/en/reference/subsystems/workflow` [D21]; README [R12c] | — |
| Web client module | `package.json` `"dsh": { "client": { "platform": "web", "inject"?, "immediately"?, "external"? } }` + `exports["./client"]` → built `lib/client.js`; served under `/plugins`; `window.__DSH_BOOT__` graph | Ref | `/en/reference/subsystems/client-modules` [D18]; README [R9a] | — (10+/1− in `client-modules` d.ts) |
| Slots (browser UI) | `ctx.slots.register({name, children?, store?, inject?}, Component)`; `ctx.slots.inject(name, () => ctx.slots.register(...))`; tool views keyed by wire tool name under `tool.call.toolview` | Ref (mechanism) / S (authoring rules) | `/en/reference/subsystems/slots` [D28]; `/en/reference/subsystems/web-client` [D29]; `packages/client/AGENTS.md@RC` [R9c]; `packages/client/ui-tool/README.md@RC` [R9d] | — |
| Remote API (Host↔Client) | `class X extends TypertRemoteService { constructor(ctx){ super(ctx, 'key', {namespace}) } @Remote('m') … }`, `@RemoteScope`, `RemoteError` + `RemoteErrorDetailsMap` merge; Client: `inject = ['remote', 'remote.<ns>']`, `ctx.remote.<ns>.<m>()` → `RemoteResult<T>`; generated `lib/typert.host.js` + `lib/typert.remote-client.js` mounted by `@deepseek-ai/dsh-api-remotes` | Ref (mechanism) / S (step-by-step) | `/en/reference/api-gateway` [D13]; `docs/cookbook/adding-a-remote-api.md@RC` [R10b] (not on the site) | Δ (journal-stream `Notification` type param; `agentId` in gateway types) |
| Conversation nodes | `ConversationNodeDefinition` + keyed `conversation.chat.node` renderer | Ref | `/en/reference/subsystems/conversation` | — |
| Hooks bridges | Claude Code `hooks.json` / Codex hooks mapped onto `agent/*`, `tools/*` | S | `packages/hooks/hooks-claude-code/README.md@ALPHA` [R23] | — |
| Runtime Cordis mount | `dsh-tool-cordis`: model can mount/unmount in-memory plugins (temporary, process-wide) | G | `/en/develop/practice/dynamic-cordis` [D10] | — |
| Agent teams | `ctx.agentTeams` | I | "private opt-in coordination seam" [R1]; `@deepseek-ai/dsh-experimental-agent-team` is not on npm [N4] | — |
| Python code runtime | `dsh-experimental-code-runtime-python` | I | "private experimental" [R14d]; not on npm [N4] | — |
| e2b remote world | `dsh-fs-e2b`, `dsh-subprocess-e2b` | I | "`e2b/` is a POC" [R6] | — |
| Support tiers | `util/`, `test-support/`, `runtime-diagnostics/` | I | "lower compatibility expectations" [R6] | — |
| `ui-dockkit` | layout engine | I | "an internal dependency of `ui-sidebar-right`, not a stable interface" (`docs/subsystems/sidebar-right.md@ALPHA` [R24]) | — |
| `--dump-config` output | text | I | "Nothing promises byte stability across package versions" [R2] | — |

Scoping primitive: every registration made through `agent.ctx` lands in that agent's layer (tools, prompt sections, skills, commands, approval answerers); `Scoped<Agent>` events dispatch only to that agent's listeners (`/en/reference/subsystems/scope`, `docs/subsystems/scope.md@ALPHA` [R25]).

---

## 3. What the integration guide says a bundle should and should not depend on

Stated stability posture (quotes):

- Root README @ALPHA: "DeepSeek Harness is in _developer preview_ and iterating rapidly. **THERE WILL BE COMPATIBILITY-BREAKING CHANGES.**" [R5]. The 0.1.5-alpha.1 npm tarball README carries the same command table but no separate stability statement [N2].
- `packages/README.md@ALPHA` "Release expectations": "Most groups are product — stable API. The exceptions: `e2b/` is a POC, `experimental/` is unreleased, and `test-support/`, `runtime-diagnostics/`, and `util/` are support with lower compatibility expectations." [R6]
- Dependency rule, same file: "**Extension plugins depend on Service Definitions, never concrete providers.** `dsh-agent-loop` is swappable; UI, hook, and tool plugins use `dsh-agent`. Composition bundles may depend on spine plugins." [R6]
- Three-role practice page: "The Service Definition changes rarely after callers depend on its contract. Service Providers can improve performance and security independently. Consumers can change how they present the capability to the model." and "The Service Provider and Consumer **do not depend on each other**." [D9]
- Bundle authoring: "Your patch can override rows from earlier layers by `id` … but must restate every key the row needs, not just the changed one." and "Users can override your rows in their profile's `cordis.patch.yml` without touching your package, so prefer configuration defaults users are likely to keep and let the schema carry the rest." [D5]
- Distribution: "a git install fetches **sources, not built artifacts** … Treat that allowance as **permission to execute the package's code on your machine at install time**, outside any sandbox the agent runs under." Preferred: publish prebuilt `lib/` to npm or ship a `pnpm pack` tarball [D5].
- Config discipline: "Harness requires **anything that two deployments may want to set differently to be a configuration field**." and "Do not export a plain object as `Config`; it does not implement the Standard Schema interface required by Cordis." [D4]
- Browser plugins (`packages/client/AGENTS.md@RC` [R9c]): "A UI plugin exports no values beyond what cordis loading needs … Adding any new value export requires user sign-off"; "A feature plugin MUST NOT runtime-import or re-export another feature plugin's values, and MUST NOT declare `dsh.client.external` to obtain them"; "Presentation components … expected to be rewritten wholesale."
- On-disk formats: "Adding an event type that carries non-serializable data, corrupts core execution nesting, or violates its owner's declared relation is a breaking change to the on-disk format." (`docs/subsystems/session.md@ALPHA` L675 [R26]); 0.1.5-alpha.1 notes: "Custom log readers must adapt to V3; downgrade reads are not supported." [G4]
- SAFETY @ALPHA: "experimental developer-preview software. It has not undergone a security audit and must not be treated as secure or production-ready." [R27]

What is **not** stated anywhere I could find: a semver policy, a deprecation window, or a compatibility promise between prereleases. `git grep` over docs/READMEs at @ALPHA for `semver|deprecat|stability guarantee` finds no policy text [R6-grep]. Release notes flag breaking items ad hoc under "Chores" ("**Breaking change:** …", "**Agent plugin API changes:** …", "**Inbox API changes:** …") [G2] [G4]. Every workspace package shares one version string and is published only as `-rc.N` / `-alpha.N` prereleases [N1]. The CLI's dist-tags are `latest`=`next`=`0.1.2-rc.1`, `alpha`=`0.1.5-alpha.1` [N1], but per-package `latest` tags are stale (for example `@deepseek-ai/dsh-typert-generator` `latest`=`0.0.1-rc.1` while `0.1.5-alpha.1` exists) [N4] — *(inferred)* pin exact versions across all `@deepseek-ai/*` peers; never rely on sub-package dist-tags.

Peer-dependency shape a bundle inherits: e.g. `@deepseek-ai/dsh-tools@0.1.5-alpha.1` declares `peerDependencies` on `@deepseek-ai/cordis ^4.0.2` and same-version `dsh-agent`, `dsh-code-runtime`, `dsh-invariants`, `dsh-llm`, `dsh-scope`, `dsh-session`, `dsh-system-prompt`, `dsh-user-approval`; no `engines` field in any packed package; the repo root pins `node ^22.19.0 || >=24.0.0`, `pnpm@11.7.0` at both tags [N3] [R0].

---

## 4. Skills

Package family (`/en/reference/subsystems/skills` [D19], `docs/subsystems/skills.md@RC` [R11d]): Service Definition `dsh-skill` (`ctx.skills`), local provider `dsh-skill-filesystem`, packaged example provider `dsh-skill-badge`, consumer `dsh-tool-skill`. All four are mounted in `dsh-base` (`skill-badge` disabled) [R3a] and again inside the `standard` preset's layer (`skill-filesystem`, `tool-skill`) [R19].

**Directory layout / frontmatter** (`packages/skill/skill-filesystem/README.md@RC` [R11b]): "A skill is either a directory bundle `<name>/SKILL.md` or a flat file `<name>.md` at the top level of a scanned root; nested `**/SKILL.md` files are deliberately not discovered. The file starts with YAML frontmatter: required `name` and `description`, plus optional `whenToUse`, `metadata`, `disable-model-invocation`, and `user-invocable`." Names are kebab-case `^[a-z0-9]+(?:-[a-z0-9]+)*$` [R11d]. Roots and rank: 100 `<projectRoot>/.dsh/skills`, 200 `<projectRoot>/.agents/skills`, 300 `customSkillDirs`, 400 `<dshHome>/skills`, 500 `<agentsHome>/skills`, 600 `bundledSkillDir` (project root = nearest `.git` ancestor) [R11b] [R11d]. Config: `providerName`, `includeDefaultRoots` (false ⇒ only configured roots), `customSkillDirs`, `bundledSkillDir`, `watch*` (Chokidar) [R11b]. "The catalog and the body have separate lifecycles: discovery parses frontmatter into the catalog entry, and every load re-reads the current file" [R11b].

**Registry semantics** (`packages/skill/skill/README.md@RC` [R11a]): "host+per-scope layered … a plugin mounted by an agent preset's standing composition lands in that preset's layer"; "the nearest layer wins a duplicate name outright"; providers are queried sequentially; invalidation is provider-driven (`control.invalidate()`), no TTL. Invocation policy: `{modelInvocable, userInvocable}` with all four combinations retained [R11a].

**How the model and user reach skills** (`packages/skill/tool-skill/README.md@RC` [R11c]): a durable user-role catalog message lists model-invocable names + descriptions before the first request; the model calls the `skill` tool by exact name and receives the body in a `<skill_content>` block retained as tool history; "A `/name` token in direct user input that names a user-invocable skill injects that skill's instructions into the step"; catalog changes append a full replacement catalog.

**Shipping skills inside a plugin bundle** — three supported paths, all primary-sourced:

1. **Programmatic provider** (the pattern dsh itself uses for a packaged skill): `packages/skill/skill-badge/src/index.ts@RC` [R11e] registers `ctx.skills.registerProvider(() => provider)` where `provider.list()` returns a `SkillCandidate` (`name`, `description`, `invocation`, `provider`, `source: 'bundled'`, `resourceBase: {kind:'directory', path}`, `rank: BUNDLED_SKILL_RANK`, `locator`) and `get()` reads the Markdown body from the package's own `assets/` via `import.meta.url`. `inject = ['skills']`.
2. **In-memory registration**: `ctx.skills.register(skill)` — "the registry fills in a default invocation policy and the `runtime` provider label" [R11a].
3. **Filesystem provider rows**: a second `dsh-skill-filesystem` row with a distinct `providerName`, `includeDefaultRoots: false`, and `customSkillDirs`/`bundledSkillDir` pointing at a directory shipped in the bundle; placed in a Hima agent preset's `agent.cordis.yml` so only Hima sessions see it (rows in a preset register into that preset's layer, "so they need no realm" [R19]).

Docs-site statement on packaged skills: "The local provider does not synthesize built-in system skills; deployments supply packaged skills through configured bundled roots or dedicated providers." [D19] [R11d].

**Mapping to a grill → spec → fabric → test → release pipeline** *(inferred from the above)*: each stage is one skill (`SKILL.md` with `user-invocable: true` so `/grill`, `/spec`, … work from the composer, and `disable-model-invocation` on stages the model should not self-select); stage transitions that need no model turn are `ctx.commands.register` handlers (they "run directly against the agent; no model message is created" [R14c]); pipeline state that must survive restarts goes into a Hima `defineDomain` table (durable, schema-validated) or a Hima `SessionEventMap` extension (durable and replayable); the "release" stage can gate on `tools/pre-execute` returning `ask` (§5). dsh has no skill state machine or stage ordering of its own — skills are instruction text plus a catalog.

Limitations to design around: one-level discovery only; "Malformed entries disappear with a warning"; "No body revision protocol" [R11b]; "Duplicate resolution is first-wins … no API to inspect all shadowed definitions" [R11a].

---

## 5. Approvals and permissions

**Vocabulary and service** (`/en/reference/subsystems/approval` [D16]): `ApprovalOutcome = 'allowed-once' | 'rejected' | 'cancelled' | 'unavailable'`; "`allowed-once` grants only the asked-about action; callers deny on `rejected`, `cancelled`, and `unavailable`. A missing, non-owning, throwing, or non-conforming answerer becomes `unavailable` rather than opening the gate." `ApprovalPolicy = 'ask' | 'never'`; "`never` deterministically returns `rejected` without dispatching any answerer"; the effective policy is the last `approval/policy` session event or the service config. `ctx.approval.request(req)` "requires the requesting session to be inside an open turn. It appends `approval/asked`, obtains one outcome, appends the matching `approval/decided`, and resolves with that outcome." `ApprovalRequest` carries `agent`, `toolName`, optional `callId`, `reason`, `signal` — deliberately no tool arguments.

**Who raises it**: at @RC the only production callers of `approval.request(` are the tool runtime (`packages/core/tools/src/index.ts@RC` L1697) and the sandbox escalation helper (`packages/sandbox/sandbox/src/escalation.ts@RC` L12) [R7c]. The tool runtime path: a `tools/pre-execute` listener returns `PreToolDecision = {kind:'allow'} | {kind:'deny', reason} | {kind:'ask', reason?}` (L581–584); "`ask` runs only after an approval service returns `allowed-once` and otherwise denies" (L576–579); when no `ctx.approval` is composed the runtime denies with "requires approval (not yet supported)" (L1684–1689), and with no agent on the call it denies (L1693) [R7c].

**Who answers** (`approval/request` waterfall, `Scoped<Agent>`): "UI channels may provide human answerers; the ACP automation bridge provides one-shot machine decisions for its own agents." [D16]. Web: `dsh-client-ui-approval` (web-app row list [R3b]). Headless: "No built-in answerer — headless or incompletely composed deployments resolve `unavailable` and fail closed" (`packages/interaction/user-approval/README.md@RC` [R7b]).

**Access modes**: sandbox modes `read-only`, `workspace-write`, `danger-full-access` (file effects only: "The seam expresses no network, process, syscall, device, or credential restrictions" [R14h]); approval policy `ask`/`never`; permission presets bundle the two: default table `workspace-write` (= workspace-write + ask) and `danger-full-access` (= danger-full-access + never), derived `custom` [D17]. Process-level default via `DSH_PERMISSION_MODE`; per-user default via the `permission` settings namespace `defaultPreset` in `settings.yaml` ("applies only when a later session is created") [R4] [R8b]. Per-call escalation: the model may retry once with `sandbox_permissions` + `justification`; "the user sees one approval prompt and can allow once, reject, or cancel" [R14h].

**Can a plugin require approval for its own tools?** Yes — documented as the intended mechanism: "Permission system / AskUserQuestion | return `ask` from `tools/pre-execute` and answer through `ctx.approval`" [D14]; the cookbook's "permission-gate example" is a plain `ctx.on('tools/pre-execute', …)` plugin [D14]. A plugin may also call `ctx.approval.request` from inside `execute` (it will be inside an open turn) or register its own answerer on `approval/request` (scoped via `agent.ctx`); "The `never` policy is enforced inside the service before waterfall dispatch, so even an answerer registered later with `prepend` cannot bypass it." [D16]. `ctx.tools.guard()` gives "a monotonic synchronous guard … a returned reason denies the call, and no later listener can turn that denial back into permission" [R14a].

**Can a plugin store a permission/permit file like Claude Code's settings?** Not through the approval seam: "**Only one-shot grants exist** — the outcome vocabulary has `allowed-once` but no `allow-always`, remembered rule, revocation, or grant store; session policy is only `ask` / `never`." and "Requests are valid only inside an open turn … a durable out-of-turn approval workflow is deferred." [R7b]. What dsh does persist: `approval/policy`, `sandbox/mode`, `permission/preset` session events (replayed on resume) [D16] [D17]; `permission.defaultPreset` in `settings.yaml` [R8b]. *(inferred)* A Hima-owned permit store is straightforward: keep rules in a `defineDomain` table or a Hima `ctx.settings` namespace, and consult them in Hima's own `tools/pre-execute` listener, returning `allow`/`deny`/`ask` — dsh's `ask` path then only fires for the residue. Note the hooks bridge does not cover Claude Code's `PermissionRequest`/`PermissionDenied` events ("Unsupported hook events (23 of Claude Code's current 30)" [R23]).

---

## 6. Jobs, workflows, durability

| Facility | Package(s) | Durable across Host restart? | Primary statement |
|---|---|---|---|
| Background jobs | `dsh-jobs` (seam, `ctx.jobs`) + `dsh-jobs-local` | **No** | "records are in-memory … Every record disappears when the harness process exits." Owner disposal cancels and awaits jobs; at capacity `start()` fails, "the registry neither queues nor preempts." (`packages/jobs/jobs-local/README.md@RC` [R12a]; `/en/reference/subsystems/jobs` [D20]) |
| Workflow scripts | `dsh-workflow` (`ctx.workflowEngine`) + `dsh-workflow-worker-thread` | **No** | "**No journaling or resume** — scripts, child progress, and intermediate values are not checkpointed, so a process restart cannot continue a run." Also "Foreground collection only", "No saved or nested workflows", "No token-budget vocabulary", "Runs are holder-owned, not service-tracked." (`packages/workflow/workflow/README.md@RC` [R12c]) |
| Session log | `dsh-session` + `dsh-session-persistence-jsonl` | **Yes** | append-only JSONL (zstd frames by default), lazy materialization, torn-tail repair; from 0.1.3-alpha.1 "a new Session lock ensures that each Session is held by at most one process" [G2]; @ALPHA README: "One live writer per session … kernel lock (non-blocking `flock(2)` on `session.lock` …)" [R12f]; format generations v0→v1→v2 (0.1.3-alpha.1) →v3 (0.1.5-alpha.1) with immutable predecessors [R12f] [G4] |
| Goals | `dsh-goal` | **Yes** | "the goal's text, phase, round count, and revision history live in the session log, so they survive session resume, fork, and process restarts … continuation permission is process-local and never persisted" (`packages/goal/goal/README.md@RC` [R12g]) |
| Schedule (reminders) | `dsh-schedule` | **Yes (record)**, delivery only on a live session | "Reminders survive restarts: an already-live idle agent can deliver due work immediately, while a closed or cold session keeps it overdue until a future live root agent resumes the session."; "Latest-only catch-up"; "Narrow crash duplicate window" (`packages/schedule/schedule/README.md@RC` [R12d]) |
| Domain KV | `dsh-storage-domain` over `dsh-storage-json`/`-sqlite` | **Yes** | "every write is durable before it resolves"; but "**Single-process change visibility**", "No cross-table transactions, secondary indexes, or multi-segment keys", "No data migration — a domain whose stored version differs from its spec rejects at open (`version-mismatch`)" (`packages/storage/storage-domain/README.md@RC` [R12e]) |
| Approvals | `dsh-user-approval` | **No** (out-of-turn) | "Requests are valid only inside an open turn … a durable out-of-turn approval workflow is deferred." [R7b] |
| Code runtime | `dsh-code-runtime` | **No** state | "No state survives between runs — every request runs against a fresh world" [R14d] |
| Agent presets | `dsh-agent-presets` | composition durable in log | "The switch is also recorded in the session log, so a resumed or forked session rebuilds under the composition it ran." [R14i] |

Restart semantics for agents: a resumed session rebuilds log-derived context (`ctx.agents.resume`), but nothing re-arms jobs, workflow runs, or in-flight approvals — those are process-local by the statements above. *(inferred)* Any HimaHarness pipeline state (stage, external job ids, gate decisions) must live in a Hima domain table or Hima session events, and reconciliation after restart is Hima's job.

---

## 7. Web UI and client modules

**Declaration and discovery** (`/en/reference/subsystems/client-modules` [D18]; `packages/client/modules/README.md@RC` [R9a]): "A package joins the table by declaring `dsh.client` (`platform: 'web'`, optional `inject` edges, optional `immediately`) in its package.json and exporting its built bundle at `exports["./client"]`." The Node half (`ctx.clientModules`, `ClientModuleRegistry`) "scans the host Loader's entries for packages declaring `dsh.client`, composes the `window.__DSH_BOOT__` entry graph, serves versioned one-or-more-resource combo scripts under `/plugins`". So a Hima bundle ships browser code by (a) inserting a row for its package in its `cordis.patch.yml` (the row is what the scan sees — "Scanning is incremental per package … Every cordis `internal/plugin` emission … marks the fiber's entry name dirty"), (b) declaring `dsh.client`, (c) shipping a prebuilt `lib/client.js`: "The host serves built client bundles, so `pnpm run build` must have produced each `lib/client.js` before launch; a missing bundle fails activation loudly" [R9a]. Bundles "execute lazily — running a bundle only registers a factory, and module side effects run at materialization" [R9a].

**Module sharing and specifier rules** (`packages/client/AGENTS.md@RC` [R9c], SOURCE-ONLY): "The shell seeds a frozen module table (`PLATFORM_MODULES`: React, Cordis, and static UI libraries); every dynamic bundle resolves its externals against exactly that baseline." "Baseline externals are implicit for every dynamic bundle. Do not repeat React, Cordis, `client/store`, `ui-primitives`, or `ui-slots` in package manifests." "`dsh.client.external` is not a feature-plugin dependency mechanism … Declare the exact import specifier; only a trailing `/client` aliases the package row." "Silence means a private copy." Composition "rejects malformed requests, missing suppliers, self-requests, and synchronous request cycles" [R9a]. `dsh.client.inject` edges "are **informational only** (preflight display, HMR diffing); they do not sequence entry activation" [R9c]. I found no rule specific to npm-scoped (`@scope/name`) package names beyond these exact-specifier rules; the browser module id is "the nearest owning package manifest" name [D18]. Startup combo URLs are capped at 3 KiB and stale revisions 404 [D18].

**UI composition** (`/en/reference/subsystems/slots` [D28]): "A feature plugin contributes UI through `ctx.slots.register()` and never imports another feature plugin's component." Contributing into another package's slot uses `ctx.slots.inject(key, callback)` which "runs for each declaration lifetime". Tool cards: "An owning business package registers its wire Tool name into `tool.call.toolview`" with `ctx.slots.inject('tool.call.toolview', () => ctx.slots.register({name:'tool.call.toolview', key:'<wire tool name>'}, Row))`; "Host `presentCall` and `presentResult` values never enter the Client" (`packages/client/ui-tool/README.md@RC` [R9d]; `packages/core/tools/README.md@RC` [R14a]). Layer rule: "A presentation component never receives Cordis `ctx`, a transport object, or another feature plugin's implementation." [R9f].

**Remote-service mechanism** (`/en/reference/api-gateway` [D13]): "Business services use `@Remote` or `@RemoteScope` to select the methods exposed to the Client. Unmarked methods do not enter the generated Client types or runtime contributions and cannot be called through `ctx.remote`." Services "normally extend `TypertRemoteService` so the constructor explicitly binds the Cordis service key and default Remote namespace" (`packages/typert/protocol/src/index.ts@ALPHA` L153 [R10c]). Lookups: an `Agent` parameter "produces an `agentId` wire field, and the Gateway resolves that id to a Host object". Cancellation: final `signal: AbortSignal`. Client side: `inject = ['remote', 'remote.<ns>']`, `ctx.remote.<ns>.<m>()` returns `RemoteResult<T>`; failures are one `RemoteError` with codes merged into `RemoteErrorDetailsMap` (`docs/cookbook/adding-a-remote-api.md@RC` [R10b]).

Constraint for out-of-tree bundles: the Remote contracts are **build-time generated**. "Each contributing business package writes generated files to its own `lib/` directory": `typert.host.js/.d.ts` and `typert.remote-client.js/.d.ts`, produced when "`tsdown --env.DSH_BUILD_FACE host`" runs the generator "with the Host aggregate as its only `ts.Program` seed" [D13]; "Rerun `pnpm run build:lib` after changing a signature" [R10b]; "Client applications assemble only `@deepseek-ai/dsh-api-remotes`. That package imports the `/remote` subpaths of selected business packages … Adding a Host Remote package is an explicit choice by the Client composition owner" [D13]. `@deepseek-ai/dsh-typert-generator` and `-protocol` are published at `0.1.5-alpha.1` (exports `.` and `./tsdown`) [N4], but the docs describe the generator only as part of the repository build; *(inferred)* an out-of-tree bundle must (1) run the generator in its own build with a `ts.Program` that includes its Host face, and (2) either be added to the Client's `api-remotes` assembly or mount its own contribution with `ctx.remote.$mount()` — neither step is documented for external packages, so treat this as the single most build-coupled seam.

**Build-preset coupling** *(inferred from [R9c])*: the externalization the module system expects ("The dynamic build preset externalizes the baseline and rejects undeclared workspace value imports") is implemented by the repository's `packages/client/tsdown.client.ts` and `clientBundle(...)` helper, which are repo files, not a published package. A Hima client bundle must reproduce the same externals list against `PLATFORM_MODULES` (`packages/client/web/src/platform.ts`).

---

## 8. Version delta: `@deepseek-ai/dsh@0.1.2-rc.1` → `@deepseek-ai/dsh@0.1.5-alpha.1`

**npm facts** [N1]: versions published `0.0.1-rc.1 … 0.1.2-rc.1 (2026-09-03), 0.1.3-alpha.2 (2026-09-07), 0.1.5-alpha.1 (2026-09-08)`; there is no `0.1.3-alpha.1` or any `0.1.4*` on npm; dist-tags `latest`=`next`=`0.1.2-rc.1`, `alpha`=`0.1.5-alpha.1`.

**Git tags between** (repo, `git rev-list -n1`, committer dates) [R0]: `dsh-v0.1.2-rc.1` = `a66e470…` (2026-09-03); `dsh-v0.1.3-alpha.1` = `d347e70…` (2026-09-04); `dsh-v0.1.3-alpha.2` = `82a5fd6…` (2026-09-07); `dsh-v0.1.5-alpha.1` = `5dda764…` (2026-09-08). No `dsh-v0.1.4*` tag exists. Tree diff `a66e470…5dda764`: 6,360 files, +183,325/−53,530 (most of it under `.agents/notes/`) [R0].

**GitHub release notes, breaking/renaming items only** (all four releases are `prerelease: true`):

- `dsh-v0.1.2-rc.1` [G1]: "Include enabled plugin package names and versions in official DeepSeek requests; deployments can turn this off"; "Add opt-in incremental Session-log uploads"; `send_message` replaces the one-way `report` subagent tool; "Keep PTC Mode SDK features inside `run_code`".
- `dsh-v0.1.3-alpha.1` [G2]: "**Breaking change:** The Session persistence API is now owned by lifecycle-scoped `SessionHandle`s; `agentLoop.create()` is asynchronous, and a new Session lock ensures that each Session is held by at most one process." "Upgrade the Session format to v2: immutable adjacent-generation migrations convert v0/v1 logs". "All outbound network requests honor `HTTP_PROXY`…". "This release has a known performance regression".
- `dsh-v0.1.3-alpha.2` [G3]: "**Default tool changes:** SDK, Headless, and ACP use read, write, and edit for file editing by default; Web minimal and sdk-minimal are unchanged." "Custom persona configuration is split into a prefix and a suffix; existing configurations and related constants need to be updated." "Remove pid from ordinary subprocess handles; terminal handles are unaffected." "Submit feedback without continuing the conversation. Submissions include the relevant conversation content; ordinary chat does not trigger this reporting."
- `dsh-v0.1.5-alpha.1` [G4]: "**Session format V3:** … record system prompts in message history, and migrate legacy PTC events and `code` preset references. Custom log readers must adapt to V3; downgrade reads are not supported." "**Agent plugin API changes:** Remove `ctx.agent` and require callers to pass the Agent explicitly. Correct ownership of continuable subagents so root-only scheduling excludes them." "**Inbox API changes:** Make `Inbox` a type-only interface instead of an exported runtime class. Plugins access pending messages through `agent.inbox`; `hasPending` and `claim` are no longer public API." "Support dynamic system prompt updates without invalidating KV Cache when the configured model explicitly declares support." "Add an experimental right Sidebar … the Detail panel is removed."

**CLI tarball `package.json`** [N2]: `bin: { dsh: lib/bin.js }`, `files: ["lib/*.js"]`, `dsh.configTrees` (mount `config/agent-presets`) unchanged; **no `engines` field in either version**; `dependencies` gained `@deepseek-ai/dsh-http-proxy` (all other deps only re-pinned to `^0.1.5-alpha.1`); `devDependencies` gained `@deepseek-ai/dsh-agent-loop` and `@deepseek-ai/dsh-agent-loop-testkit`. `lib/` still has five chunk files (`bin.js`, `dump-config-*.js`, `plugin-*.js`, two `profile-boot-*.js`). README adds `--from-default-profile <template>` and reserves the `desktop` profile name.

**Bundled-plugin lists**: `@deepseek-ai/dsh-base` dependencies lost `@deepseek-ai/dsh-tool-str-replace-editor` (its base row is gone) [N3k] [R3a]. `@deepseek-ai/dsh-web-app` dependencies gained `dsh-api-workspace-files`, `dsh-client-file-upload`, `dsh-client-resources`, `dsh-client-ui-open-in-app`, `dsh-client-ui-sidebar-files`, `dsh-client-ui-sidebar-right`, `dsh-client-ui-sidebar-textpreview`, `dsh-host-open-in-app` [N3l]. Workspace packages added (none removed): `api/workspace-files`, `client/file-upload`, `client/resources`, `client/ui-dockkit`, `client/ui-open-in-app`, `client/ui-sidebar-files`, `client/ui-sidebar-right`, `client/ui-sidebar-textpreview`, `host/open-in-app`, `session/session-format`, `session/session-format-catalog`, `session/session-format-v0-to-v1`, `-v1-to-v2`, `-v2-to-v3`, `util/http-proxy`, `util/package-manifest` [R0]. `dsh-base` patch diff: `system-prompt.config.persona: ''` → `personaPrefix: ''`; `tool-str-replace-editor` row removed; telemetry comment rewritten [R3a].

**Published `.d.ts` deltas** (diff of `lib/types/*.d.ts` between the two packed versions) [N3]:

| Package | Files differing | Concrete change |
|---|---|---|
| `dsh-agent` | 5 (155+/35−) | `AgentSetup = (agentCtx: Context) => …` → `(agentCtx: Context, agent: Agent) => …`; `CreateAgentOptions`/`ResumeAgentOptions` gain `readonly parentAgent?: Agent`; `export * from './inbox'` removed — `Inbox` is now an interface in `runtime-types.d.ts` with `nextTurn`, `nextStep`, `clear`, `append`, `prepend`, `replace`, `remove`, `splice` (no `hasPending`/`claim`); the `ctx.accessor('agent', …)` DX accessor is removed from `index.js`; new `AssistantStreamFrame` type and `agent/assistant-stream` event; `InboxState`/`InboxWireState` projection types; `Agent.followup/steer/inject/send/cancel/whenIdle` signatures unchanged |
| `dsh-agent-loop` | 5 | `create(id, options?, meta?): Agent` → `Promise<Agent>` |
| `dsh-commands` | 3 | `execute(agent, line, images: readonly EncodedImageAttachment[], signal)` → `execute(agent, line, submittedAttachments: readonly CommandSubmitAttachment[], signal)`; `input.images` → `input.attachments`; `attachments: readonly (ImageBlock \| FileBlock)[]`; new `registerFileReceiptResolver(resolver)` |
| `dsh-system-prompt` | 1 | `Config.persona` → `personaPrefix` + `personaSuffix`; `PERSONA_SECTION` → `PERSONA_PREFIX_SECTION`/`PERSONA_SUFFIX_SECTION`; order constants `HARNESS_SOURCE -900→10000`, `WEB_SURFACE -800→10100`, `DEPLOYMENT_PERSONA 0` → `DEPLOYMENT_PERSONA_PREFIX 0` + `DEPLOYMENT_PERSONA_SUFFIX 10200` |
| `dsh-tools` | 2 | session event ids `tool/code-dispatch-start`/`tool/code-dispatch` → `tool/ptc-dispatch-start`/`tool/ptc-dispatch`; sub-call id suffix `:code:` → `:ptc:`; `ToolRuntime` method set unchanged |
| `dsh-session` | 5 (149+/112−) | `Session.fromRestore(...)` gains `eventState: SessionSeedEventState`; `SurfaceIntent` → `SurfaceIntent<T>`; `SystemMessage` exported; `decodeStorageRecord`/`packChunkRuns`/`ChunkRow`/`StorageRecord` exports removed; new `system/message` and `assistant/attempt` handling |
| `dsh-session-persistence-jsonl` | 8 (244+/117−) | handle-based API, v2/v3 generation files, session lock |
| `dsh-subprocess` | 2 | `readonly pid: number` removed from the ordinary handle |
| `dsh-api-gateway` | 2 | `RemoteJournalFrame/Change/StreamOptions/RemoteJournalStream` gain a `Notification = never` type parameter; gateway `types.d.ts` adds `readonly agentId: string` |
| `dsh-workspace` | 3 (33+/15−) | additive |
| `dsh-client-modules` | 1 (10+/1−) | additive |
| `dsh-shell` 1, `dsh-code-runtime` 1, `dsh-storage-domain` 1 | trivial | comment/import-level |
| **Unchanged** | 0 | `dsh-user-approval`, `dsh-skill`, `dsh-skill-filesystem`, `dsh-agent-presets`, `dsh-mcp-client`, `dsh-sandbox`, `dsh-sandbox-policy`, `dsh-permission-presets`, `dsh-jobs`, `dsh-workflow`, `dsh-scope`, `dsh-tool-skill`, `dsh-settings`, `dsh-base`, `dsh-web-app` |

Docs-level changes in the same window: `docs/subsystems/persistence.md@ALPHA` now describes `create`/`open`/`stat`/`list` returning `SessionHandle` [R12h]; 0.1.5-alpha.1 CLI reference adds `--from-default-profile` [R4].

No `CHANGELOG*` file exists in the repository or tarballs at either version; release notes on GitHub are the only changelog [R0] [N2].

---

## 9. Telemetry and privacy

Four distinct outbound channels exist; only the first is on by default for plugin metadata.

1. **`dsh_plugin_packages` (default ON)** — `@deepseek-ai/dsh-plugin-package-inventory-deepseek` "owns the `dsh_plugin_packages` field"; config `enabled` default `true`: "Shipped profiles use the default, so every official DeepSeek request carries the package inventory when preparation succeeds." Content: "The version-1 `dsh_plugin_packages` field contains only `{ name, version }` pairs" for "active non-group entries from the host Loader tree" plus the session's standing agent-preset tree; disabled/pending/failed rows, loose modules and in-memory dynamic plugins are excluded (`packages/llm/plugin-package-inventory-deepseek/README.md@RC` [R13a]; wire schema in `docs/deepseek-llm-api-wire-extensions.md@ALPHA` [R13c]). Applies only to the `deepseek-official` route: "The provider-neutral LLM interface and `llm-pi-ai` do not implement these additions" [R13c]. Mounted in `dsh-base` (row `plugin-package-inventory-deepseek`) and in `sdk-minimal` [R3a] [R3d]. **Disable**: patch the row in the profile's `cordis.patch.yml` — `- id: plugin-package-inventory-deepseek\n  config: { enabled: false }` (omits the whole field) or `disabled: true` ("disabling the contributor omits the entire `dsh_plugin_packages` field" [R13c]).
2. **`dsh_session_log` (default OFF)** — `@deepseek-ai/dsh-session-log-deepseek`, `enabled` default `false`; when enabled sends "the contiguous suffix after the watermark" of the canonical session log with each DeepSeek request; at-least-once (`packages/session/session-log-deepseek/README.md@RC` [R13b]).
3. **Request headers (always on for `deepseek-official`)** — `user-agent` (`deepseek-harness/<version> (+url)`; "nothing can suppress attribution entirely", `packages/llm/llm/src/attribution.ts@RC` L37–38 [R13e]), `x-deepseek-harness-user-id` ("The stable anonymous UUID for the resolved Harness home", stored at `$DSH_HOME/.anonymous-user-id`), `x-deepseek-harness-session-id`, `x-deepseek-harness-compact` [R13c] [R3a L179–180].
4. **OTel session telemetry (default `FEEDBACK_ONLY`)** — base row `session-telemetry-otel`: `mode: !!js process.env.DSH_TELEMETRY_MODE || 'FEEDBACK_ONLY'`, exporter `url: !!js process.env.DSH_TELEMETRY_OTLP_URL ?? 'https://harness-telemetry.deepseeksvc.com/v1/logs'` (`packages/bundle/base/cordis.patch.yml@RC` L190–204 [R3a]). CLI reference @ALPHA: "The base defaults to `FEEDBACK_ONLY`: new own text feedback, message ratings, edits, and withdrawals release the complete canonical prefix through that event, including stored context … Requests, restoration, mount, and HMR do not trigger capture. `DSH_TELEMETRY_MODE=DISABLED` disables OTel delivery; `FULL` is rejected, and any non-empty `DSH_TELEMETRY_DISABLED` disables its row … These OTel settings do not enable or disable the DeepSeek contribution. Neither path changes model input, but exports can include message text, tool arguments and results, and workspace paths." [R4]. The launcher implements `DSH_TELEMETRY_DISABLED` as a boot overlay that disables the `session-telemetry-otel` row (`apps/cli/src/profile-boot.ts@RC` L76–97 [R13g]); "config cannot disable a row" [R3a L177–178].

Documented tension: `packages/bundle/base/README.md@RC` says "Telemetry stays off unless you opt in" [R3c] while the inventory README and release notes describe `dsh_plugin_packages` as default-on request metadata [R13a] [G1]. *(inferred)* For a customer deployment of HimaHarness, ship a profile patch that sets `plugin-package-inventory-deepseek.config.enabled: false` (so Hima plugin names/versions never leave the machine), leaves `session-log-deepseek` at its off default, and sets `DSH_TELEMETRY_DISABLED=1` in the launch environment; the `user-agent` and anonymous-user-id headers cannot be removed without replacing the adapter.

---

## 10. Recommendations for HimaHarness (derived strictly from §1–§9)

### 10.1 Build on directly (documented-public, `.d.ts` unchanged rc.1 → alpha.1)

- Plugin shape and composition: `apply/inject/Service/effect/plugin`, Schemastery `Config`, `cordis.patch.yml` bundle with `dsh.bundle.patch`, `insert` rows, `id`-targeted overrides, `cordis:group` + `isolate` [D2–D8, D5].
- Tools: `defineTool` + `ctx.tools.register`, `guard`, `restrict`, `tools/pre-execute|execute|post-execute|result` [D3, D24, D15].
- Approval and permissions: `tools/pre-execute → {kind:'ask'}`, `ctx.approval.request`, `approval/request` answerers, `ctx.permissionPresets`, `permission` settings namespace [D16, D17].
- Skills: `ctx.skills.registerProvider` (the `skill-badge` pattern), `dsh-skill-filesystem` rows with `includeDefaultRoots:false` + `customSkillDirs`, `dsh-tool-skill` `/name` invocation [D19, R11].
- Agent presets: a Hima `agent.cordis.yml` + `preset.yml` under a configured `roots` entry (or `includeShippedRoot:false` for a Hima-only roster) [R14i, R19].
- Durable state: `defineDomain` + `ctx.storageDomain` for Pack/Run/Gate records; `SessionEventMap` extension for replayable facts [D23, D22].
- Execution: `ctx.shell`, `ctx.sandbox` policy, `ctx.subprocess.spawn` (avoid reading `pid`), MCP client rows [D9, R14f–h, D33].
- Human commands: `ctx.commands.register` (use `input.attachments`, the 0.1.5 name) [D26].

### 10.2 Wrap behind a Hima-owned interface (volatile in this window, or source-only)

- **Agent creation and driving**: `ctx.agents.create/resume`, `AgentSetup`, `AgentHandle`, `agent.inbox` — changed in 0.1.5-alpha.1 (`AgentSetup(agentCtx, agent)`, `parentAgent`, `ctx.agent` removed, `Inbox` type-only). Wrap as `HimaAgentFactory.create(spec) → {agent, dispose}` and `HimaAgentDriver.followup/steer/inject`. Never touch `ctx.agentLoop` ("swappable") or `Inbox.claim`.
- **System prompt**: `persona` → `personaPrefix/personaSuffix` and reordered constants. Wrap `ctx.systemPrompt.section/variable` behind `HimaPrompt.contribute(agentCtx, …)`; do not depend on numeric order constants.
- **Session log reading/writing**: format v2→v3 in one week; `SessionHandle` API introduced; PTC event ids renamed. Read history only through `ctx.sessions`/`ctx.sessionQuery`, never parse JSONL; wrap any `SessionEventMap` extension in one Hima module so a v4 migration touches one file.
- **Commands**: attachment vocabulary changed; wrap registration so Hima handlers receive a Hima `Attachment` type.
- **Remote API and browser UI**: Typert generation is coupled to the repo build (`DSH_BUILD_FACE host` + `api-remotes` assembly) and slot/presentation packages are "expected to be rewritten wholesale". Keep Hima's Host↔Client contract in one `HimaRemote` service (one namespace, few methods, `RemoteError` codes) and one client entry; treat every `ui-*` import as replaceable.
- **Telemetry rows**: ids/config changed between tags; keep the "privacy patch" (inventory off, OTel disabled) as a single Hima-owned overlay file that a contract test asserts against `--dump-config`.
- **Jobs/workflow**: process-local; wrap `ctx.jobs.start` behind a Hima job ledger that records external job identities durably (`defineDomain`) and reconciles on boot.

### 10.3 Do not depend on

`experimental/*` (unpublished), `e2b/*` (POC), `util/`, `test-support/`, `runtime-diagnostics/` (lower compatibility) [R6]; `ui-dockkit` [R24]; `--dump-config` byte layout [R2]; `ctx.agent` accessor, `Inbox.hasPending/claim`, sync `agentLoop.create`, `tool-str-replace-editor` base row, `subprocess` handle `pid` (all removed) [N3, G3, G4]; sub-package npm dist-tags [N4].

### 10.4 Minimal "booted-host contract test" per seam

Tooling available from dsh itself: `@deepseek-ai/dsh-loader-smoke` ("boot an application fixture from its real bin and `cordis.yml` in an isolated temporary directory … `runFixtureTurn` drives one task through the configured root agent") [R18b], `dsh-llm-replay` for keyless model streams [R18a], `@deepseek-ai/dsh-agent-loop-testkit` (`mountAgentLoopTestDependencies`, `mountAgentLoopTestHarness`) [R18c] — all support-tier, so pin exactly and expect churn. `dsh --profile hima --dump-config` is the composition oracle [R4].

| Seam | Test (one Hima profile = `dsh-base` + `hima-bundle` + privacy overlay) |
|---|---|
| Composition | `--dump-config` contains every Hima row id; `plugin-package-inventory-deepseek.config.enabled === false`; `session-telemetry-otel.disabled === true`; boot exits 0 with all fibers ACTIVE (loader-smoke) |
| Tools | register a Hima tool; `ctx.tools.schemas(scope)` lists it; `tools/pre-execute` returning `ask` with no answerer yields a denied result containing "no approval channel" (fail-closed); `guard` denial cannot be reversed by a later `allow` |
| Approval | an agent-scoped `approval/request` answerer returns `allowed-once` and `approval/asked`/`approval/decided` appear in the session log; under `never` policy the answerer is never invoked |
| Skills | provider registered via `registerProvider` appears in `ctx.skills.list({cwd})`; `/hima-grill` in user input injects the body (observe `session/event`); catalog message is appended before the first request |
| Presets | `ctx.agentPresets.resolve('hima')` succeeds; `create({setup: (agentCtx) => presets.mount(agentCtx,'hima')})` composes; a second session shares the composition; preset switch after content is refused |
| Agent driver | `create` → `followup` → `whenIdle`; `agent/pre-step` rewrite is observed; `dispose()` reaches quiescence; `parentAgent` ownership reflected in `isOwnedBy` |
| Storage domain | `open(spec)`; `put/get/update`; `domain/changed` fires; reopen after process restart returns the record; `version-mismatch` on bumped spec |
| Session persistence | create → append → `flush` → restart → `resume` replays Hima events; second process `open(id,'write')` fails on the session lock |
| Jobs/workflow | job started by a Hima tool is listed by `job_list`, cancelled on agent dispose; assert (negatively) that no job record exists after restart |
| Commands | `execute(agent, '/hima-spec …', [], signal)` runs without a model turn; `command/run`/`command/done` logged |
| Subprocess/shell/sandbox | `ctx.shell.run` under `workspace-write` denies a write outside the workspace with the `[sandbox: …]` marker; escalation retry with `sandbox_permissions` triggers exactly one approval |
| MCP | a stdio server row exposes `mcp__hima__<tool>`; reconnect after child crash |
| Client module | `dsh.client` package row yields an entry in `ctx.clientModules.graph()`; `/plugins/??<pkg>/client.js&rev=…` serves 200; `tool.call.toolview` registration for a Hima tool renders (jsdom bench from `test-support/client-runtime`) |
| Remote API | generated `typert.remote-client.js` mounts; `ctx.remote.hima.<m>()` round-trips; a thrown `RemoteError('hima/…')` reaches the client as `result.error.code` |

Run the whole suite against the pinned `0.1.5-alpha.1` set and again whenever the `alpha` dist-tag moves; the §8 table is the expected blast radius per bump (agent/session/prompt/commands seams first, approval/skills/presets/storage/jobs seams historically stable).

---

## Sources

Docs site (fetched 2026-09-08; routes confirmed by `llms.txt`):

- [D1] https://deepseek-harness.github.io/deepseek-harness/en/guide/quickstart
- [D2] https://deepseek-harness.github.io/deepseek-harness/en/develop/basic/
- [D3] https://deepseek-harness.github.io/deepseek-harness/en/develop/basic/tool
- [D4] https://deepseek-harness.github.io/deepseek-harness/en/develop/basic/config
- [D5] https://deepseek-harness.github.io/deepseek-harness/en/develop/basic/publish
- [D6] https://deepseek-harness.github.io/deepseek-harness/en/develop/framework/
- [D7] https://deepseek-harness.github.io/deepseek-harness/en/develop/framework/service
- [D8] https://deepseek-harness.github.io/deepseek-harness/en/develop/framework/events
- [D9] https://deepseek-harness.github.io/deepseek-harness/en/develop/practice/
- [D10] https://deepseek-harness.github.io/deepseek-harness/en/develop/practice/dynamic-cordis
- [D11] https://deepseek-harness.github.io/deepseek-harness/en/reference/ (Architecture)
- [D12] https://deepseek-harness.github.io/deepseek-harness/en/reference/cordis-primer
- [D13] https://deepseek-harness.github.io/deepseek-harness/en/reference/api-gateway
- [D14] https://deepseek-harness.github.io/deepseek-harness/en/reference/cookbook/extension-cookbook
- [D15] https://deepseek-harness.github.io/deepseek-harness/en/reference/cookbook/adding-a-tool
- [D16] https://deepseek-harness.github.io/deepseek-harness/en/reference/subsystems/approval
- [D17] https://deepseek-harness.github.io/deepseek-harness/en/reference/subsystems/permission-presets
- [D18] https://deepseek-harness.github.io/deepseek-harness/en/reference/subsystems/client-modules
- [D19] https://deepseek-harness.github.io/deepseek-harness/en/reference/subsystems/skills
- [D20] https://deepseek-harness.github.io/deepseek-harness/en/reference/subsystems/jobs
- [D21] https://deepseek-harness.github.io/deepseek-harness/en/reference/subsystems/workflow
- [D22] https://deepseek-harness.github.io/deepseek-harness/en/reference/subsystems/persistence
- [D23] https://deepseek-harness.github.io/deepseek-harness/en/reference/subsystems/storage
- [D24] https://deepseek-harness.github.io/deepseek-harness/en/reference/subsystems/tools
- [D25] https://deepseek-harness.github.io/deepseek-harness/en/reference/subsystems/core
- [D26] https://deepseek-harness.github.io/deepseek-harness/en/reference/subsystems/commands
- [D27] https://deepseek-harness.github.io/deepseek-harness/en/reference/subsystems/code-runtime
- [D28] https://deepseek-harness.github.io/deepseek-harness/en/reference/subsystems/slots
- [D29] https://deepseek-harness.github.io/deepseek-harness/en/reference/subsystems/web-client
- [D30] https://deepseek-harness.github.io/deepseek-harness/en/reference/subsystems/session-telemetry
- [D32] https://deepseek-harness.github.io/deepseek-harness/llms.txt
- [D33] https://deepseek-harness.github.io/deepseek-harness/en/guide/mcp-memory

Repository `deepseek-ai/deepseek-harness` (RC = `a66e4702047846cdaa10c66c9d3df3951f5ea70d`, ALPHA = `5dda764ed3aa172535a7967b06ff95d9cbfe536a`):

- [R0] tags and tree diff: `git rev-list -n1 dsh-v0.1.2-rc.1 | dsh-v0.1.3-alpha.1 | dsh-v0.1.3-alpha.2 | dsh-v0.1.5-alpha.1`; `git diff --stat a66e470 5dda764`; `package.json` at both tags (https://github.com/deepseek-ai/deepseek-harness/blob/a66e4702047846cdaa10c66c9d3df3951f5ea70d/package.json, https://github.com/deepseek-ai/deepseek-harness/blob/5dda764ed3aa172535a7967b06ff95d9cbfe536a/package.json)
- [R1] https://github.com/deepseek-ai/deepseek-harness/blob/a66e4702047846cdaa10c66c9d3df3951f5ea70d/docs/architecture.md
- [R2] https://github.com/deepseek-ai/deepseek-harness/blob/a66e4702047846cdaa10c66c9d3df3951f5ea70d/packages/boot/app-boot/README.md
- [R3a] https://github.com/deepseek-ai/deepseek-harness/blob/a66e4702047846cdaa10c66c9d3df3951f5ea70d/packages/bundle/base/cordis.patch.yml (and the same path at 5dda764… for the diff)
- [R3b] https://github.com/deepseek-ai/deepseek-harness/blob/a66e4702047846cdaa10c66c9d3df3951f5ea70d/packages/bundle/web-app/cordis.patch.yml
- [R3c] https://github.com/deepseek-ai/deepseek-harness/blob/a66e4702047846cdaa10c66c9d3df3951f5ea70d/packages/bundle/base/README.md
- [R3d] https://github.com/deepseek-ai/deepseek-harness/blob/a66e4702047846cdaa10c66c9d3df3951f5ea70d/packages/bundle/sdk-minimal/cordis.patch.yml; headless, sdk-app, acp-app `cordis.patch.yml` and `package.json` under the same `packages/bundle/` tree; https://github.com/deepseek-ai/deepseek-harness/blob/a66e4702047846cdaa10c66c9d3df3951f5ea70d/packages/bundle/README.md
- [R4] https://github.com/deepseek-ai/deepseek-harness/blob/5dda764ed3aa172535a7967b06ff95d9cbfe536a/apps/cli/reference/README.md
- [R5] https://github.com/deepseek-ai/deepseek-harness/blob/5dda764ed3aa172535a7967b06ff95d9cbfe536a/README.md
- [R6] https://github.com/deepseek-ai/deepseek-harness/blob/5dda764ed3aa172535a7967b06ff95d9cbfe536a/packages/README.md
- [R7a] https://github.com/deepseek-ai/deepseek-harness/blob/a66e4702047846cdaa10c66c9d3df3951f5ea70d/docs/subsystems/approval.md
- [R7b] https://github.com/deepseek-ai/deepseek-harness/blob/a66e4702047846cdaa10c66c9d3df3951f5ea70d/packages/interaction/user-approval/README.md
- [R7c] https://github.com/deepseek-ai/deepseek-harness/blob/a66e4702047846cdaa10c66c9d3df3951f5ea70d/packages/core/tools/src/index.ts (L129–150, L576–584, L1670–1718); https://github.com/deepseek-ai/deepseek-harness/blob/a66e4702047846cdaa10c66c9d3df3951f5ea70d/packages/sandbox/sandbox/src/escalation.ts
- [R8a] https://github.com/deepseek-ai/deepseek-harness/blob/a66e4702047846cdaa10c66c9d3df3951f5ea70d/docs/subsystems/permission-presets.md
- [R8b] https://github.com/deepseek-ai/deepseek-harness/blob/a66e4702047846cdaa10c66c9d3df3951f5ea70d/packages/interaction/permission-presets/README.md
- [R9a] https://github.com/deepseek-ai/deepseek-harness/blob/a66e4702047846cdaa10c66c9d3df3951f5ea70d/packages/client/modules/README.md
- [R9b] https://github.com/deepseek-ai/deepseek-harness/blob/a66e4702047846cdaa10c66c9d3df3951f5ea70d/docs/subsystems/client-modules.md
- [R9c] https://github.com/deepseek-ai/deepseek-harness/blob/a66e4702047846cdaa10c66c9d3df3951f5ea70d/packages/client/AGENTS.md
- [R9d] https://github.com/deepseek-ai/deepseek-harness/blob/a66e4702047846cdaa10c66c9d3df3951f5ea70d/packages/client/ui-tool/README.md
- [R9e] https://github.com/deepseek-ai/deepseek-harness/blob/5dda764ed3aa172535a7967b06ff95d9cbfe536a/docs/subsystems/slots.md
- [R9f] https://github.com/deepseek-ai/deepseek-harness/blob/5dda764ed3aa172535a7967b06ff95d9cbfe536a/docs/subsystems/web-client.md
- [R10a] https://github.com/deepseek-ai/deepseek-harness/blob/5dda764ed3aa172535a7967b06ff95d9cbfe536a/docs/api-gateway.md
- [R10b] https://github.com/deepseek-ai/deepseek-harness/blob/a66e4702047846cdaa10c66c9d3df3951f5ea70d/docs/cookbook/adding-a-remote-api.md
- [R10c] https://github.com/deepseek-ai/deepseek-harness/blob/5dda764ed3aa172535a7967b06ff95d9cbfe536a/packages/typert/protocol/src/index.ts; https://github.com/deepseek-ai/deepseek-harness/blob/5dda764ed3aa172535a7967b06ff95d9cbfe536a/packages/typert/generator/README.md
- [R11a] https://github.com/deepseek-ai/deepseek-harness/blob/a66e4702047846cdaa10c66c9d3df3951f5ea70d/packages/skill/skill/README.md
- [R11b] https://github.com/deepseek-ai/deepseek-harness/blob/a66e4702047846cdaa10c66c9d3df3951f5ea70d/packages/skill/skill-filesystem/README.md
- [R11c] https://github.com/deepseek-ai/deepseek-harness/blob/a66e4702047846cdaa10c66c9d3df3951f5ea70d/packages/skill/tool-skill/README.md
- [R11d] https://github.com/deepseek-ai/deepseek-harness/blob/a66e4702047846cdaa10c66c9d3df3951f5ea70d/docs/subsystems/skills.md
- [R11e] https://github.com/deepseek-ai/deepseek-harness/blob/a66e4702047846cdaa10c66c9d3df3951f5ea70d/packages/skill/skill-badge/src/index.ts
- [R12a] https://github.com/deepseek-ai/deepseek-harness/blob/a66e4702047846cdaa10c66c9d3df3951f5ea70d/packages/jobs/jobs-local/README.md
- [R12b] https://github.com/deepseek-ai/deepseek-harness/blob/a66e4702047846cdaa10c66c9d3df3951f5ea70d/docs/subsystems/jobs.md
- [R12c] https://github.com/deepseek-ai/deepseek-harness/blob/a66e4702047846cdaa10c66c9d3df3951f5ea70d/packages/workflow/workflow/README.md
- [R12d] https://github.com/deepseek-ai/deepseek-harness/blob/a66e4702047846cdaa10c66c9d3df3951f5ea70d/packages/schedule/schedule/README.md
- [R12e] https://github.com/deepseek-ai/deepseek-harness/blob/a66e4702047846cdaa10c66c9d3df3951f5ea70d/packages/storage/storage-domain/README.md
- [R12f] https://github.com/deepseek-ai/deepseek-harness/blob/5dda764ed3aa172535a7967b06ff95d9cbfe536a/packages/session/session-persistence-jsonl/README.md (and the RC version for "Durability and crash semantics")
- [R12g] https://github.com/deepseek-ai/deepseek-harness/blob/a66e4702047846cdaa10c66c9d3df3951f5ea70d/packages/goal/goal/README.md
- [R12h] https://github.com/deepseek-ai/deepseek-harness/blob/5dda764ed3aa172535a7967b06ff95d9cbfe536a/docs/subsystems/persistence.md
- [R13a] https://github.com/deepseek-ai/deepseek-harness/blob/a66e4702047846cdaa10c66c9d3df3951f5ea70d/packages/llm/plugin-package-inventory-deepseek/README.md
- [R13b] https://github.com/deepseek-ai/deepseek-harness/blob/a66e4702047846cdaa10c66c9d3df3951f5ea70d/packages/session/session-log-deepseek/README.md
- [R13c] https://github.com/deepseek-ai/deepseek-harness/blob/5dda764ed3aa172535a7967b06ff95d9cbfe536a/docs/deepseek-llm-api-wire-extensions.md
- [R13d] https://github.com/deepseek-ai/deepseek-harness/blob/a66e4702047846cdaa10c66c9d3df3951f5ea70d/packages/llm/llm-deepseek/README.md
- [R13e] https://github.com/deepseek-ai/deepseek-harness/blob/a66e4702047846cdaa10c66c9d3df3951f5ea70d/packages/llm/llm/src/attribution.ts
- [R13f] https://github.com/deepseek-ai/deepseek-harness/blob/a66e4702047846cdaa10c66c9d3df3951f5ea70d/docs/subsystems/session-telemetry.md
- [R13g] https://github.com/deepseek-ai/deepseek-harness/blob/a66e4702047846cdaa10c66c9d3df3951f5ea70d/apps/cli/src/profile-boot.ts (L76–97, L170–171)
- [R14a] https://github.com/deepseek-ai/deepseek-harness/blob/a66e4702047846cdaa10c66c9d3df3951f5ea70d/packages/core/tools/README.md
- [R14b] https://github.com/deepseek-ai/deepseek-harness/blob/a66e4702047846cdaa10c66c9d3df3951f5ea70d/packages/core/system-prompt/README.md
- [R14c] https://github.com/deepseek-ai/deepseek-harness/blob/a66e4702047846cdaa10c66c9d3df3951f5ea70d/packages/interaction/commands/README.md
- [R14d] https://github.com/deepseek-ai/deepseek-harness/blob/a66e4702047846cdaa10c66c9d3df3951f5ea70d/packages/code-runtime/code-runtime/README.md
- [R14e] https://github.com/deepseek-ai/deepseek-harness/blob/a66e4702047846cdaa10c66c9d3df3951f5ea70d/packages/mcp/mcp-client/README.md
- [R14f] https://github.com/deepseek-ai/deepseek-harness/blob/a66e4702047846cdaa10c66c9d3df3951f5ea70d/packages/subprocess/subprocess/README.md
- [R14g] https://github.com/deepseek-ai/deepseek-harness/blob/a66e4702047846cdaa10c66c9d3df3951f5ea70d/packages/shell/shell/README.md
- [R14h] https://github.com/deepseek-ai/deepseek-harness/blob/a66e4702047846cdaa10c66c9d3df3951f5ea70d/packages/sandbox/sandbox/README.md
- [R14i] https://github.com/deepseek-ai/deepseek-harness/blob/a66e4702047846cdaa10c66c9d3df3951f5ea70d/packages/preset/agent-presets/README.md
- [R14j] https://github.com/deepseek-ai/deepseek-harness/blob/a66e4702047846cdaa10c66c9d3df3951f5ea70d/packages/settings/settings-file/README.md
- [R15a] https://github.com/deepseek-ai/deepseek-harness/blob/a66e4702047846cdaa10c66c9d3df3951f5ea70d/packages/api/session-controller/src/agent.ts (L378–385)
- [R15b] https://github.com/deepseek-ai/deepseek-harness/blob/a66e4702047846cdaa10c66c9d3df3951f5ea70d/packages/bundle/headless/src/index.ts (L185–191)
- [R15c] https://github.com/deepseek-ai/deepseek-harness/blob/a66e4702047846cdaa10c66c9d3df3951f5ea70d/packages/webhook/webhook/src/session.ts (L129–142)
- [R16] https://github.com/deepseek-ai/deepseek-harness/blob/5dda764ed3aa172535a7967b06ff95d9cbfe536a/vendor/README.md
- [R17] https://github.com/deepseek-ai/deepseek-harness/blob/5dda764ed3aa172535a7967b06ff95d9cbfe536a/docs/cordis-primer.md
- [R18a] https://github.com/deepseek-ai/deepseek-harness/blob/5dda764ed3aa172535a7967b06ff95d9cbfe536a/packages/test-support/README.md
- [R18b] https://github.com/deepseek-ai/deepseek-harness/blob/5dda764ed3aa172535a7967b06ff95d9cbfe536a/packages/test-support/loader-smoke/README.md
- [R18c] https://github.com/deepseek-ai/deepseek-harness/blob/5dda764ed3aa172535a7967b06ff95d9cbfe536a/packages/test-support/agent-loop-testkit/README.md
- [R19] https://github.com/deepseek-ai/deepseek-harness/blob/a66e4702047846cdaa10c66c9d3df3951f5ea70d/packages/preset/agent-presets/presets/standard/agent.cordis.yml; https://github.com/deepseek-ai/deepseek-harness/blob/a66e4702047846cdaa10c66c9d3df3951f5ea70d/packages/preset/agent-presets/presets/standard/preset.yml
- [R20] https://github.com/deepseek-ai/deepseek-harness/blob/5dda764ed3aa172535a7967b06ff95d9cbfe536a/docs/user/develop/basic/publish.md (source of [D5]); sibling files under `docs/user/develop/` and `docs/user/guide/` at the same commit are the sources of [D2]–[D10]
- [R21] https://github.com/deepseek-ai/deepseek-harness/blob/5dda764ed3aa172535a7967b06ff95d9cbfe536a/apps/cli/composition.md
- [R22] https://github.com/deepseek-ai/deepseek-harness/blob/5dda764ed3aa172535a7967b06ff95d9cbfe536a/docs/capability-seams.md
- [R23] https://github.com/deepseek-ai/deepseek-harness/blob/5dda764ed3aa172535a7967b06ff95d9cbfe536a/packages/hooks/hooks-claude-code/README.md
- [R24] https://github.com/deepseek-ai/deepseek-harness/blob/5dda764ed3aa172535a7967b06ff95d9cbfe536a/docs/subsystems/sidebar-right.md
- [R25] https://github.com/deepseek-ai/deepseek-harness/blob/5dda764ed3aa172535a7967b06ff95d9cbfe536a/docs/subsystems/scope.md
- [R26] https://github.com/deepseek-ai/deepseek-harness/blob/5dda764ed3aa172535a7967b06ff95d9cbfe536a/docs/subsystems/session.md (L675)
- [R27] https://github.com/deepseek-ai/deepseek-harness/blob/5dda764ed3aa172535a7967b06ff95d9cbfe536a/SAFETY.md
- [R28] https://github.com/deepseek-ai/deepseek-harness/blob/5dda764ed3aa172535a7967b06ff95d9cbfe536a/docs/cookbook/extension-cookbook.md (source of [D14])

npm (registry reads and `npm pack` on 2026-09-08; tarballs extracted under the session scratchpad `dsh-research/tarballs/` and `dsh-research/pkgs/`):

- [N1] `npm view @deepseek-ai/dsh versions time dist-tags --json`
- [N2] `deepseek-ai-dsh-0.1.2-rc.1.tgz` → `package/package.json`, `package/README.md`, `package/lib/*`; `deepseek-ai-dsh-0.1.5-alpha.1.tgz` → same paths
- [N3] per-package tarballs at both versions: [N3a] `deepseek-ai-dsh-agent-<v>.tgz` → `package/lib/types/{index,runtime-types,types}.d.ts` and `index.js`; [N3b] `dsh-agent-loop` → `lib/types/index.d.ts`; [N3c] `dsh-commands` → `lib/types/index.d.ts`; [N3d] `dsh-system-prompt` → `lib/types/index.d.ts`; [N3e] `dsh-tools` → `lib/types/{types,index,invariant}.d.ts`; [N3f] `dsh-subprocess` → `lib/types/types.d.ts`; [N3g] `dsh-session` → `lib/types/index.d.ts`; [N3h] `dsh-session-persistence-jsonl` → `lib/types/*.d.ts`; [N3i] `dsh-api-gateway` → `lib/types/client/journal-stream.d.ts`, `lib/types/types.d.ts`; [N3j] `dsh-tools` → `package/package.json` (peerDependencies); [N3k] `dsh-base` → `package/package.json`; [N3l] `dsh-web-app` → `package/package.json`; unchanged-set packages: `dsh-user-approval`, `dsh-skill`, `dsh-skill-filesystem`, `dsh-agent-presets`, `dsh-mcp-client`, `dsh-sandbox`, `dsh-sandbox-policy`, `dsh-permission-presets`, `dsh-jobs`, `dsh-workflow`, `dsh-scope`, `dsh-tool-skill`, `dsh-settings`
- [N4] `npm view @deepseek-ai/{dsh-typert-generator,dsh-typert-protocol,dsh-typert-registry,dsh-client-ui-slots,dsh-client-ui-renderer,dsh-client-web,dsh-api-session-controller,dsh-cordis-client-runner,dsh-experimental-agent-team,dsh-experimental-code-runtime-python} version` (experimental packages return E404)

GitHub releases (via `gh api repos/deepseek-ai/deepseek-harness/releases/tags/<tag>`):

- [G1] https://github.com/deepseek-ai/deepseek-harness/releases/tag/dsh-v0.1.2-rc.1
- [G2] https://github.com/deepseek-ai/deepseek-harness/releases/tag/dsh-v0.1.3-alpha.1
- [G3] https://github.com/deepseek-ai/deepseek-harness/releases/tag/dsh-v0.1.3-alpha.2
- [G4] https://github.com/deepseek-ai/deepseek-harness/releases/tag/dsh-v0.1.5-alpha.1
