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
  agent.session.append('turn/start', { turn: 0 });
  agent.session.append('user/message', createUserMessage({ content: [{ type: 'text', text }], source: { kind: 'user' } }), { surfaceOp: 'append' });
  agent.session.append('turn/end', { turn: 0, reason: { kind: 'completed' } });
}
