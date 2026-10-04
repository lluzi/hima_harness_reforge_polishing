// U5: source compilation and handoff contracts, not durable execution or model/EDA qualification.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm, cp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parse, stringify } from 'yaml';
import { copyLegacyAtcsPack } from './support/atcs-legacy.ts';
import { compileFlow, compileLegacyFlow, compileLegacyGrowth, freezeFlowFragment,
  loadPack, packStage, HIMA_INTENT_SECTIONS, HIMA_SPEC_SECTIONS, HIMA_FABRIC_SECTIONS,
  flowSourceVersion, taskSchemaDraft, validateTaskInput, createTaskResult, packDigestOf,
  installPackMethod, loadRunPack, preservePackMethod, type Flow, type FlowSource, type FlowTask, type PackGraph, type PackNode } from '@hima/harness';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const sha = 'a'.repeat(64);
const objectSchema = { version: '1', schema: { $schema: taskSchemaDraft, type: 'object' } };
function task(id: string, inputs: FlowTask['inputs'] = {}): FlowTask {
  return { kind: 'task', id, tool: 'measure', inputs, contract: { input: objectSchema, output: objectSchema } };
}
function decision(id = 'decide'): FlowTask {
  return { ...task(id), contract: { input: objectSchema, output: { version: '1', schema: { $schema: taskSchemaDraft,
    type: 'object', properties: { route: { type: 'string', enum: ['continue', 'stop'] } }, required: ['route'] } } } };
}
const source = (flow: Flow): FlowSource => ({ schema: flowSourceVersion, id: 'example', version: '1', flow });
const seq = (id: string, ...steps: Flow[]): Extract<Flow, { kind: 'sequence' }> => ({ kind: 'sequence', id, steps });
const binding = (taskId: string, ...path: string[]) => ({ taskId, path });
const from = (taskId: string, ...path: string[]) => ({ source: 'committedOutput' as const, taskId, path });

test('a declared closing task freezes its use of the original reserve without changing the Run budget', () => {
  const declaration = { ...task('deliver'), budget: 'closing' };
  const compiled = compileFlow({ ...source(task('work')), flow: declaration }, { packSha256: sha });
  assert.equal(compiled.tasks.deliver!.budget, 'closing');
  assert.notEqual(compiled.irSha256, compileFlow(source(task('deliver')), { packSha256: sha }).irSha256);
  assert.throws(() => compileFlow({ ...source(task('work')), flow: { ...declaration, budget: 'unlimited' } }, { packSha256: sha }), /budget/);
});

test('five elements compile into immutable stable IR; named parallel ordering and carry share original Run budget', () => {
  const flow = seq('all', decision(),
    { kind: 'choice', id: 'select', select: binding('decide', 'route'), cases: { continue: task('work'), stop: seq('done') } },
    { kind: 'parallel', id: 'join', branches: { z: { flow: task('z'), required: false }, a: { flow: task('a'), required: true } },
      results: { primary: { output: binding('a'), required: true }, diagnostic: { output: binding('z'), required: false } } },
    task('consume', { primary: from('a') }),
    { kind: 'repeat', id: 'again', body: { ...decision('iteration'), inputs: { prior: { source: 'carry', path: ['strategy'] } } }, maxIterations: 3, budget: 'original-run',
      carry: { strategy: { initial: { source: 'strategy', path: [] }, next: binding('iteration') } }, stop: { output: binding('iteration', 'route'), equals: 'stop' } });
  const one = compileFlow(source(flow), { packSha256: sha }), two = compileFlow(source(flow), { packSha256: sha });
  assert.equal(one.irSha256, two.irSha256);
  assert.ok(Object.isFrozen(one.tasks.consume!.inputs));
  assert.deepEqual(one.dependencies.consume, ['a']);
  const join = one.blocks.join!; assert.equal(join.kind, 'parallel');
  if (join.kind === 'parallel') assert.deepEqual(join.branches.map(branch => [branch.name, branch.required]), [['a', true], ['z', false]]);
  assert.deepEqual(one.tasks.iteration!.inputs.prior, { source: 'carry', path: ['strategy'] });
  assert.equal(one.blocks.again!.kind, 'repeat');
  assert.equal((one.blocks.again as { budget: string }).budget, 'original-run');
  const changed = { ...structuredClone(flow), steps: [...flow.steps].reverse() };
  assert.throws(() => compileFlow(source(changed), { packSha256: sha }), /not a committed predecessor/);
});

test('binding and routing counterexamples name the actionable field before any effect', () => {
  assert.throws(() => compileFlow(source(seq('s', task('consumer', { value: from('later') }), task('later'))), { packSha256: sha }), /inputs\/value.*not a committed predecessor/);
  assert.throws(() => compileFlow(source({ kind: 'repeat', id: 'missing-carry', body: { ...decision('body-carry'), inputs: { prior: { source: 'carry', path: ['missing'] } } }, carry: {}, stop: { output: binding('body-carry', 'route'), equals: 'stop' }, maxIterations: 2, budget: 'original-run' }), { packSha256: sha }), /carry.*enclosing repeat/);
  assert.throws(() => compileFlow(source(task('outside', { value: { source: 'carry', path: ['missing'] } })), { packSha256: sha }), /carry.*enclosing repeat/);
  assert.throws(() => compileFlow(source(task('consumer', { value: from('missing') })), { packSha256: sha }), /inputs\/value.*unknown task missing/);
  assert.throws(() => compileFlow(source(seq('s', task('same'), task('same'))), { packSha256: sha }), /duplicate ID/);
  assert.throws(() => compileFlow(source(seq('s', decision(), { kind: 'choice', id: 'c', select: binding('decide', 'route'), cases: { continue: task('x') } })), { packSha256: sha }), /cases.*continue, stop/);
  assert.throws(() => compileFlow(source(seq('s', task('plain'), { kind: 'choice', id: 'c', select: binding('plain'), cases: {} })), { packSha256: sha }), /declared, committed string enum/);
  assert.throws(() => compileFlow(source({ kind: 'repeat', id: 'r', body: decision(), carry: {}, stop: { output: binding('decide', 'route'), equals: 'stop' }, maxIterations: 0, budget: 'original-run' }), { packSha256: sha }), /maxIterations/);
  assert.throws(() => compileFlow(source(seq('s', decision(), { kind: 'repeat', id: 'r', body: task('body'), carry: {}, stop: { output: binding('decide', 'route'), equals: 'unknown' }, maxIterations: 1, budget: 'original-run' })), { packSha256: sha }), /stop\/output/);
});

test('parallel consumers distinguish optional results and reject sibling/future reads', () => {
  const parallel: Flow = { kind: 'parallel', id: 'p', branches: { a: { flow: task('a'), required: true }, b: { flow: task('b'), required: false } }, results: {} };
  assert.throws(() => compileFlow(source(seq('s', parallel, task('c', { value: from('b') }))), { packSha256: sha }), /optional input/);
  const consumer = { ...task('c', { value: from('b') }), optionalInputs: ['value'] };
  assert.ok(compileFlow(source(seq('s', parallel, consumer)), { packSha256: sha }).tasks.c);
  const crossed = structuredClone(parallel) as Extract<Flow, { kind: 'parallel' }>;
  (crossed.branches as Record<string, { flow: Flow; required: boolean }>).b!.flow = task('b', { value: from('a') });
  assert.throws(() => compileFlow(source(crossed), { packSha256: sha }), /not a committed predecessor/);
});

test('strict and dynamic diagnostic flows use the same grammar and freeze result/return without rewriting base', () => {
  const strict = source(seq('s', task('diagnose'), task('deliver', { value: from('diagnose') })));
  const base = compileFlow({ ...strict, extensions: [{ id: 'diagnostic', afterTask: 'diagnose', fragmentPath: ['extra'], returnTo: 'deliver' }] }, { packSha256: sha });
  const before = base.irSha256;
  const fragment = { flow: seq('detour', task('check', { original: from('diagnose') }), task('report', { value: from('check') })), return: binding('report') };
  const frozen = freezeFlowFragment(base, 'diagnostic', fragment);
  const closingFragment = { flow: { ...task('closing-diagnostic'), budget: 'closing' }, return: binding('closing-diagnostic') };
  assert.throws(() => freezeFlowFragment(base, 'diagnostic', closingFragment), /closing reserve/);
  const closingBase = compileFlow({ ...strict, flow: seq('s', { ...task('diagnose'), budget: 'closing' }, task('deliver')),
    extensions: [{ id: 'diagnostic', afterTask: 'diagnose', fragmentPath: ['extra'], returnTo: 'deliver' }] }, { packSha256: sha });
  assert.equal(freezeFlowFragment(closingBase, 'diagnostic', closingFragment).flow.tasks['closing-diagnostic']!.budget, 'closing');
  assert.equal(frozen.returnTo, 'deliver'); assert.equal(frozen.flow.schema, base.schema);
  assert.equal(base.irSha256, before); assert.ok(Object.isFrozen(frozen.flow));
  assert.equal(frozen.sha256, freezeFlowFragment(base, 'diagnostic', fragment).sha256);
  assert.throws(() => freezeFlowFragment(base, 'other', fragment), /not declared/);
  assert.throws(() => freezeFlowFragment(base, 'diagnostic', { ...fragment, flow: { ...task('foreign'), tool: 'undeclared' } }), /declare tool undeclared/);
  assert.throws(() => freezeFlowFragment(base, 'diagnostic', { ...fragment, return: binding('absent') }), /every successful fragment path/);
  assert.throws(() => freezeFlowFragment(base, 'diagnostic', { ...fragment, flow: task('deliver') }), /conflicts/);
  assert.throws(() => compileFlow({ ...strict, extensions: [{ id: 'bad', afterTask: 'deliver', fragmentPath: [], returnTo: 'diagnose' }] }, { packSha256: sha }), /later task/);
});

async function folder(t: import('node:test').TestContext): Promise<string> {
  const parent = await mkdtemp(path.join(tmpdir(), 'u5-flow-')); t.after(() => rm(parent, { recursive: true, force: true }));
  const dir = path.join(parent, 'example'); await mkdir(path.join(dir, 'tools'), { recursive: true });
  await writeFile(path.join(dir,'tools/measure.sh'),'#!/bin/sh\nprintf "{}"\n');
  await writeFile(path.join(dir, 'contract.yml'), stringify({ id: 'example', version: '1', title: 'Example', inputs: [{ name: 'design' }],
    tools: [{ id: 'measure', file: 'tools/measure.sh', inputs: [], argv: ['sh', 'tools/measure.sh'] }],
    environment: { wrappers: ['sh'] }, workspace: { copy: [] }, strategy: { effort: { type: 'number', unit: 'count', min: 1, max: 3, default: 1 } } }));
  return dir;
}
test('normal Pack loader resolves local schema bytes and includes them in immutable method/history identity', async t => {
  const dir = await folder(t); await mkdir(path.join(dir, 'schemas'));
  const schema = { $schema: taskSchemaDraft, type: 'object', properties: { score: { type: 'number' } }, required: ['score'], additionalProperties: false };
  await writeFile(path.join(dir, 'schemas/value.json'), JSON.stringify(schema));
  const producer = { ...task('measure'), contract: { input: objectSchema, output: { version: '1', schema: { $schema: taskSchemaDraft, $ref: 'schemas/value.json' } } } };
  await writeFile(path.join(dir, 'graph.yml'), stringify(source(seq('s', producer, task('deliver', { measured: from('measure') })))));
  const bytes = await readFile(path.join(dir, 'graph.yml'));
  const pack = loadPack(path.dirname(dir), 'example'); assert.equal(pack.flow!.source, 'flow');
  assert.equal(pack.flow!.packSha256, packDigestOf(dir)); assert.deepEqual(pack.flow!.localSchemas['schemas/value.json'], schema);
  const original = packDigestOf(dir); preservePackMethod(pack.folder);
  await mkdir(path.join(dir, 'run-assets')); await writeFile(path.join(dir, 'run-assets/customer.txt'), 'private');
  assert.equal(packDigestOf(dir), original);
  await writeFile(path.join(dir, 'schemas/value.json'), JSON.stringify({ ...schema, properties: { score: { type: 'integer' } } }));
  assert.notEqual(packDigestOf(dir), original);
  const history = loadRunPack(path.dirname(dir), 'example', original);
  assert.deepEqual(history.flow!.localSchemas['schemas/value.json'], schema); assert.deepEqual(await readFile(path.join(history.dir, 'graph.yml')), bytes);
  assert.deepEqual(await readFile(path.join(dir, 'graph.yml')), bytes, 'compilation never rewrites method bytes');
  const installed = path.join(path.dirname(dir), 'copy', 'example'); installPackMethod({ from: history.dir, to: installed });
  assert.equal(loadPack(path.dirname(installed), 'example').flow!.irSha256, history.flow!.irSha256);
});

test('normal flow views show sequence and branch handoffs, including an empty choice path', async t => {
  const dir = await folder(t);
  const method = source(seq('s', decision(),
    { kind: 'choice', id: 'choose', select: binding('decide', 'route'), cases: { continue: task('work'), stop: seq('skip') } },
    { kind: 'parallel', id: 'join', branches: { a: { flow: task('a'), required: true }, b: { flow: task('b'), required: true } }, results: {} },
    task('deliver')));
  await writeFile(path.join(dir, 'graph.yml'), stringify(method));
  const pack = loadPack(path.dirname(dir), 'example');
  assert.deepEqual(pack.graph.edges.map(edge => `${edge.from}->${edge.to}`).sort(),
    ['decide->work', 'decide->a', 'decide->b', 'work->a', 'work->b', 'a->deliver', 'b->deliver'].sort());
  assert.equal(pack.flow!.blocks.choose!.kind, 'choice', 'the IR retains execution semantics independently of display edges');
});

test('schema refusals have local positive paths and producer upgrades validate business values without changing consumers', async t => {
  const dir = await folder(t);
  const producer = task('produce'), consumer = task('consume', { value: from('produce') });
  const graph = source(seq('s', producer, consumer));
  for (const ref of ['https://example.com/schema.json', '../outside.json', '/outside.json']) {
    const broken = structuredClone(graph); ((broken.flow as Extract<Flow, { kind: 'sequence' }>).steps[0] as FlowTask).contract.output.schema.$ref = ref;
    assert.throws(() => compileFlow(broken, { packSha256: sha }), /Pack-local/);
  }
  for (const keyword of ['$async', 'executeCustom']) {
    const broken = structuredClone(graph); ((broken.flow as Extract<Flow, { kind: 'sequence' }>).steps[0] as FlowTask).contract.output.schema[keyword] = true;
    assert.throws(() => compileFlow(broken, { packSha256: sha }), /synchronous|unknown keyword/);
  }
  const missing = structuredClone(graph); ((missing.flow as Extract<Flow, { kind: 'sequence' }>).steps[0] as FlowTask).contract.output.schema.$ref = 'schemas/missing.json';
  await writeFile(path.join(dir, 'graph.yml'), stringify(missing)); assert.throws(() => loadPack(path.dirname(dir), 'example'), /schema.*absent/);
  const typed = { version: '1', schema: { $schema: taskSchemaDraft, type: 'object', properties: { score: { type: 'number' } }, required: ['score'] } };
  const input = { measured: { source: 'committedOutput' as const, taskId: 'produce', path: [] } };
  assert.deepEqual(compileFlow(source(seq('s', producer, task('consume', input))), { packSha256: sha }).tasks.consume!.inputs, input);
  const identity = { runId: 'r', taskId: 'produce', effectId: 'e', inputSha256: sha, packSha256: sha, irSha256: sha, applicationVersion: '1', adapterVersion: 'tool-v2' };
  const result = createTaskResult(identity, { input: objectSchema, output: typed }, { schemaVersion: '1', value: { score: 3 }, artifacts: [], diagnostics: [] });
  assert.deepEqual(validateTaskInput(typed, result.value), { score: 3 });
  assert.throws(() => validateTaskInput(typed, { score: '3' }), /score/);
});

test('every shipped supported legacy method compiles without altering its full semantic declarations', async t => {
  for (const id of ['opene902-timing-probe', 'library-intelligence', 'xtop-timing-closure', 'aes-timing-research', 'aes-tsmc28-dtco', 'custom-cell-fmax-dtco']) {
    const pack = loadPack(path.join(root, 'packs'), id);
    assert.equal(pack.flow!.source, 'legacy', id);
    const compatibility = pack.flow!.compatibility as { graph: unknown; contract: unknown };
    assert.deepEqual(compatibility.graph, pack.graph); assert.deepEqual(compatibility.contract, pack.contract);
    for (const node of [...pack.graph.nodes, ...Object.values(pack.graph.loops).flatMap(loop => loop.nodes)]) assert.deepEqual(pack.flow!.tasks[node.id]!.legacy, node);
  }
  const historical = await mkdtemp(path.join(tmpdir(), 'u5-historical-'));
  t.after(() => rm(historical, { recursive: true, force: true }));
  for (const version of ['0.1.10', '0.2.10']) {
    const id = 'agentic-timing-closure-system';
    const sourceDir = path.join(root, 'packs', id, 'legacy', version);
    const installed = path.join(historical, version, id);
    // Copy complete original method bytes into their canonical Pack directory, then use the
    // same normal loader as installation and historical method lookup.
    await mkdir(path.dirname(installed), { recursive: true });
    if (version === '0.2.10') {
      // The archived 0.2.10 directory is a method delta. Reuse the established complete legacy
      // fixture, which overlays its exact declarations/resources on the retained shared payload.
      await copyLegacyAtcsPack(path.dirname(installed));
    } else {
      await cp(sourceDir, installed, { recursive: true });
    }
    const loaded = loadPack(path.dirname(installed), id);
    const compiled = loaded.flow!;
    assert.deepEqual((compiled.compatibility as { contract: unknown }).contract, loaded.contract);
    assert.deepEqual(await readFile(path.join(installed, 'graph.yml')), await readFile(path.join(sourceDir, 'graph.yml')));
    assert.ok(Object.values(compiled.tasks).some(task => task.tool === 'builtin/workshop'));
    assert.ok(loaded.contract.agentTeams.length > 0);
  }
});

test('legacy finite matrix preserves fork join, loop, growth, revision and all Judge/Explore/Wait data in the single IR', () => {
  const method = loadPack(path.join(root, 'packs'), 'aes-tsmc28-dtco');
  const contract = method.contract;
  const judge = method.graph.nodes.find((node): node is Extract<PackNode, { kind: 'judge' }> => node.kind === 'judge')!;
  const explore = method.graph.nodes.find((node): node is Extract<PackNode, { kind: 'explore' }> => node.kind === 'explore' && node.parameters.chooser !== undefined)!;
  const nodes: PackNode[] = [
    { id: 'start', kind: 'act', parameters: { observes: contract.outputs.find(output => output.reader !== undefined)!.name, arguments: {} } },
    { id: 'a', kind: 'act', parameters: { tool: contract.tools[0]!.id, arguments: {} } },
    { id: 'b', kind: 'act', parameters: { workshop: contract.workshops[0]!.id, arguments: {} } },
    { id: 'join', kind: 'judge', parameters: structuredClone(judge.parameters) },
    { id: 'next', kind: 'explore', parameters: { ...structuredClone(explore.parameters), growth: true } },
    { id: 'wait', kind: 'wait', parameters: { blocker: 'Missing evidence' } },
  ];
  const graph: PackGraph = { id: contract.id, version: contract.version, entry: 'start', nodes, edges: [
    { from: 'start', to: 'b' }, { from: 'start', to: 'a' }, { from: 'a', to: 'join' }, { from: 'b', to: 'join' },
    { from: 'join', to: 'next', outcome: 'PASS' }, { from: 'join', to: 'next', outcome: 'FAIL' }, { from: 'next', to: 'start', revisit: true },
  ], loops: {}, autopilot: [{ fork: 'start', revisions: 2, author: { maxElapsedMs: 600_000, maxFollowups: 4, maxTokensPerTurn: 16_000 } }] };
  const compiled = compileLegacyFlow(graph, contract, sha);
  assert.equal(compiled.blocks[compiled.entry]!.kind, 'repeat');
  const parallel = Object.values(compiled.blocks).find(block => block.kind === 'parallel');
  assert.ok(parallel && parallel.kind === 'parallel'); assert.deepEqual(parallel.branches.map(branch => branch.name), ['a', 'b']);
  assert.deepEqual(compiled.tasks.join!.legacy, graph.nodes.find(node => node.id === 'join'));
  assert.equal(compiled.extensions[0]!.afterTask, 'next');
  assert.equal((compiled.compatibility as { revision: string }).revision, 'new-invocation-version');
  assert.ok(compiled.tasks.wait);
  const repeat = compiled.blocks[compiled.entry]!; assert.ok(repeat.kind === 'repeat');
  assert.equal(repeat.body, '@start/step');
  assert.deepEqual(repeat.entries, { '@next/growth-resume': { body: '@start/step',
    carry: { strategy: { initial: { source: 'strategy', path: [] }, next: binding('@next/growth-resume', 'strategy') } },
    stop: { output: binding('@next/growth-resume', 'route'), equals: 'stop' } } });
  assert.deepEqual(compiled.blocks['@join/choice'], { kind: 'choice', id: '@join/choice', select: binding('join', 'outcome'),
    cases: { PASS: '@next/step', FAIL: '@next/step', UNDETERMINED: '@wait/step' } });
  assert.deepEqual(compiled.blocks['@start/join'], { kind: 'sequence', id: '@start/join', steps: ['@start/parallel', '@join/step'] });
  assert.deepEqual(compiled.blocks['@a/branch'], { kind: 'sequence', id: '@a/branch', steps: ['a'] });
  assert.deepEqual(compiled.blocks['@b/branch'], { kind: 'sequence', id: '@b/branch', steps: ['b'] });
  assert.deepEqual(compiled.blocks['@next/continue'], { kind: 'choice', id: '@next/continue', select: binding('@next/growth-resume', 'route'),
    cases: { repeat: '@terminal', stop: '@terminal' } });
  assert.equal(compiled.irSha256, compileLegacyFlow(graph, contract, sha).irSha256);
});

test('nested local schema references resolve beside their owner and choice enum fragments use that document root', async t => {
  const dir = await folder(t); await mkdir(path.join(dir, 'schemas'));
  await writeFile(path.join(dir, 'schemas/decision.json'), JSON.stringify({ $schema: taskSchemaDraft,
    type: 'object', properties: { route: { $ref: 'child.json#/$defs/decision' } }, required: ['route'] }));
  await writeFile(path.join(dir, 'schemas/child.json'), JSON.stringify({ $schema: taskSchemaDraft,
    $defs: { decision: { $ref: '#/$defs/named' }, named: { type: 'string', enum: ['continue', 'stop'] } } }));
  const producer = { ...task('decide'), contract: { input: objectSchema, output: { version: '1', schema: { $schema: taskSchemaDraft, $ref: 'schemas/decision.json' } } } };
  const declaration = source(seq('all', producer, { kind: 'choice', id: 'choose', select: binding('decide', 'route'), cases: { continue: task('run'), stop: seq('end') } }));
  await writeFile(path.join(dir, 'graph.yml'), stringify(declaration));
  const pack = loadPack(path.dirname(dir), 'example');
  assert.deepEqual(Object.keys(pack.flow!.localSchemas).sort(), ['schemas/child.json', 'schemas/decision.json']);
  assert.deepEqual(validateTaskInput(producer.contract.output, { route: 'continue' }, pack.flow!.localSchemas), { route: 'continue' });
  assert.throws(() => validateTaskInput(producer.contract.output, { route: 'unmapped' }, pack.flow!.localSchemas), /route/);
  await rm(path.join(dir, 'schemas/child.json'));
  assert.throws(() => loadPack(path.dirname(dir), 'example'), /schemas\/child.json.*absent/);
});


test('the published strict and dynamic author examples load and climb the ordinary compiled stage', async t => {
  const parent = await mkdtemp(path.join(tmpdir(), 'u5-author-')); t.after(() => rm(parent, { recursive: true, force: true }));
  const dir = path.join(parent, 'example-probe'); await mkdir(path.join(dir, 'tools'), { recursive: true }); await mkdir(path.join(dir, 'schemas'));
  const anatomy = await readFile(path.join(root, 'packages/harness/skills/knowledge/pack-anatomy.md'), 'utf8');
  const yamls = [...anatomy.matchAll(/```yaml\n([\s\S]*?)\n```/g)].map(match => match[1]!);
  const contract = parse(yamls.find(text => text.startsWith('id: example-probe'))!);
  const declaration = parse(yamls.find(text => text.startsWith('schema: hima-flow/1'))!);
  const schema = [...anatomy.matchAll(/```json\n([\s\S]*?)\n```/g)].map(match => match[1]!).find(text => text.includes('"$schema"') && text.includes('"measurement"'))!;
  await writeFile(path.join(dir, 'contract.yml'), stringify(contract));
  await writeFile(path.join(dir, 'graph.yml'), stringify(declaration));
  await writeFile(path.join(dir, 'schemas/measurement.json'), schema);
  for(const tool of contract.tools){await mkdir(path.dirname(path.join(dir,tool.file)),{recursive:true});await writeFile(path.join(dir,tool.file),'#!/bin/sh\nprintf "{}"\n');}
  for (const [file, sections] of [['INTENT.md', HIMA_INTENT_SECTIONS], ['SPEC.md', HIMA_SPEC_SECTIONS], ['FABRIC.md', HIMA_FABRIC_SECTIONS]] as const) {
    await writeFile(path.join(dir, file), sections.map(section => `## ${section}\n\nAuthor example business description.\n`).join('\n'));
  }
  const strict = loadPack(parent, 'example-probe'); assert.equal(strict.flow!.source, 'flow');
  assert.equal(packStage(dir).stage, 'compiled');
  const slots = parse(yamls.find(text => text.startsWith('extensions:'))!);
  await writeFile(path.join(dir, 'graph.yml'), stringify({ ...declaration, ...slots }));
  const dynamic = loadPack(parent, 'example-probe');
  const fragment = parse(yamls.find(text => text.startsWith('flow:\n  kind: task\n  id: diagnostic-check'))!);
  const frozen = freezeFlowFragment(dynamic.flow!, 'diagnostic', fragment);
  assert.equal(frozen.returnTo, 'deliver'); assert.equal(frozen.flow.tasks['diagnostic-check']!.tool, 'measure-json');
  assert.equal(packStage(dir).stage, 'compiled');
});


test('accepted legacy growth compiles an immutable additive fragment returning to its parent with all required results', async t => {
  const parent = await mkdtemp(path.join(tmpdir(), 'u5-growth-')); t.after(() => rm(parent, { recursive: true, force: true }));
  const id = 'opene902-timing-probe', dir = path.join(parent, id);
  await cp(path.join(root, 'packs', id), dir, { recursive: true });
  const graph = parse(await readFile(path.join(dir, 'graph.yml'), 'utf8'));
  graph.nodes.find((node: { id: string }) => node.id === 'next-period').parameters.growth = true;
  await writeFile(path.join(dir, 'graph.yml'), stringify(graph));
  const pack = loadPack(parent, id), before = await readFile(path.join(dir, 'graph.yml'));
  const proposal = { proposalId: 'diagnose-legacy', method: { id, version: pack.contract.version, digest: pack.flow!.packSha256 },
    parent: { nodeId: 'next-period', generation: 1 }, inputThroughSeq: 8,
    inputs: [{ recordId: 'record-8', contentIdentity: sha }], impactNodes: ['synthesize'], expectedChanges: ['diagnose one candidate'],
    nodes: [
      { id: 'extra-tool', kind: 'act', parameters: { tool: 'synth', arguments: { PERIOD_NS: 2.2 } } },
      { id: 'extra-read', kind: 'act', parameters: { observes: 'qorReport', arguments: {} } },
      { id: 'extra-judge', kind: 'judge', parameters: { rules: ['setup-wns-all-nonnegative'], bind: {} } },
    ], edges: [{ from: 'extra-tool', to: 'extra-read' }, { from: 'extra-read', to: 'extra-judge' },
      ...['PASS', 'FAIL', 'UNDETERMINED'].map(outcome => ({ from: 'extra-judge', to: 'next-period', outcome }))],
    requiredOutputs: ['qorReport'], endCondition: 'new observation and verdict retained', returnNode: 'next-period', optional: true };
  const frozen = compileLegacyGrowth(pack, proposal);
  assert.equal(frozen.returnTo, '@next-period/growth-resume'); assert.deepEqual(frozen.requiredOutputs, ['qorReport']); assert.equal(frozen.optional, true);
  assert.equal(frozen.flow.schema, pack.flow!.schema); assert.ok(Object.isFrozen(frozen.flow));
  assert.ok(frozen.flow.tasks[frozen.return.taskId]); assert.ok(!frozen.flow.tasks['next-period'], 'fragment does not execute the parent');
  const resume=pack.flow!.tasks['@next-period/growth-resume']!;assert.equal(resume.tool,'builtin/legacy-growth-resume');
  assert.deepEqual(resume.inputs.priorDecision,{source:'committedOutput',taskId:'next-period',path:[]});
  assert.deepEqual(resume.inputs.diagnostic,{source:'extensionResult',slotId:'@next-period/growth',path:[]});
  assert.deepEqual(resume.optionalInputs,['diagnostic']);
  assert.equal(frozen.sha256, compileLegacyGrowth(pack, proposal).sha256);
  assert.deepEqual(await readFile(path.join(dir, 'graph.yml')), before);
  const module=await import(pathToFileURL(path.join(process.env.HIMA_U6_TEST_LIB??path.join(root,'packages/harness/lib'),'flow-compiler.js')).href);
  assert.equal(module.freezeLegacyFlowFragment(pack.flow!,'@next-period/growth',frozen).sha256,frozen.sha256);
  const forged=structuredClone(frozen);(forged.flow.tasks['extra-tool'] as {tool:string}).tool='builtin/human-wait';
  assert.throws(()=>module.freezeLegacyFlowFragment(pack.flow!,'@next-period/growth',forged),/differs from its validated proposal/);
  assert.throws(() => compileLegacyGrowth(pack, { ...proposal, returnNode: 'judge' }), /return to its declared parent/);
  assert.throws(() => compileLegacyGrowth(pack, { ...proposal, edges: [...proposal.edges, { from: 'extra-read', to: 'extra-tool' }] }), /cycle/);
});


test('a strict versioned Pack without Strategy knobs loads without invented data while the legacy contract stays strict', async t => {
  const dir = await folder(t);
  const contract = parse(await readFile(path.join(dir, 'contract.yml'), 'utf8'));
  delete contract.strategy;
  await rm(path.join(dir, 'contract.yml'));
  for (const [file, sections] of [['INTENT.md', HIMA_INTENT_SECTIONS], ['SPEC.md', HIMA_SPEC_SECTIONS]] as const) {
    await writeFile(path.join(dir, file), sections.map(section => `## ${section}\n\nMeasure the declared design once and return its task result; no Strategy knobs or Explore are required.\n`).join('\n'));
  }
  assert.equal(packStage(dir).stage, 'specified', 'the ordinary SPEC rung precedes any contract or graph');
  assert.equal(packStage(dir).issue, undefined);
  await writeFile(path.join(dir, 'contract.yml'), stringify(contract));
  await writeFile(path.join(dir, 'graph.yml'), stringify(source(task('measure', { design: { source: 'runInput', path: ['design'] } }))));
  const loaded = loadPack(path.dirname(dir), 'example');
  assert.deepEqual(loaded.contract.strategy, {}); assert.equal(loaded.flow!.source, 'flow');
  assert.deepEqual(loaded.flow!.tasks.measure!.inputs, { design: { source: 'runInput', path: ['design'] } });
  await writeFile(path.join(dir, 'contract.yml'), stringify({ ...contract, strategy: {} }));
  assert.deepEqual(loadPack(path.dirname(dir), 'example').contract.strategy, {});
  await writeFile(path.join(dir, 'graph.yml'), stringify({ id: 'example', version: '1', entry: 'measure', nodes: [{ id: 'measure', kind: 'act', parameters: { tool: 'measure' } }] }));
  assert.throws(() => loadPack(path.dirname(dir), 'example'), /strategy.*declares no knob|strategy/s);
});


test('identical inline named schemas can cross task contracts without shared registration conflicts', () => {
  const named = { version: '1', schema: { $schema: taskSchemaDraft, $id: 'urn:hima:measurement',
    type: 'object', properties: { score: { type: 'number' } }, required: ['score'], additionalProperties: false } };
  const producer = { ...task('produce'), contract: { input: objectSchema, output: named } };
  const consumer = { ...task('consume', { score: from('produce', 'score') }), contract: { input: named, output: named } };
  const declaration = source(seq('all', producer, consumer));
  const compiled = compileFlow(declaration, { packSha256: sha });
  assert.equal(compiled.irSha256, compileFlow(declaration, { packSha256: sha }).irSha256);
  assert.deepEqual(validateTaskInput(compiled.tasks.consume!.contract.input, { score: 4 }), { score: 4 });
  assert.throws(() => validateTaskInput(compiled.tasks.consume!.contract.input, { score: '4' }), /score/);
});

test('normal loader validates named repeat initial sources as strictly as task inputs', async t => {
  const dir = await folder(t);
  const contract = parse(await readFile(path.join(dir, 'contract.yml'), 'utf8'));
  contract.goal = { target: { type: 'number', unit: 'count', min: 1, max: 3, default: 1 } };
  await writeFile(path.join(dir, 'contract.yml'), stringify(contract));
  for (const [origin, declared] of [['runInput', 'design'], ['goal', 'target'], ['strategy', 'effort']] as const) {
    const repeat: Flow = { kind: 'repeat', id: 'refine', body: decision('iterate'),
      carry: { candidate: { initial: { source: origin, path: ['typo'] }, next: binding('iterate') } },
      stop: { output: binding('iterate', 'route'), equals: 'stop' }, maxIterations: 2, budget: 'original-run' };
    await writeFile(path.join(dir, 'graph.yml'), stringify(source(repeat)));
    assert.throws(() => loadPack(path.dirname(dir), 'example'), new RegExp(`carry/candidate/initial.*undeclared ${origin} field "typo"`));
    const valid = { ...repeat, carry: { candidate: { ...repeat.carry.candidate!, initial: { source: origin, path: [declared] } } } };
    await writeFile(path.join(dir, 'graph.yml'), stringify(source(valid)));
    assert.deepEqual(loadPack(path.dirname(dir), 'example').flow!.blocks.refine, { ...valid, body: 'iterate' });
  }
  delete contract.goal;
  await writeFile(path.join(dir, 'contract.yml'), stringify(contract));
  await writeFile(path.join(dir, 'graph.yml'), stringify(source(task('measure', { target: { source: 'goal', path: ['target'] } }))));
  assert.throws(() => loadPack(path.dirname(dir), 'example'), /undeclared goal field "target"/);
});

test('legacy opened loop Judge inherits the declared root Wait before synthesizing human intervention', () => {
  const pack = loadPack(path.join(root, 'packs'), 'aes-tsmc28-dtco');
  const compiled = pack.flow!;
  assert.deepEqual(compiled.blocks['@judge/choice'], { kind: 'choice', id: '@judge/choice',
    select: binding('judge', 'outcome'), cases: { PASS: '@next-period/step', FAIL: '@next-period/step', UNDETERMINED: '@blocked/step' } });
  assert.equal(compiled.tasks.blocked!.tool, 'builtin/human-wait');
  assert.ok(!compiled.tasks['@loop-probe-loop/human-wait']);
  assert.deepEqual(compiled.blocks['@probe/open-loop'], { kind: 'sequence', id: '@probe/open-loop', steps: ['@loop-probe-loop/repeat', 'probe'] });
  assert.deepEqual(compiled.blocks['@probe/step'], { kind: 'sequence', id: '@probe/step', steps: ['@probe/open-loop', '@probe/choice'] });
  assert.deepEqual(compiled.blocks['@probe/choice'], { kind: 'choice', id: '@probe/choice', select: binding('probe', 'outcome'),
    cases: { 'goal-met': '@mine-start/step', converged: '@mine-start/step', 'generation-limit': '@mine-start/step' } });
  assert.deepEqual(compiled.blocks['@merge-join/choice'], { kind: 'choice', id: '@merge-join/choice', select: binding('merge-join', 'outcome'),
    cases: { PASS: '@merge/step', FAIL: '@blocked/step', UNDETERMINED: '@blocked/step' } });
  const branchNames = ['mine-functional-diversity', 'mine-mapper-compatibility', 'mine-structure-compaction',
    'mine-structure-frequency', 'mine-timing-context', 'mine-timing-criticality'];
  const parallel = compiled.blocks['@mine-start/parallel'];
  assert.ok(parallel?.kind === 'parallel');
  assert.deepEqual(parallel.branches, branchNames.map(name => ({ name, flow: `@${name}/branch`, required: true })));
  for (const name of branchNames) {
    const domain = name.slice('mine-'.length);
    assert.deepEqual(compiled.blocks[`@${name}/branch`], { kind: 'sequence', id: `@${name}/branch`,
      steps: [name, `select-${domain}`, `read-select-${domain}`] });
    assert.deepEqual(parallel.results[name], { output: binding(`read-select-${domain}`), required: true });
  }
  assert.deepEqual(compiled.blocks['@mine-start/join'], { kind: 'sequence', id: '@mine-start/join', steps: ['@mine-start/parallel', '@merge-join/step'] });
  const outer = compiled.blocks[compiled.entry], inner = compiled.blocks['@loop-probe-loop/repeat'];
  assert.ok(outer?.kind === 'repeat' && inner?.kind === 'repeat');
  assert.equal(outer.body, '@probe/step');
  assert.deepEqual(outer.entries, { '@next-research/growth-resume': { body: '@mine-start/step',
    carry: { strategy: { initial: { source: 'strategy', path: [] }, next: binding('@next-research/growth-resume', 'strategy') } },
    stop: { output: binding('@next-research/growth-resume', 'route'), equals: 'stop' } } });
  assert.equal(inner.body, '@synthesize/step');
  assert.deepEqual(inner.entries, { 'next-period': { body: '@synthesize/step',
    carry: { strategy: { initial: { source: 'carry', path: ['strategy'] }, next: binding('next-period', 'strategy') } },
    stop: { output: binding('next-period', 'route'), equals: 'stop' } } });
  assert.equal(outer.budget, 'original-run'); assert.equal(inner.budget, 'original-run');
  assert.deepEqual(compiled.tasks.synthesize!.inputs.PERIOD_NS, { source: 'carry', path: ['strategy', 'periodNs'] });
  assert.deepEqual(compiled.tasks['select-timing-criticality']!.inputs.REVISION, { source: 'carry', path: ['strategy', 'algorithmRevision'] });
});


test('normal legacy loader preserves local Wait priority, explicit UNDETERMINED routing and current-task fallback', async t => {
  const parent = await mkdtemp(path.join(tmpdir(), 'u5-wait-')); t.after(() => rm(parent, { recursive: true, force: true }));
  const id = 'aes-tsmc28-dtco', dir = path.join(parent, id);
  await cp(path.join(root, 'packs', id), dir, { recursive: true });
  const original = parse(await readFile(path.join(dir, 'graph.yml'), 'utf8'));
  const local = structuredClone(original);
  local.loops['probe-loop'].nodes.push({ id: 'loop-wait', kind: 'wait', parameters: { blocker: 'Need probe evidence' } });
  await writeFile(path.join(dir, 'graph.yml'), stringify(local));
  let compiled = loadPack(parent, id).flow!;
  const choice = (flow: typeof compiled) => {
    const block = flow.blocks['@judge/choice']; assert.ok(block?.kind === 'choice'); return block;
  };
  assert.equal(choice(compiled).cases.UNDETERMINED, '@loop-wait/step');
  assert.equal(compiled.tasks['loop-wait']!.tool, 'builtin/human-wait');
  const explicit = structuredClone(local);
  explicit.loops['probe-loop'].edges.push({ from: 'judge', to: 'next-period', outcome: 'UNDETERMINED' });
  await writeFile(path.join(dir, 'graph.yml'), stringify(explicit));
  assert.equal(choice(loadPack(parent, id).flow!).cases.UNDETERMINED, '@next-period/step');
  // Use the supported simple root graph to qualify the no-Wait fallback through the same loader.
  const simpleId = 'opene902-timing-probe', simpleDir = path.join(parent, simpleId);
  await cp(path.join(root, 'packs', simpleId), simpleDir, { recursive: true });
  const noWait = parse(await readFile(path.join(simpleDir, 'graph.yml'), 'utf8'));
  noWait.nodes = noWait.nodes.filter((node: { kind: string }) => node.kind !== 'wait');
  await writeFile(path.join(simpleDir, 'graph.yml'), stringify(noWait));
  compiled = loadPack(parent, simpleId).flow!;
  assert.equal(choice(compiled).cases.UNDETERMINED, '@opene902-timing-probe/human-wait');
  const wait = compiled.tasks['@opene902-timing-probe/human-wait']!;
  assert.equal(wait.tool, 'builtin/human-wait');
  assert.deepEqual(wait.legacy, { reason: 'unlabelled UNDETERMINED', resume: 'rejudge', graph: simpleId });
});

test('explicit extension return binds only at the declared reachable consumer', () => {
  const sourceValue = { ...source(seq('extension-sequence', task('extension-producer'),
    task('extension-consumer', { returned: { source: 'extensionResult', slotId: 'extension-slot', path: ['value'] } }))),
    extensions: [{ id: 'extension-slot', afterTask: 'extension-producer', fragmentPath: ['fragment'], returnTo: 'extension-consumer' }] };
  const flow = compileFlow(sourceValue, { packSha256: sha });
  assert.deepEqual(flow.tasks['extension-consumer']!.inputs.returned, { source: 'extensionResult', slotId: 'extension-slot', path: ['value'] });
  assert.deepEqual(flow.dependencies['extension-consumer'], ['extension-producer']);
  assert.throws(() => compileFlow({ ...sourceValue, extensions: [] }, { packSha256: sha }), /unknown extension slot/);
  const ordered=sourceValue.flow;assert.ok(ordered.kind==='sequence');
  assert.throws(() => compileFlow({ ...sourceValue, flow: seq('reversed-extension', ordered.steps[1]!, ordered.steps[0]!) }, { packSha256: sha }), /not a committed predecessor/);
});

test('revision closure includes actual choice/repeat/fragment consumers and preserves an independent branch', async () => {
  const {flowRevisionConsumers}=await import(pathToFileURL(path.join(process.env.HIMA_U6_TEST_LIB??path.join(root,'packages/harness/lib'),'flow-definition.js')).href);
  const base=compileFlow(source(seq('s',{kind:'parallel',id:'parallel',branches:{
    a:{required:true,flow:seq('a-chain',decision('a-decision'),{kind:'choice',id:'a-choice',select:binding('a-decision','route'),cases:{continue:task('a-work'),stop:task('a-stop')}})},
    b:{required:true,flow:task('b')}
  },results:{}},task('join'))),{packSha256:sha});
  assert.deepEqual(flowRevisionConsumers(base,'a-decision'),['a-decision','a-stop','a-work','join']);
  const repeat=compileFlow(source({kind:'repeat',id:'repeat',body:seq('body',task('work',{n:{source:'carry',path:['n']}}),decision('stop')),
    carry:{n:{initial:{source:'literal',value:0},next:binding('work')}},stop:{output:binding('stop','route'),equals:'stop'},maxIterations:3,budget:'original-run'}),{packSha256:sha});
  assert.deepEqual(flowRevisionConsumers(repeat,'stop'),['stop','work']);
  const withSlot=compileFlow({...source(seq('extension',task('producer'),task('consumer',{returned:{source:'extensionResult',slotId:'slot',path:[]}}))),
    extensions:[{id:'slot',afterTask:'producer',fragmentPath:['extra'],returnTo:'consumer'}]},{packSha256:sha});
  const fragment=freezeFlowFragment(withSlot,'slot',{flow:task('diagnostic'),return:binding('diagnostic')});
  assert.deepEqual(flowRevisionConsumers(withSlot,'producer',[fragment]),['consumer','diagnostic','producer']);
  assert.deepEqual(flowRevisionConsumers(withSlot,'diagnostic',[fragment]),['consumer','diagnostic']);
});
