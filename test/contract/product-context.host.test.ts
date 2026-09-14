// PLS-27: the real Host prompt registry, with no model, Desktop, Site or EDA call.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installPack, timingProbePackId } from './support/pack.ts';
import { createHimaHome } from './support/dsh-home.ts';
import { bootInProcess } from './support/boot-inprocess.ts';
import { writeLocalSite } from './support/site.ts';
import { HIMA_PRODUCT_CONTEXT } from '@hima/harness';

type PromptAssembly = { sections: Array<{ name: string; text: string }>; contexts: Array<{ name: string; text: string }> };

async function assembled(host: Awaited<ReturnType<typeof bootInProcess>>): Promise<PromptAssembly> {
  return host.ctx.systemPrompt.assemble() as Promise<PromptAssembly>;
}

test('the Host contributes stable product identity and a live, path-free Hima inventory', async () => {
  const h = await createHimaHome();
  const host = await bootInProcess(h);
  try {
    const first = await assembled(host);
    assert.equal(first.sections.find((item) => item.name === 'hima:product')?.text, HIMA_PRODUCT_CONTEXT);
    const empty = first.contexts.find((item) => item.name === 'hima:inventory')?.text ?? '';
    assert.match(empty, /Installed HimaPacks: none/);
    assert.match(empty, /Saved Sites: none/);
    assert.match(empty, /Active Campaigns: none/);
    assert.doesNotMatch(empty, new RegExp(h.home.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));

    await installPack(h);
    await writeLocalSite(h);
    await host.ctx.hima.ledger.createRun({ campaignId: 'context-fixture', siteId: 'local', packId: timingProbePackId, status: 'running', currentNode: 'measure' });
    const changed = (await assembled(host)).contexts.find((item) => item.name === 'hima:inventory')?.text ?? '';
    assert.match(changed, new RegExp(`Installed HimaPacks: ${timingProbePackId}`));
    assert.match(changed, /Saved Sites: local/);
    assert.match(changed, new RegExp(`${timingProbePackId} on local is running at measure`));
    assert.doesNotMatch(changed, /run-[0-9a-f-]+/);
    assert.doesNotMatch(changed, /contract\.yml|packsDir|sitesDir|\.ya?ml/);
  } finally {
    await host.dispose();
    await h.dispose();
  }
});

test('the product context tells HimaGuide to answer identity from context without source discovery', () => {
  assert.match(HIMA_PRODUCT_CONTEXT, /general-purpose chat and coding/i);
  assert.match(HIMA_PRODUCT_CONTEXT, /Do not search source code, the filesystem or the web/);
  assert.match(HIMA_PRODUCT_CONTEXT, /visible Campaign Agent owns execution decisions/);
  assert.doesNotMatch(HIMA_PRODUCT_CONTEXT, /Fmax (?:improved|increased)|ready to run/i);
});
