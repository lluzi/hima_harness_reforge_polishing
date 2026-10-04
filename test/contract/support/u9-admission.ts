// U9 admission fixtures use the product's reviewed Campaign file and public tools.
// This helper neither starts a workflow nor writes execution facts.
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { stringify } from 'yaml';
import { createRootAgent, type InProcessHost } from './boot-inprocess.ts';
import { waitUntil } from './fabric.ts';
import type { HimaHome } from './dsh-home.ts';

export function admissionJson(result: { content?: readonly { type: string; text?: string }[] }): any {
  return JSON.parse(result.content?.find(item => item.type === 'text')?.text ?? '{}');
}

export async function admissionProposal(host: InProcessHost, h: HimaHome, pack: string,
  overrides: { goal?: object; strategy?: object; budget?: object } = {}) {
  const guide = await createRootAgent(host.ctx, h.workspace);
  await mkdir(path.join(h.workspace, 'hima'), { recursive: true });
  await writeFile(path.join(h.workspace, 'hima/campaign.yml'), stringify({ schema: 'hima-campaign/1', pack: { id: pack }, site: { name: 'local' }, ...overrides }));
  const prepared = await host.ctx.tools.execute({ name: 'hima_prepare', callId: `admission-prepare-${crypto.randomUUID()}` as never,
    arguments: { pack, site: 'local' }, agent: guide, signal: AbortSignal.timeout(20_000) });
  assert.equal(prepared.isError, false, JSON.stringify(prepared));
  return { guide, proposal: admissionJson(prepared) };
}

export async function confirmAdmission(host: InProcessHost, h: HimaHome, pack: string,
  overrides: { goal?: object; strategy?: object; budget?: object } = {}): Promise<{ runId: string; guide: Awaited<ReturnType<typeof createRootAgent>>; proposal: any; context: Awaited<ReturnType<InProcessHost['ctx']['hima']['readExecutionContext']>> }> {
  const { guide, proposal } = await admissionProposal(host, h, pack, overrides);
  assert.equal(proposal.ready, true, JSON.stringify(proposal));
  const answer = await host.ctx.tools.execute({ name: 'hima_run', callId: `admission-confirm-${crypto.randomUUID()}` as never,
    arguments: { pack, site: 'local', proposalId: proposal.id, goal: proposal.goal, strategy: proposal.strategy },
    agent: guide, signal: AbortSignal.timeout(20_000) });
  assert.equal(answer.isError, false, JSON.stringify(answer));
  const runId = admissionJson(answer).runId;
  assert.match(runId, /^run-/);
  await waitUntil('public Run preparation receipt', async () => ['prepared', 'reused'].includes((await host.ctx.hima.readExecutionContext(runId)).durable?.preparation?.kind ?? ''));
  return { runId, guide, proposal, context: await host.ctx.hima.readExecutionContext(runId) };
}

export async function admissionStatus(host: InProcessHost, guide: Awaited<ReturnType<typeof createRootAgent>>, runId: string) {
  const answer = await host.ctx.tools.execute({ name: 'hima_status', callId: `admission-status-${crypto.randomUUID()}` as never,
    arguments: { run: runId }, agent: guide, signal: AbortSignal.timeout(20_000) });
  assert.equal(answer.isError, false, JSON.stringify(answer));
  return admissionJson(answer);
}
