// Contract support for the existing Probe service. Structured requests use a live project Agent;
// this does not parse or reproduce the retired standalone observe command.
// @hima-seam agent wrapped
import { createRootAgent, type InProcessHost } from './boot-inprocess.ts';
import type {} from '@hima/harness';
import type { Agent } from '@deepseek-ai/dsh-agent';

interface Request { site: string; path: string; reader?: string; run?: string; judge?: string[]; params?: Record<string, number> }

export async function observeReport(host: InProcessHost, workspace: string, request: Request, on?: Agent) {
  const agent = on ?? await createRootAgent(host.ctx, workspace);
  const { judge, params, ...reading } = request;
  const result = await host.ctx.hima.observe({ ...reading, projectSessionId: String(agent.id) });
  const verdicts = result.kind === 'observed' && judge?.length
    ? await host.ctx.hima.judge.evaluate({ runId: result.run.id, ruleIds: judge, params }) : [];
  return { kind: result.kind === 'observed' ? 'success' as const : 'error' as const,
    text: JSON.stringify({ ...result, verdicts }), runId: result.run.id, record: result.record, verdicts };
}
