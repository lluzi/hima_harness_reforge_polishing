// @hima-seam native-messages direct
// The native message role carries model context; only source.kind='user' means human input.
import { boundContextSummary, createUserMessage } from '@deepseek-ai/dsh-llm';

type HimaPromptSource = { readonly kind: 'plugin:hima'; readonly form?: never };
type HimaNoticeSource = { readonly kind: 'plugin:hima'; readonly form: 'notice'; readonly summary: string };

declare module '@deepseek-ai/dsh-llm' {
  interface MessageSourceMap {
    // Matches the native V3→V4 migration of historical plugin/hima messages.
    'plugin:hima': HimaPromptSource | HimaNoticeSource;
  }
}

export function createHimaNotice(text: string, account: string) {
  const summary = boundContextSummary(account.replace(/[\r\n]+/g, ' ').trim());
  if (summary === '') throw new Error('Hima notice needs a nonempty account.');
  const source: HimaNoticeSource = { kind: 'plugin:hima', form: 'notice', summary };
  return createUserMessage({ source, content: [{ type: 'text', text }] });
}

/** A model-moment task is machine context, rather than an account of an event. */
export function createHimaPrompt(text: string) {
  const source: HimaPromptSource = { kind: 'plugin:hima' };
  return createUserMessage({ source, content: [{ type: 'text', text }] });
}
