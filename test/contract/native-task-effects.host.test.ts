// @hima-seam llm-replay direct
// Native DSH sessions/replay, PG facts, real local retained program and Reader Jobs. No model API.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile, rm, symlink, realpath } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { stringify } from 'yaml';
import { createHimaHome, repoRoot } from './support/dsh-home.ts';
import { bootInProcess, createPresetRootAgent, resumeTestAgent } from './support/boot-inprocess.ts';
import { appendReplaySession, writeMomentFixture } from './support/moments.ts';
import { homePatchFile, writeReplayOverlay } from '../../packages/desktop/src/hima-home.ts';
import type { ReplayEntry } from '@deepseek-ai/dsh-llm-replay';
const lib = process.env.HIMA_DBOS_TEST_LIB ?? path.join(repoRoot, 'packages/harness/lib');
const at = (file: string) => import(pathToFileURL(path.join(lib, `${file}.js`)).href);
const { workshopTaskAdapter, teamTaskAdapter, nativeTeamPolicy } = await at('native-task-adapters');
const { executeTaskEffect, sendTaskEffectMessage, commandTaskAdapter, collectTaskProducerOutput, taskEffectStep, taskEffectAdapterVersion } = await at('task-effects');
const { readDelegationResult, delegationChildSessionId, nativeMessagesCompletedThrough } = await at('delegation');
const { jsonDigest } = await at('run-store');
const { loadPack } = await at('packs');
const { packDigestExcludes } = await at('pack-folder');
const { loadSite } = await at('sites');
const { createInteractiveBindingBridge, interactiveCommandsDigest, BUILTIN_TCL_ADAPTER_DIGEST } = await at('interactive-binding');
const { taskInteractiveDelegationGrant, closeTaskInteractiveSessions, listTaskInteractiveSessions } = await at('task-interactive');
const say = (text: string): ReplayEntry => ({ kind: 'chunks', chunks: [{ type: 'block-start', index: 0, blockType: 'text' }, { type: 'block-end', index: 0, block: { type: 'text', text } }, { type: 'finish', reason: { kind: 'stop' } }] });
const tool = (name: string, args: unknown, id: string): ReplayEntry => ({ kind: 'chunks', chunks: [{ type: 'block-start', index: 0, blockType: 'tool-call' }, { type: 'block-end', index: 0, block: { type: 'tool-call', id: id as never, name, arguments: JSON.stringify(args) } }, { type: 'finish', reason: { kind: 'tool-calls' } }] });
process.env.HIMA_TEST_SILENT_AGENT = '1';
process.env.HIMA_TEST_LEGACY_AUTO_DRIVE = '0';
test('native Workshop code -> retained program -> existing Reader and continuable Team share PG effect handoff, without owner complete', { timeout: 90000 }, async () => {
    const made = await createHimaHome(), h = { ...made, workspace: await realpath(made.workspace) };
    if (process.env.HIMA_DBOS_TEST_PACKAGE) {
        const link = path.join(h.profileDir, 'node_modules/@hima/harness');
        await rm(link, { recursive: true, force: true });
        await symlink(process.env.HIMA_DBOS_TEST_PACKAGE, link, 'dir');
    }
    let host: Awaited<ReturnType<typeof bootInProcess>> | undefined;
    let operatorCleanup: (() => Promise<unknown>) | undefined;
    try {
        const sitesDir = path.join(h.home, 'hima/sites'), workshopAbs = path.join(h.workspace, 'research'), materials = path.join(h.home, 'native-materials');
        await mkdir(sitesDir, { recursive: true });
        await mkdir(workshopAbs, { recursive: true });
        await writeFile(path.join(h.workspace, 'numbers.txt'), '3\n7\n11\n');
        await writeFile(path.join(h.home, 'method.md'), '# Sum the real input, multiply by two.\n');
        const packsDir = path.join(h.home, 'hima/packs'), operatorDir = path.join(packsDir, 'native-operator'), admin = path.join(h.home, 'admin');
        await mkdir(path.join(operatorDir, 'tools'), { recursive: true });
        await mkdir(admin);
        const repl = path.join(operatorDir, 'tools/repl.tcl');
        await writeFile(repl, 'set value 0\nproc get_value {} {global value;return $value}\nputs "HIMA:hima-tcl-line-v1:1:READY"\nflush stdout\nwhile {[gets stdin line] >= 0} {if {[catch {uplevel #0 $line} answer]} {puts stderr $answer};flush stdout;flush stderr}\n');
        await writeFile(path.join(operatorDir, 'contract.yml'), stringify({ id: 'native-operator', version: '1', title: 'Native Operator seam fixture', strategy: {}, inputs: [{ name: 'workspaceRoot' }], outputs: [], environment: { wrappers: ['/usr/bin/tclsh'] }, workspace: { copy: [] }, tools: [{ id: 'operate', file: 'tools/repl.tcl', inputs: [], argv: ['/usr/bin/tclsh', repl], licences: { fixture: 1 }, interactive: { mode: 'interactive-only', adapter: 'hima-tcl-line-v1', closeGraceMs: 2000, commands: { read: ['get_value'], mutate: [], save: [] }, arguments: { get_value: [] } } }] }));
        await writeFile(path.join(operatorDir, 'graph.yml'), stringify({ schema: 'hima-flow/1', id: 'native-operator', version: '1', flow: { kind: 'task', id: 'operate', tool: 'operate', inputs: {}, contract: { input: { version: '1', schema: { $schema: 'https://json-schema.org/draft/2020-12/schema', type: 'object' } }, output: { version: '1', schema: { $schema: 'https://json-schema.org/draft/2020-12/schema', type: 'object' } } } } }));
        const operatorPack = loadPack(packsDir, 'native-operator'), operatorPackSha = operatorPack.folder.digest(packDigestExcludes), environmentFile = path.join(admin, 'environment.json'), bindingsFile = path.join(admin, 'bindings.json');
        await writeFile(environmentFile, 'Explicit local Tcl native seam fixture\n');
        const bindingRow = { id: 'native-operator-binding', site: 'native', packDigest: operatorPackSha, toolId: 'operate', adapter: 'hima-tcl-line-v1', adapterHash: BUILTIN_TCL_ADAPTER_DIGEST, commandsDigest: interactiveCommandsDigest(operatorPack.contract.tools[0]), environment: { id: 'native-tcl-test', file: environmentFile, sha256: createHash('sha256').update(await readFile(environmentFile)).digest('hex') }, mutation: 'qualified' };
        await writeFile(bindingsFile, JSON.stringify({ schema: 'hima-interactive-bindings/1', bindings: [bindingRow] }));
        process.env.HIMA_TEST_INTERACTIVE_BINDING_ID = bindingRow.id;
        await writeFile(path.join(sitesDir, 'native.permit.yml'), stringify({ allowedReadRoots: [h.workspace, operatorDir, admin], allowedWriteRoots: [h.workspace], allowedWrappers: ['/bin/sh', '/usr/bin/python3', '/usr/bin/tclsh'], forbidden: ['services', 'licences', 'network', 'deletions', 'downloads'] }));
        await writeFile(path.join(sitesDir, 'native.yml'), stringify({ name: 'native', kind: 'local', workspaceRoot: h.workspace, permit: './native.permit.yml', bindings: { workspaceRoot: h.workspace }, capacity: { cores: 2, memoryGiB: 1, parallelJobs: 2, licences: { fixture: 1 } } }));
        const script = `set -eu\nprintf 'program\\n' >> "$1/program-calls"\nsleep 0.5\n/usr/bin/python3 - "$1" <<'PY'\nimport pathlib,json,sys\np=pathlib.Path(sys.argv[1]);total=sum(int(v) for v in (p/'numbers.txt').read_text().split())*2\n(p/'report.json').write_text(json.dumps({'schema':'fixture-sum/1','sum':total}))\nPY\n`;
        let scenario = { ...await writeMomentFixture(h, 'one-turn'), children: [] as readonly string[] };
        await writeFile(scenario.override, JSON.stringify([tool('hima_workshop_read', { output: 'numbers' }, 'native-read'), tool('hima_workshop_knowledge', { file: 'method.md' }, 'native-knowledge'), tool('hima_workshop_write', { path: 'entry.sh', content: 'exit 9\n' }, 'native-draft'), tool('hima_workshop_write', { path: 'entry.sh', content: script }, 'native-final'), say('Entry written; the real program and Reader determine the result.'), ...Array.from({ length: 5 }, (_, index) => [tool('hima_workshop_write', { path: 'entry.sh', content: index === 4 ? script : `# revision ${index}\n` + script }, `native-repair-${index}`), say(`Native repair ${index} written.`)]).flat()]));
        const inputFactId = `hima-fact:${jsonDigest(['task-result', 'native-workshop-effect'])}`;
        scenario = await appendReplaySession(scenario, 'native-team-member', [tool('hima_delegation_input', { runId: 'native-workshop', recordId: 'hima-fact:ungranted' }, 'team-ungranted'), tool('hima_delegation_input', { runId: 'native-workshop', recordId: inputFactId, path: '/value' }, 'team-read-source'), say(JSON.stringify({ schema: 'fixture-member/1', decision: 'accept', goalMet: false })), ...Array.from({ length: 6 }, (_, round) => [tool('hima_delegation_input', { runId: 'native-workshop', recordId: inputFactId, path: '/value' }, `team-followup-read-${round}`), say(JSON.stringify({ schema: 'fixture-member/1', decision: 'accept', goalMet: false, round }))]).flat()]);
        // DSH also wakes the original parent once on settlement; the replay adapter binds by first request order.
        for (const id of ['partial-one', 'partial-two', 'settlement-notice'])
            scenario = await appendReplaySession(scenario, id, [tool('hima_delegation_input', { runId: 'native-workshop', recordId: inputFactId, path: '/value' }, `read-${id}`), say(JSON.stringify({ schema: 'fixture-member/1', decision: 'accept', goalMet: false }))]);
        const opTarget = { runId: 'native-operator-run', executionId: 'native-operator-execution', nodeId: 'operate', ownerEpoch: 0, controlRevision: 0 }, nativeSession = '{{fromRequest:(hima-[0-9a-f]{36})}}';
        for (let fixture = 0; fixture < 3; fixture++)
            scenario = await appendReplaySession(scenario, `native-operator-or-settlement-${fixture}`, [tool('hima_interactive', { request: { ...opTarget, action: 'open', requestId: 'native-operator-open' } }, 'operator-open'), tool('hima_interactive', { request: { ...opTarget, action: 'input', requestId: 'native-operator-read', toolSessionId: nativeSession, commandId: 'native-get-value', command: { name: 'get_value', args: {} }, waitMs: 1000 } }, 'operator-read'), say(JSON.stringify({ schema: 'fixture-operator/1', observed: 0, goalMet: false }))]);
        await writeReplayOverlay(h.home, { file: scenario.file, overrideFile: scenario.override, childFiles: scenario.children });
        await import('node:fs/promises').then(({ appendFile }) => appendFile(homePatchFile(h.home), `\n- id: hima\n  config:\n    sitesDir: ${JSON.stringify(sitesDir)}\n    packsDir: ${JSON.stringify(path.join(h.home, 'hima/packs'))}\n    knowledgeDir: ${JSON.stringify(path.join(h.home, 'hima/knowledge/current'))}\n    interactiveBindingsFile: ${JSON.stringify(bindingsFile)}\n`));
        host = await bootInProcess(h, { withWebApp: true });
        let store = host.ctx.hima.durable.store;
        let parent = await createPresetRootAgent(host.ctx, h.workspace, 'standard');
        const parentId = String(parent.id), parentModel = { provider: parent.options.provider!, model: parent.options.model! };
        const schema = { version: '1', schema: { $schema: 'https://json-schema.org/draft/2020-12/schema', type: 'object' } };
        const workshopInput = { version: '1', schema: { $schema: 'https://json-schema.org/draft/2020-12/schema', type: 'object', properties: { scale: { type: 'number' } }, required: ['scale'], additionalProperties: false } };
        const input = { scale: 2 };
        const run = await store.createRun({ runId: 'native-workshop', inputSha256: jsonDigest(input), applicationVersion: host.ctx.hima.durable.applicationVersion, owner: parentId, deadlineAt: '2099-01-01T00:00:00.000Z', data: { input } });
        const request = { input, contract: { input: workshopInput, output: schema }, identity: { runId: run.runId, taskId: 'analyze', effectId: 'native-workshop-effect', inputSha256: jsonDigest(input), packSha256: '1'.repeat(64), irSha256: '2'.repeat(64), applicationVersion: run.applicationVersion, adapterVersion: taskEffectAdapterVersion }, admission: { runId: run.runId, effectId: 'native-workshop-effect', owner: run.owner, epoch: run.epoch, revision: run.revision } };
        const wait = async (req: any, adapter: any) => {
            let latest: any;
            for (let n = 0; n < 200; n++) {
                const result = await executeTaskEffect(store, req, adapter);
                latest = result;
                if (result.state === 'succeeded')
                    return result;
                await new Promise(resolve => setTimeout(resolve, 20));
            }
            if (req.identity.taskId === 'partial-team')
                console.error('Partial second native failure', JSON.stringify((await (host!.ctx.get('sessionQuery' as never) as any).readSession(delegationChildSessionId(parentId, 'partial-two'))).events.slice(-12)));
            throw new Error(`Native task did not hand off: ${JSON.stringify(latest)}; ${JSON.stringify(await store.effectSnapshot(req.identity))}`);
        };
        const readerScript = path.join(h.workspace, 'reader.py');
        await writeFile(readerScript, `import pathlib,json,sys\np=pathlib.Path(sys.argv[1]);v=json.loads((p/'report.json').read_text())\nassert v['schema']=='fixture-sum/1' and isinstance(v['sum'],int)\nwith (p/'reader-calls').open('a') as f:f.write('reader\\n')\n(p/'reader-output.json').write_text(json.dumps({'schemaVersion':'1','value':{'sum':v['sum'],'goalMet':False},'artifacts':[{'name':'report','path':'report.json'}],'diagnostics':[]}))\n`);
        let workshopOptions = { ctx: host.ctx, store, request, sitesDir, siteId: 'native', workspace: h.workspace, scope: { runId: run.runId, nodeId: 'analyze', attempt: 1, declaration: { id: 'analysis', purpose: 'Calculate sum', directory: 'research', entry: 'entry.sh', language: 'sh', inputs: [], reads: ['numbers'], knowledge: ['method.md'], produces: 'result', argv: [], licences: { fixture: 1 } }, workshopAbs, reads: [{ name: 'numbers', path: path.join(h.workspace, 'numbers.txt') }], knowledge: [{ file: 'method.md', purpose: 'Sum specification', at: path.join(h.home, 'method.md') }] }, instructions: 'Use only granted Workshop tools. Write entry.sh.', prompt: 'Read numbers and method.md; write the program.', retainedMaterialsDir: materials, argv: ['/bin/sh', path.join(workshopAbs, 'entry.sh'), h.workspace], collectProgram: async (_site: any, _job: any, programRequest: any) => {
                assert.deepEqual(programRequest.input, { scale: 2 });
                assert.deepEqual(programRequest.contract.input, workshopInput);
                const report = await taskEffectStep('native.fixture.report', () => readFile(path.join(h.workspace, 'report.json'))), value = { reportSha256: createHash('sha256').update(report).digest('hex') };
                const child = { ...programRequest, input: value, contract: { input: schema, output: schema }, identity: { ...programRequest.identity, taskId: 'reader', effectId: `${programRequest.identity.effectId}:reader`, inputSha256: jsonDigest(value) }, admission: { ...programRequest.admission, effectId: `${programRequest.identity.effectId}:reader` } };
                const reader = commandTaskAdapter({ sitesDir, siteId: 'native', workspace: h.workspace, name: 'existing-reader', argv: ['/usr/bin/python3', readerScript, h.workspace], collect: async (site: any, _job: any, req: any) => collectTaskProducerOutput(site, h.workspace, path.join(h.workspace, 'reader-output.json'), req) });
                const done = await wait(child, reader);
                return { schemaVersion: '1', value: done.result.value, artifacts: done.result.artifacts.map((item: any) => ({ ...item, runId: programRequest.identity.runId, taskId: programRequest.identity.taskId, effectId: programRequest.identity.effectId })), diagnostics: done.result.diagnostics };
            } };
        let adapter = workshopTaskAdapter(workshopOptions);
        // Native completion without its launch ACK reconnects the original session; defer the program
        // until five actual model turns have revised code, including a cold Host reopen and revert.
        const lost = { ...adapter, submit: async (...args: any[]) => { await adapter.submit(...args); throw new Error('Fixture lost native completion ACK'); }, collect: async () => { throw new Error('Native review is revising the entry before its one program Job'); } };
        assert.equal((await executeTaskEffect(store, request, lost)).state, 'waiting');
        await store.command({ runId: run.runId, commandId: 'pause-native', action: 'pause', owner: parentId, epoch: 0, revision: 0 });
        assert.equal((await sendTaskEffectMessage(store, request, adapter, 'held-repair', 'Change the entry while paused')).state, 'waiting');
        await store.command({ runId: run.runId, commandId: 'continue-native', action: 'continue', owner: parentId, epoch: 1, revision: 0 });
        request.admission.epoch = 2;
        for (let round = 0; round < 5; round++) {
            if (round === 2) {
                await host.dispose();
                await writeFile(scenario.override, JSON.stringify(Array.from({ length: 3 }, (_, index) => { const version = index + 2; return [tool('hima_workshop_write', { path: 'entry.sh', content: version === 4 ? script : `# revision ${version}\n` + script }, `native-repair-${version}`), say(`Native repair ${version} written.`)]; }).flat()));
                host = await bootInProcess(h, { withWebApp: true });
                store = host.ctx.hima.durable.store;
                parent = (await resumeTestAgent(host.ctx, parentId, parentModel)).agent;
                workshopOptions = { ...workshopOptions, ctx: host.ctx, store };
                adapter = workshopTaskAdapter(workshopOptions);
            }
            const native = round === 0 ? { ...adapter, message: async (...args: any[]) => { await adapter.message(...args); throw new Error('Fixture lost native message ACK'); } } : adapter;
            assert.equal((await sendTaskEffectMessage(store, request, native, `repair-${round}`, `Revise entry for round ${round}`)).state, 'completed');
            adapter = workshopTaskAdapter(workshopOptions);
        }
        const nativePrepared = await store.effectFact(request.identity.effectId, 'prepared') as any, nativeAgent = host.ctx.get('agents')!.get(nativePrepared.sessionId as never)!;
        assert.ok(nativeAgent);
        const writer = (content: string, callId: string) => host!.ctx.tools.execute({ agent: nativeAgent, name: 'hima_workshop_write', callId: callId as never, arguments: { path: 'entry.sh', content }, signal: new AbortController().signal });
        const replay = await writer('exit 9\n', 'native-draft');
        assert.match(JSON.stringify(replay), /already crossed|original.*writer/i);
        assert.equal(await readFile(path.join(workshopAbs, 'entry.sh'), 'utf8'), script);
        const changed = await writer('exit 7\n', 'native-draft');
        assert.match(JSON.stringify(changed), /different.*content|identity.*different/i);
        assert.equal(await readFile(path.join(workshopAbs, 'entry.sh'), 'utf8'), script);
        const startedProgram = await executeTaskEffect(store, request, adapter);
        assert.equal(startedProgram.state, 'waiting');
        const busy = await writer('exit 3\n', 'native-active-rewrite');
        assert.match(JSON.stringify(busy), /program Job owns.*Workshop code/);
        assert.equal(await readFile(path.join(workshopAbs, 'entry.sh'), 'utf8'), script);
        const done = await wait(request, adapter);
        assert.deepEqual(done.result.value, { sum: 42, goalMet: false });
        assert.equal(await readFile(path.join(h.workspace, 'program-calls'), 'utf8'), 'program\n');
        assert.equal(await readFile(path.join(h.workspace, 'reader-calls'), 'utf8'), 'reader\n');
        const original = await store.effectFact(request.identity.effectId, 'prepared');
        assert.ok((original as any).sessionId);
        assert.equal(Object.keys(await store.listExternalEffectFacts(request.identity, 'code:')).length, 7, JSON.stringify({ code: Object.keys(await store.listExternalEffectFacts(request.identity, 'code:')), messages: await store.listExternalEffectFacts(request.identity, 'message:') }));
        assert.equal(Object.keys(await store.listExternalEffectFacts(request.identity, 'knowledge:')).length, 2);
        assert.deepEqual(await executeTaskEffect(store, request, adapter), done);
        assert.equal(await readFile(path.join(h.workspace, 'program-calls'), 'utf8'), 'program\n');
        await mkdir(path.join(h.workspace, 'team-input'));
        await writeFile(path.join(h.workspace, 'team-input', 'report.json'), await readFile(path.join(h.workspace, 'report.json')));
        // A composition may supply a larger inherited request cap; the native grant still owns the ceiling.
        host.ctx.on('agent/request', async ({ agent }, next) => { const config = await next(); return agent.session.header.origin === 'subagent' ? { ...config, maxTokens: 64000 } : config; });
        const teamInput = { purpose: 'review sum' };
        const teamRun = await store.run(run.runId);
        assert.ok(await store.fact(inputFactId));
        const teamRequest = { ...request, input: teamInput, contract: { input: schema, output: schema }, identity: { ...request.identity, runId: teamRun.runId, taskId: 'review', effectId: 'native-team-effect', inputSha256: jsonDigest(teamInput) }, admission: { runId: teamRun.runId, effectId: 'native-team-effect', owner: teamRun.owner, epoch: teamRun.epoch, revision: teamRun.revision } };
        const contract = { delegationId: 'native-reviewer', parentSessionId: String(parent.id), role: 'reviewer', task: 'Review the supplied sum. Return fixture-member/1 JSON.', inputRefs: [inputFactId], workspaceRef: h.workspace, runRef: { runId: teamRun.runId, expectedEpoch: teamRun.epoch, expectedRevision: teamRun.revision }, nodeRef: 'review', allowedTools: ['hima_delegation_input'], budgetShare: { maxElapsedMs: 60000, maxFollowups: 20, maxTokensPerTurn: 16000 }, dependencyIds: [], recipient: { kind: 'parent', sessionId: String(parent.id) }, status: 'requested' };
        const options = { ctx: host.ctx, store, request: teamRequest, sitesDir, siteId: 'native', workspace: h.workspace, members: [{ contract }], permit: async () => true, collectMembers: async (members: any[]) => { const result = members[0].result; assert.equal(result.status, 'candidate'); const events = (await (host!.ctx.get('sessionQuery' as never) as any).readSession(result.childSessionId)).events; const headers = events.filter((event: any) => event.type === 'request/header'); assert.ok(headers.length > 0 && headers.every((event: any) => event.data.header.config.maxTokens === 16000)); const native = JSON.stringify(events); assert.match(native, /hima-postgresql/); assert.match(native, /\\"role\\":\\"reviewer\\"/); assert.match(native, /explicitly contracted Run inputs|exact input reference/); const text = result.output.filter((block: any) => block.type === 'text').map((block: any) => block.text).join(''); const value = JSON.parse(text); assert.equal(value.schema, 'fixture-member/1'); return { schemaVersion: '1', value, artifacts: [], diagnostics: [] }; } };
        let blockReviewer = false, reviewerEntered = false, unlockReviewer = () => { };
        let reviewerGate = Promise.resolve();
        const reviewerId = delegationChildSessionId(parentId, 'native-reviewer');
        host.ctx.on('agent/request', async ({ agent }, next) => {
            if (blockReviewer && String(agent.id) === reviewerId) {
                reviewerEntered = true;
                await reviewerGate;
            }
            return next();
        });
        const blockLatestReviewer = () => { blockReviewer = true; reviewerEntered = false; reviewerGate = new Promise<void>(resolve => { unlockReviewer = resolve; }); };
        const awaitReviewerBlocked = async () => {
            for (let poll = 0; poll < 100 && !reviewerEntered; poll++)
                await new Promise(resolve => setTimeout(resolve, 10));
            assert.equal(reviewerEntered, true);
        };
        try {
            let base = teamTaskAdapter(options);
            const checked = { ...base, collect: async () => { throw new Error('Review requires its five declared native follow-ups'); } };
            let pending: any;
            for (let poll = 0; poll < 100; poll++) {
                pending = await executeTaskEffect(store, teamRequest, checked);
                if (pending.reason?.code === 'reader-rejected')
                    break;
                await new Promise(resolve => setTimeout(resolve, 20));
            }
            assert.equal(pending.reason.code, 'reader-rejected');
            for (let round = 0; round < 5; round++) {
                const prior = (await store.externalEffectFact(teamRequest.identity, 'child:native-reviewer:intent')) as any;
                const priorTurn: Awaited<ReturnType<typeof readDelegationResult>> | undefined = round === 0 ? await readDelegationResult(host!.ctx, prior) : undefined;
                if (round === 0)
                    blockLatestReviewer();
                const native = round === 0 ? { ...base, message: async (...args: any[]) => { await base.message(...args); throw new Error('Fixture lost Team native inbox ACK'); } } : base;
                assert.equal((await sendTaskEffectMessage(store, teamRequest, native, `team-round-${round}`, { memberId: 'native-reviewer', text: `Review the same PG input, round ${round}` })).state, 'completed');
                if (round === 0) {
                    await awaitReviewerBlocked();
                    assert.equal(await nativeMessagesCompletedThrough(host!.ctx, reviewerId, [], priorTurn!.completedTurn!.endSeq), false);
                    const older = await executeTaskEffect(store, teamRequest, base);
                    assert.equal(older.state, 'waiting');
                    assert.equal(older.retainedResult, undefined);
                    assert.equal(await store.effectFact(teamRequest.identity.effectId, 'validated-result'), undefined);
                    blockReviewer = false;
                    unlockReviewer();
                }
                let completed = false;
                for (let poll = 0; poll < 100; poll++) {
                    const intent = await store.externalEffectFact(teamRequest.identity, 'child:native-reviewer:intent') as any;
                    const result = await readDelegationResult(host!.ctx, intent);
                    const text = result.output?.filter((block: any) => block.type === 'text').map((block: any) => block.text).join('');
                    if (text && JSON.parse(text).round === round) {
                        completed = true;
                        break;
                    }
                    await new Promise(resolve => setTimeout(resolve, 20));
                }
                assert.equal(completed, true);
                base = teamTaskAdapter(options);
            }
            // The native message may arrive after selection but before the result is retained.
            let raced = false;
            const raceAdapter = teamTaskAdapter({ ...options, collectMembers: async (members: any[], req: any) => {
                    const output = await options.collectMembers(members);
                    if (!raced) {
                        raced = true;
                        blockLatestReviewer();
                        assert.equal((await sendTaskEffectMessage(store, teamRequest, base, 'selection-race', { memberId: 'native-reviewer', text: 'Use the newest requested refinement' })).state, 'completed');
                        await awaitReviewerBlocked();
                    }
                    return output;
                } });
            const racedResult = await executeTaskEffect(store, teamRequest, raceAdapter);
            assert.equal(racedResult.state, 'waiting');
            assert.equal(racedResult.retainedResult, undefined);
            assert.equal(await store.effectFact(teamRequest.identity.effectId, 'validated-result'), undefined);
            assert.equal(await store.externalEffectFact(teamRequest.identity, 'collection-seal'), undefined);
            blockReviewer = false;
            unlockReviewer();
            const team = await wait(teamRequest, base);
            assert.equal(team.result.value.round, 5);
            assert.equal(team.result.value.decision, 'accept');
            assert.equal(team.result.value.goalMet, false);
            const held = await store.externalEffectFact(teamRequest.identity, 'child:native-reviewer:intent') as any;
            assert.equal(held.effective.childSessionId, delegationChildSessionId(String(parent.id), 'native-reviewer'));
            assert.equal((await executeTaskEffect(store, teamRequest, teamTaskAdapter(options))).state, 'succeeded');
        }
        finally {
            blockReviewer = false;
            unlockReviewer();
        }
        // A pause after member one completed must not strand an unsent frozen member two.
        const partialRequest = { ...teamRequest, identity: { ...teamRequest.identity, taskId: 'partial-team', effectId: 'native-partial-team-effect' }, admission: { ...teamRequest.admission, effectId: 'native-partial-team-effect' } };
        const partialOptions = { ...options, request: partialRequest, members: ['partial-one', 'partial-two'].map(id => ({ contract: { ...contract, delegationId: id } })), collectMembers: async (members: any[]) => ({ schemaVersion: '1', value: { members: members.map(member => JSON.parse(member.result.output.filter((block: any) => block.type === 'text').map((block: any) => block.text).join(''))) }, artifacts: [], diagnostics: [] }) };
        const rawRecord = store.recordExternalEffectFact.bind(store);
        let pausedAfterFirst = false;
        store.recordExternalEffectFact = async (identity: any, phase: string, fact: any) => {
            await rawRecord(identity, phase, fact);
            if (identity.effectId === partialRequest.identity.effectId && phase === 'child:partial-one:receipt:accepted' && !pausedAfterFirst) {
                let observed = false;
                for (let poll = 0; poll < 100; poll++) {
                    const intent = await store.externalEffectFact(identity, 'child:partial-one:intent') as any;
                    const result = await readDelegationResult(host!.ctx, intent);
                    if (result.status === 'candidate') {
                        observed = true;
                        break;
                    }
                    await new Promise(resolve => setTimeout(resolve, 20));
                }
                if (!observed) {
                    const id = delegationChildSessionId(parentId, 'partial-one');
                    console.error('Native partial member original failure', JSON.stringify((await (host!.ctx.get('sessionQuery' as never) as any).readSession(id)).events.slice(-12)));
                    throw new Error('First partial member has no retained completed boundary');
                }
                pausedAfterFirst = true;
                await store.command({ runId: run.runId, commandId: 'partial-pause', action: 'pause', owner: parentId, epoch: 2, revision: 0 });
            }
        };
        const partial = teamTaskAdapter(partialOptions);
        assert.equal((await executeTaskEffect(store, partialRequest, partial)).state, 'waiting');
        assert.equal(pausedAfterFirst, true);
        assert.equal(await store.effectDispatchExists(partialRequest.identity, 'native-child:partial-two'), false);
        await store.command({ runId: run.runId, commandId: 'partial-continue', action: 'continue', owner: parentId, epoch: 3, revision: 0 });
        assert.equal((await executeTaskEffect(store, partialRequest, partial)).state, 'waiting');
        assert.equal(await store.effectDispatchExists(partialRequest.identity, 'native-child:partial-two'), false);
        const continuedRequest = { ...partialRequest, admission: { ...partialRequest.admission, epoch: 4 } };
        const completed = await wait(continuedRequest, teamTaskAdapter({ ...partialOptions, request: continuedRequest }));
        assert.equal(completed.result.value.members.length, 2);
        assert.equal(await store.effectDispatchExists(partialRequest.identity, 'native-child:partial-two'), true);
        store.recordExternalEffectFact = rawRecord;
        const opInput = { purpose: 'read actual Tcl state' }, opRun = await store.createRun({ runId: 'native-operator-run', owner: parentId, inputSha256: jsonDigest(opInput), applicationVersion: run.applicationVersion, deadlineAt: '2099-01-01T00:00:00.000Z', data: { input: opInput } });
        const opRequest = { ...request, input: opInput, contract: { input: schema, output: schema }, identity: { ...request.identity, runId: opRun.runId, taskId: 'operate', effectId: 'native-operator-effect', inputSha256: jsonDigest(opInput), packSha256: operatorPackSha, irSha256: operatorPack.flow.irSha256 }, admission: { runId: opRun.runId, effectId: 'native-operator-effect', owner: parentId, epoch: 0, revision: 0 } };
        await store.prepareEffect(opRequest.identity, { kind: 'team', version: taskEffectAdapterVersion, input: opInput });
        const bridge = createInteractiveBindingBridge({ packsDir, sitesDir, interactiveBindingsFile: bindingsFile }), site = loadSite(sitesDir, 'native');
        const interactiveDeps = { store, sitesDir, bridge, trustedTestQualification: { bindingId: bindingRow.id }, resolveOperation: async (identity: any, target: any) => bridge.resolve({ pack: operatorPack, run: { id: identity.runId, packId: operatorPack.id, packDigest: operatorPackSha, campaignId: 'fixture', siteId: 'native', strategy: {}, generation: 1 }, execution: { id: target.executionId, nodeId: target.nodeId, kind: 'act', methodDigest: operatorPackSha, attempt: 1 }, site, workspace: h.workspace, node: { id: 'operate', kind: 'act', parameters: { tool: 'operate', arguments: {} } } }) };
        const operatorGrant = await taskEffectStep('native.fixture.operator.qualification', () => taskInteractiveDelegationGrant(interactiveDeps, opRequest.identity, opRequest.admission, { executionId: opTarget.executionId, nodeId: opTarget.nodeId }));
        const operatorContract = { ...contract, delegationId: 'native-operator-member', role: 'operator', task: 'Open the qualified native Tcl execution and read get_value. Return fixture-operator/1 JSON.', inputRefs: [], runRef: { runId: opRun.runId, expectedEpoch: 0, expectedRevision: 0 }, nodeRef: 'operate', allowedTools: ['hima_interactive'] };
        operatorCleanup = () => closeTaskInteractiveSessions(interactiveDeps, delegationChildSessionId(parentId, 'native-operator-member'));
        const operator = teamTaskAdapter({ ctx: host.ctx, store, request: opRequest, sitesDir, siteId: 'native', workspace: h.workspace, members: [{ contract: operatorContract, operatorGrant }], permit: async () => true, closeOperator: (id: string) => closeTaskInteractiveSessions(interactiveDeps, id), collectMembers: async (members: any[]) => { const result = members[0].result, log = await (host!.ctx.get('sessionQuery' as never) as any).readSession(result.childSessionId); const trace = JSON.stringify(log.events); assert.match(trace, /hima_interactive/); assert.match(trace, /command-completed|completed/); const sessions = await listTaskInteractiveSessions(store, opRequest.identity); assert.equal(sessions.length, 1); assert.equal(sessions[0].status, 'ready'); assert.equal(sessions[0].activeCommand, undefined); return { schemaVersion: '1', value: JSON.parse(result.output.filter((block: any) => block.type === 'text').map((block: any) => block.text).join('')), artifacts: [], diagnostics: [] }; } });
        const operatorDone = await wait(opRequest, operator);
        assert.equal(operatorDone.result.value.observed, 0);
        assert.equal((await listTaskInteractiveSessions(store, opRequest.identity))[0].status, 'closed');
        assert.equal((await store.effectResources()).filter((lease: any) => lease.effectId.startsWith('native-operator-effect:interactive:') && !lease.released).length, 0);
    }
    finally {
        await operatorCleanup?.();
        await host?.dispose();
        await h.dispose();
    }
});
