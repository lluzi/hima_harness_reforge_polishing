// @hima-seam llm-replay direct
// Hand-authored model responses only. Every tool result and execution fact comes from the real Host.
import { mkdir, writeFile, appendFile } from 'node:fs/promises';
import path from 'node:path';
import type { ReplayEntry } from '@deepseek-ai/dsh-llm-replay';
import type { HimaHome } from './dsh-home.ts';
import { writeReplayOverlay } from '../../../packages/desktop/src/hima-home.ts';
import { QUIET_TITLE_ROW } from './pipeline.ts';

export const replayJobStarted = 'Replay: the local Job has started. This conversation is available for your instruction.';
export const replayPaused = 'Replay: node admission is paused. Its existing Job is still tracked; no downstream work will start.';
export const replayCompleted = 'Replay: the admitted node is explicitly completed. Its successor is available and has not been started.';

/** The installed replay adapter documents last-match captures from actual request string leaves. */
export async function writeExecutionReplay(home: HimaHome, options: { notifications?: boolean } = {}) {
  const directory = path.join(home.home, 'execution-replay');
  await mkdir(directory, { recursive: true });
  const file = path.join(directory, 'session.jsonl');
  const override = path.join(directory, 'replay.override.json');
  await writeFile(file, JSON.stringify({ version: 0, type: 'session', id: 'session-agent-execution-replay', createdAt: 0, cwd: '{{cwd}}' }) + '\n');
  const run = '{{fromRequest:(run-[0-9a-f-]+)}}';
  const execution = '{{fromRequest:(execution-[0-9a-f-]+)}}';
  let serial = 0;
  const tool = (name: string, args: object): ReplayEntry => ({ kind: 'chunks', chunks: [
    { type: 'block-start', index: 0, blockType: 'tool-call' },
    { type: 'block-end', index: 0, block: { type: 'tool-call', id: `call-agent-execution-${++serial}` as never,
      name, arguments: JSON.stringify(args).replace('"__REVISION__"', '{{fromRequest:"revision"\\s*:\\s*([0-9]+),\\s*"paused"}}') } },
    { type: 'finish', reason: { kind: 'tool-calls' } },
  ] });
  const action = (action: string, fields: object = {}) => tool('hima_execute', {
    run, action, expectedEpoch: 1, expectedRevision: '__REVISION__', requestId: `desktop-${serial + 1}`, ...fields,
  });
  const context = () => tool('hima_context', { run });
  const say = (text: string): ReplayEntry => ({ kind: 'chunks', chunks: [
    { type: 'block-start', index: 0, blockType: 'text' },
    { type: 'block-end', index: 0, block: { type: 'text', text } },
    { type: 'finish', reason: { kind: 'stop' } },
  ] });
  const entries = [
    context(), action('begin', { nodeId: 'synthesize' }), action('work', { executionId: execution }), say(replayJobStarted),
    context(), action('pause', { nodeId: 'synthesize' }), say(replayPaused),
    ...(options.notifications ? [say('Replay: pause receipt acknowledged; no new work.'), context(), say('Replay: Job facts are ready; waiting for human Continue.')] : []),
    context(), action('complete', { executionId: execution }), say(replayCompleted),
  ];
  await writeFile(override, JSON.stringify(entries, null, 2) + '\n');
  await writeReplayOverlay(home.home, { file, overrideFile: override });
  await appendFile(path.join(home.profileDir, 'cordis.patch.yml'), QUIET_TITLE_ROW);
  return { file, override };
}
