// @hima-seam app-boot direct
// @hima-seam agent wrapped
// Contract-test support: boot the hima profile in-process exactly the way the dsh launcher does,
// minus the web app layer, so tests can execute commands against a real agent without a browser.
// app-boot is documented-public and used directly — loadProfile, healProfilesModuleFallback, boot,
// assertEntriesActivated. Agent creation is the seam ADR-0001 keeps wrapped, so `createRootAgent`
// below is the one place any test reaches it: no test file calls `agents.create` itself.
import { writeFileSync, realpathSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { boot, loadProfile, healProfilesModuleFallback, assertEntriesActivated } from '@deepseek-ai/dsh-app-boot';
import type { Context } from '@deepseek-ai/cordis';
import type { Agent } from '@deepseek-ai/dsh-agent';
import type { HimaHome } from './dsh-home.ts';
import { repoRoot } from './dsh-home.ts';

const BIN_NAME = 'dsh';
// The launcher anchors on its own realpath; pnpm's isolated layout exposes sibling dsh packages only from there.
const INSTALL_ANCHOR = realpathSync(path.join(repoRoot, 'node_modules/@deepseek-ai/dsh/package.json'));
const ROOT_CONFIG = '# dsh profile root — an empty entry list; the tree is composed as patches.\n[]\n';

export interface InProcessHost {
  readonly ctx: Context;
  dispose(): Promise<void>;
}

/** Boot dsh-base + the Hima bundle + the profile's privacy overlay in this process; rejects unless every entry activates. */
export async function bootInProcess(h: HimaHome, { withWebApp = false } = {}): Promise<InProcessHost> {
  // dsh resolves its home from the process environment (dshHomePath); an in-process host must see the isolated one.
  const saved = { DSH_HOME: process.env.DSH_HOME, DSH_AGENTS_HOME: process.env.DSH_AGENTS_HOME, DSH_TELEMETRY_DISABLED: process.env.DSH_TELEMETRY_DISABLED };
  process.env.DSH_HOME = h.env.DSH_HOME;
  process.env.DSH_AGENTS_HOME = h.env.DSH_AGENTS_HOME;
  process.env.DSH_TELEMETRY_DISABLED = '1';
  const restoreEnv = () => {
    for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  };
  const profile = loadProfile(BIN_NAME, 'hima', INSTALL_ANCHOR, h.home, { userLayer: true });
  await healProfilesModuleFallback({ installAnchor: INSTALL_ANCHOR, profile, home: h.home });
  const rootConfig = path.join(profile.dir, 'cordis.yml');
  writeFileSync(rootConfig, ROOT_CONFIG);
  const layers = profile.layers.filter((l) => withWebApp || l.packageName !== '@deepseek-ai/dsh-web-app');
  const patches = structuredClone([...layers.flatMap((l) => l.patches), ...profile.patches]);
  let ctx: Context;
  try {
    ctx = await boot(BIN_NAME, rootConfig, patches);
    await assertEntriesActivated(ctx, BIN_NAME);
  } catch (err) { restoreEnv(); throw err; }
  return { ctx, dispose: async () => { try { await ctx.fiber.dispose(); } finally { restoreEnv(); } } };
}

/** Create one root agent the way dsh's own headless bundle does; no model request is made until a turn runs. */
export async function createRootAgent(ctx: Context, cwd: string): Promise<Agent> {
  const agents = ctx.get('agents');
  const defaultModel = ctx.get('agentDefaultModel');
  if (!agents || !defaultModel) throw new Error('agents/agentDefaultModel services missing');
  const selection = defaultModel.currentSelection();
  const { agent } = await agents.create({
    sessionId: `session-${randomUUID()}` as never,
    meta: { cwd },
    agentOptions: { provider: selection.provider, model: selection.model },
  });
  await agent.whenIdle();
  return agent;
}
