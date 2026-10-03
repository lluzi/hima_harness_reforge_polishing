// Bounded L4: real product author compiles business prose through the installed skills/checker.
// No Run, EDA, replay, or fabricated execution result is part of this author-only qualification.
import { cpSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import { spawnSync } from 'node:child_process';
import { loadPack, packStage, freezeFlowFragment, toolArgv, validateTaskInput, createTaskResult, type JsonValue } from '@hima/harness';
import { bootInProcess, createRootAgent, injectedSkills, saidByModel, toolCalls } from '../test/contract/support/boot-inprocess.ts';
import { createHimaHome } from '../test/contract/support/dsh-home.ts';
import { installPack, packsDirOf } from '../test/contract/support/pack.ts';
import { writeLocalSite } from '../test/contract/support/site.ts';
import { prepareHimaHome, homePatchFile } from '../packages/desktop/src/hima-home.ts';
import { guardInstalled, runLive } from './live-check-workshop.ts';

await runLive('live-check-dbos-authoring', 12, async check => {
  const h = await createHimaHome(); check.home = h;
  await prepareHimaHome({ home: h.home, bundleMode: 'installed' });
  await installPack(h);
  const flow = path.join(h.workspace, 'flow'); mkdirSync(flow);
  writeFileSync(path.join(flow, 'produce.py'), [
    'import json, pathlib, sys',
    'mode, source, destination = sys.argv[1:]',
    'incoming = json.loads(pathlib.Path(source).read_text())',
    'assert mode in ("sample", "deliver")',
    'value = {"sample": 7, "goalMet": False} if mode == "sample" else incoming["sample"]',
    'pathlib.Path(destination).write_text(json.dumps({"schemaVersion": "1", "value": value, "artifacts": [], "diagnostics": []}))',
  ].join('\n') + '\n');
  writeFileSync(path.join(flow, 'README.md'), '# Synthetic authoring flow\n\nCommands: `python3 produce.py sample INPUT_JSON OUTPUT_JSON` and `python3 produce.py deliver INPUT_JSON OUTPUT_JSON` in this directory. Both consume a JSON object from INPUT_JSON and write the producer envelope to OUTPUT_JSON. Sample emits the fixed business object {"sample":7,"goalMet":false}; delivery reads that committed business object from its input key `sample` and delivers it unchanged. TASK_INPUT and TASK_OUTPUT are the explicit runtime file operands described by the installed Pack anatomy. The sample command can also supply a diagnostic fixture. This is a protocol fixture, never a measurement or proof of a business Goal. No licences, EDA or generated native code is needed.\n');
  await writeLocalSite(h, { allowedReadRoots: [h.workspace], allowedWriteRoots: [h.workspace], allowedWrappers: ['python3'], licences: {}, bindings: { flowRoot: flow, design: 'synthetic', workspaceRoot: h.workspace } });
  writeFileSync(homePatchFile(h.home), '- id: session-title-llm\n  disabled: true\n');
  const id = 'bounded-json-author'; const folder = path.join(packsDirOf(h), id); mkdirSync(folder);
  const intent: Record<string, string> = {
    Business: 'Compile a synthetic JSON handoff demonstration. Task completion is distinct from business goal achievement. This trial qualifies authoring only.',
    'Golden Flow': `Read ${flow}/README.md and ${flow}/produce.py. The two approved commands and JSON operands are stated there.`,
    Answers: 'A new versioned method. First sample the fixture; then deliver the committed sample. No tunable Strategy or numeric Goal parameters. No native Workshop or human clearance. Permit one optional dynamic diagnostic detour after sampling and return to delivery; the base method contains only sample and delivery, with no duplicate static diagnostic branch. Same original budget, tools and permissions. Do not execute a Run.',
    'Ambiguities resolved': 'A valid payload with goalMet false is a successful task delivery, never Goal met. There are no reader-produced typed values in this protocol-only method. An unavailable or malformed payload is an error, not success.',
    'Knowledge applied': 'end-honestly-in-more-than-one-way.md distinguishes successful delivery and Goal. what-a-golden-flow-is.md anchors the command.'
  };
  writeFileSync(path.join(folder, 'INTENT.md'), Object.entries(intent).map(([k,v]) => `## ${k}\n\n${v}\n`).join('\n'));
  process.chdir(h.workspace);
  const host = await bootInProcess(h); check.attach(host);
  const author = check.track(await createRootAgent(host.ctx, folder));
  guardInstalled(check, host, [path.join(h.profileDir, 'node_modules/@hima/harness'), packsDirOf(h), flow], folder);
  host.ctx.tools.guard(execution => ['hima_run', 'hima_execute', 'hima_pack_release'].includes(execution.name) ? 'This qualification is author-only; no Run, execution or release is authorized.' : undefined);
  await check.say(author, '/hima-spec Read the approved INTENT and Golden Flow. Write the new method specification without inventing Strategy knobs, native Workshops, Goal parameters or a success claim. The method samples and delivers a JSON fixture and permits a diagnostic detour before delivery.');
  check.require('no-knob SPEC exists before any graph', packStage(folder).stage === 'specified', packStage(folder));
  await check.say(author, `/hima-fabric ${id} on site local. Compile the approved specification. Also write diagnostic-example.json containing one valid diagnostic fragment for the declared slot, using the same flow grammar; this is a documentation example, not execution evidence. Read only the installed author resources and approved Golden Flow. Show the generated scripts for review.`);
  // Test-author approval is bounded to this synthetic fixture. The model must first expose scripts.
  // Compiled shape alone does not supply the requested human script-review verdict.
  await check.say(author, 'Approved for this synthetic author-only fixture: keep the shown scripts that invoke the two approved Golden Flow commands. Record this verdict in FABRIC.md, finish the diagnostic example, and run hima_pack_check. Do not start a Run or change the approved business scope.');
  for (let turn = 0; turn < 5 && packStage(folder).stage !== 'compiled'; turn++) {
    const messages = saidByModel(author);
    check.observed.reviewMessages = messages;
    const scripts = toolCalls(author).filter(call => call.name === 'write' && String(call.args.file_path ?? '').includes('tools/'));
    check.observed.generatedScripts = scripts;
    await check.say(author, 'Approved for this synthetic author-only fixture: keep the shown scripts that invoke the approved Golden Flow commands. Finish the authored method and diagnostic example, run hima_pack_check, and correct only errors in this Pack. Do not start a Run or add dummy parameters.');
  }
  const stage = packStage(folder); check.require('real author reaches compiled through normal checker', stage.stage === 'compiled', stage);
  const pack = loadPack(packsDirOf(h), id);
  check.require('new declaration has no legacy nodes or dummy Strategy', pack.flowSource?.schema === 'hima-flow/1' && Object.keys(pack.contract.strategy).length === 0, { source: pack.flowSource, strategy: pack.contract.strategy });
  check.require('strict sequence and diagnostic slot coexist', pack.flow?.extensions.length === 1 && Object.values(pack.flow.tasks).length === 2, pack.flow);
  const example = JSON.parse(readFileSync(path.join(folder, 'diagnostic-example.json'), 'utf8'));
  // A documentation envelope may explain the fragment; only its actual value is compiled.
  const fragment = freezeFlowFragment(pack.flow!, pack.flow!.extensions[0]!.id, example.fragment ?? example);
  check.require('author-generated diagnostic fragment freezes under same grammar', Boolean(fragment.sha256), fragment);
  // Execute only the two exact approved Golden Flow commands. This checks the authored ABI,
  // not an App Run or DBOS effect: the separate task-effects suite qualifies that boundary.
  const outputs = new Map<string, JsonValue>();
  const io = path.join(h.workspace, 'author-abi-check'); mkdirSync(io);
  const tasks = Object.values(pack.flow!.tasks);
  check.require('delivery binds a committed predecessor', Object.values(tasks[1]!.inputs).some(binding => binding.source === 'committedOutput' && binding.taskId === tasks[0]!.id), tasks[1]!.inputs);
  for (const [index, task] of tasks.entries()) {
    const input: Record<string, JsonValue> = {};
    for (const [name, binding] of Object.entries(task.inputs)) {
      if (binding.source === 'literal') input[name] = binding.value;
      else if (binding.source === 'committedOutput') {
        let value: JsonValue | undefined = outputs.get(binding.taskId);
        for (const key of binding.path) value = value !== null && typeof value === 'object' ? (value as Record<string, JsonValue>)[key] : undefined;
        if (value === undefined) throw new Error(`Author ABI has no committed input ${task.id}/${name}`);
        input[name] = value;
      } else throw new Error(`Synthetic fixture has no ${binding.source} input for ${task.id}/${name}`);
    }
    validateTaskInput(task.contract.input, input, pack.flow!.localSchemas);
    const inputFile = path.join(io, `${index}-input.json`), outputFile = path.join(io, `${index}-output.json`);
    writeFileSync(inputFile, JSON.stringify(input));
    const tool = pack.contract.tools.find(tool => tool.id === task.tool)!;
    check.require(`tool ${tool.id} declares JSON output`, tool.inputs.includes('TASK_OUTPUT'), tool.inputs);
    const bindings: Record<string, string> = { WORKSPACE: h.workspace, FLOW_ROOT: flow, DESIGN: 'synthetic', TASK_INPUT: inputFile, TASK_OUTPUT: outputFile };
    for (const name of tool.inputs) if (!(name in bindings)) {
      const value = input[name];
      if (!['string', 'number', 'boolean'].includes(typeof value)) throw new Error(`Missing exact scalar operand ${name}`);
      bindings[name] = String(value);
    }
    const argv = toolArgv(tool, bindings);
    const mode = index === 0 ? 'sample' : 'deliver';
    check.require(`task ${task.id} invokes only its approved command`, JSON.stringify(argv) === JSON.stringify(['python3', path.join(flow, 'produce.py'), mode, inputFile, outputFile]), argv);
    const called = spawnSync(argv[0]!, argv.slice(1), { cwd: flow, encoding: 'utf8', timeout: 5_000 });
    check.require(`Golden command ${mode} exits successfully`, called.status === 0, { status: called.status, stderr: called.stderr });
    const raw = JSON.parse(readFileSync(outputFile, 'utf8'));
    const result = createTaskResult({ runId: 'author-abi-qualification', taskId: task.id, effectId: `author-${index}`, inputSha256: 'a'.repeat(64), packSha256: pack.flow!.packSha256, irSha256: pack.flow!.irSha256, applicationVersion: host.ctx.hima.durable.applicationVersion, adapterVersion: 'author-abi-qualification/1' }, task.contract, raw, pack.flow!.localSchemas);
    outputs.set(task.id, result.value);
  }
  check.observed.authoringCommandCount = tasks.length;
  check.require('authored handoff preserves the actual business value and unmet Goal', isDeepStrictEqual(outputs.get(tasks[1]!.id), { sample: 7, goalMet: false }), Object.fromEntries(outputs));
  check.require('native spec/fabric skills and Pack checker were used', ['hima-spec', 'hima-fabric'].every(name => injectedSkills(author).includes(name)) && toolCalls(author).some(call => call.name === 'hima_pack_check'), { skills: injectedSkills(author), calls: toolCalls(author).map(call => call.name) });
  check.require('author trial did not start any business Run', host.ctx.hima.ledger.runs().length === 0, host.ctx.hima.ledger.runs());
  cpSync(folder, path.join(check.out, 'authored-pack'), { recursive: true });
});
