// @hima-seam agent wrapped
// P02 seeds released native events through the real Session append/persistence seam.
import type { Context } from '@deepseek-ai/cordis';
import type { Agent } from '@deepseek-ai/dsh-agent';
import { createUserMessage } from '@deepseek-ai/dsh-llm';

export function retainTitleOnly(ctx: Context, agent: Agent): void {
  const service = ctx.get('sessionTitle' as never) as unknown as { rename(session: Agent['session'], title: string): unknown };
  service.rename(agent.session, 'No conversation yet');
}

export function retainUserText(agent: Agent, text: string): void {
  const turn = agent.session.snapshotEvents().reduce((last, event) => event.type === 'turn/start' ? Math.max(last, event.data.turn) : last, 0) + 1;
  agent.session.append('turn/start', { turn });
  agent.session.append('user/message', createUserMessage({ content: [{ type: 'text', text }], source: { kind: 'user' } }), { surfaceOp: 'append' });
  agent.session.append('turn/end', { turn, reason: { kind: 'completed' } });
}
