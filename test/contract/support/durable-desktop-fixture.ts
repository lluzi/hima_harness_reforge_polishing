// @hima-seam llm-replay direct
// Only owner dialogue is replayed. PG, DBOS, human response and local command are real.
import { mkdir, writeFile, appendFile } from 'node:fs/promises';
import path from 'node:path';
import { stringify } from 'yaml';
import type { HimaHome } from './dsh-home.ts';
import { writeLocalSite } from './site.ts';
import { writeReplayOverlay } from '../../../packages/desktop/src/hima-home.ts';
import { appendReplaySession } from './moments.ts';
import type { ReplayEntry } from '@deepseek-ai/dsh-llm-replay';
import { QUIET_TITLE_ROW } from './pipeline.ts';
export const desktopPack = 'desktop-human-command';
export const deliveryText = 'Verified desktop delivery: human input reached the real command.\n';
export async function writeDurableDesktopFixture(home: HimaHome) {
  const pack = path.join(home.home, 'hima/packs', desktopPack);
  await mkdir(path.join(pack, 'flow'), { recursive: true });
  await writeFile(path.join(pack, 'flow/produce.py'), `import json,pathlib,sys\ni,o,w=sys.argv[1:4]\nx=json.loads(pathlib.Path(i).read_text())\np=pathlib.Path(w)\np.joinpath('program-calls').open('a').write('command\\n')\np.joinpath('delivery.txt').write_text(${JSON.stringify(deliveryText)})\npathlib.Path(o).write_text(json.dumps({'schemaVersion':'1','value':{'message':x['message'],'period':x['period']},'artifacts':[{'name':'delivery','path':'delivery.txt','mediaType':'text/plain'}],'diagnostics':[]}))\n`);
  const schema = { version: '1', schema: { $schema: 'https://json-schema.org/draft/2020-12/schema', type: 'object', additionalProperties: false, properties: { message: { type: 'string', minLength: 1 }, period: { type: 'number' } }, required: ['message','period'] } };
  await writeFile(path.join(pack, 'contract.yml'), stringify({ id: desktopPack, version: '1', title: 'Desktop human command', inputs: [{ name: 'workspaceRoot' }], outputs: [], words: { periodNs: { label: 'Period', unit: 'ns' } }, goal: { periodNs: { type: 'number', unit: 'ns', min: 0.1, max: 10, default: 1 } }, strategy: { periodNs: { type: 'number', unit: 'ns', min: 0.1, max: 10, default: 2 } }, tools: [{ id: 'produce', file: 'flow/produce.py', inputs: ['FLOW','TASK_INPUT','TASK_OUTPUT','WORKSPACE'], argv: ['/usr/bin/python3','${FLOW}/produce.py','${TASK_INPUT}','${TASK_OUTPUT}','${WORKSPACE}'] }], environment: { wrappers: ['/usr/bin/python3'] }, workspace: { source: 'pack', copy: ['produce.py'] } }));
  await writeFile(path.join(pack, 'graph.yml'), stringify({ schema: 'hima-flow/1', id: desktopPack, version: '1', flow: { kind: 'sequence', id: 'delivery-flow', steps: [
    { kind: 'task', id: 'human-input', tool: 'builtin/human-wait', contract: { input: schema, output: schema }, inputs: { message: { source: 'literal', value: 'Confirm desktop delivery' }, period: { source: 'goal', path: ['periodNs'] } } },
    { kind: 'task', id: 'produce', tool: 'produce', contract: { input: schema, output: schema }, inputs: { message: { source: 'committedOutput', taskId: 'human-input', path: ['message'] }, period: { source: 'committedOutput', taskId: 'human-input', path: ['period'] } } },
  ] } }));
  await writeLocalSite(home, { allowedReadRoots: [home.workspace,pack], allowedWriteRoots: [home.workspace], allowedWrappers: ['/usr/bin/python3','sh'], bindings: { workspaceRoot: home.workspace }, licences: {} });
  const directory = path.join(home.home,'desktop-dialogue'); await mkdir(directory);
  const file = path.join(directory,'session.jsonl'), override = path.join(directory,'override.json');
  await writeFile(file, JSON.stringify({ version: 0, type: 'session', id: 'desktop-dialogue', createdAt: 0, cwd: '{{cwd}}' })+'\n');
  const say = (text: string): ReplayEntry => ({ kind: 'chunks', chunks: [{ type: 'block-start', index: 0, blockType: 'text' }, { type: 'block-end', index: 0, block: { type: 'text', text } }, { type: 'finish', reason: { kind: 'stop' } }] });
  await writeFile(override, JSON.stringify(Array.from({length:12},()=>say('Desktop replay dialogue: the recorded task facts remain authoritative.'))));
  await writeReplayOverlay(home.home,{file,overrideFile:override}); await appendFile(path.join(home.profileDir,'cordis.patch.yml'),QUIET_TITLE_ROW);
  return appendReplaySession({file,override,children:[],readyFile:path.join(directory,'ready')},'desktop-owner',Array.from({length:12},()=>say('Desktop owner dialogue: DBOS advances recorded tasks automatically.')));
}
