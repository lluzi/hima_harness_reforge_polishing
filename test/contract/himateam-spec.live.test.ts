// #107 L4 proposal: actual Host/private PG, mixed native Pi/OpenCode and native
// Hindsight. No replay recall, supplied spec or evaluator input. Run only in the
// integrator's admitted serial window, under its external resource watcher.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { execFileSync } from 'node:child_process';
import { createReadStream } from 'node:fs';
import { lstat, mkdir, readFile, realpath, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { createInterface } from 'node:readline';
import { himaSkillsDir, type MemoryView, type TeamTaskView } from '@hima/harness';
import { bootInProcess, createRootAgent } from './support/boot-inprocess.ts';
import { createHimaHome, repoRoot } from './support/dsh-home.ts';
import { waitUntil } from './support/fabric.ts';
import { specDefinition, cas, feedbackSource } from './support/issue107/host.ts';
import { publicFixture, sha256 } from './support/issue107/fixture.mjs';

const correctionHash = '7d89d7b6a64b62997108b8e934e6b2107d0a40f71488c24fffdebb8ccbdb5bdf';
const admission = process.env.HIMA_TEST_SPEC_LIVE === '1';
const handoffDirectory = process.env.HIMA_SPEC_REUSE_HANDOFF;

test('mixed native research reads conflicting originals then a new task retrieves explicitly corrected Chinese experience', {
  timeout: 1_750_000, skip: admission ? false : 'Requires integrator admission HIMA_TEST_SPEC_LIVE=1 and a serial watched resource window',
}, async () => {
  const runtime = process.env.HIMA_TEST_TEAM_NATIVE_RUNTIME;
  assert.ok(runtime && process.env.DEEPSEEK_API_KEY, 'Use the existing runtime and shared product credential; no install');
  assert.equal(process.env.DEEPSEEK_MODEL ?? 'deepseek-flash', 'deepseek-flash');
  for (const key of ['HIMA_HINDSIGHT_LLM_PROVIDER','HIMA_HINDSIGHT_LLM_MODEL','HIMA_HINDSIGHT_LLM_API_KEY','HIMA_HINDSIGHT_LLM_BASE_URL','HIMA_HINDSIGHT_SKIP_LLM_VERIFICATION'])
    assert.equal(process.env[key], undefined, 'Keep the shared extraction producer: ' + key);
  // One frozen 1,800 s admission: leave 50 s to close owned resources. The
  // first task and retention have separate bounds so they cannot consume the
  // second task's time while still reporting a two-task success.
  const start = Date.now(), task1Deadline = start + (handoffDirectory ? 900_000 : 800_000);
  const retentionDeadline = start + (handoffDirectory ? 1_100_000 : 1_000_000), deadline = start + 1_700_000;
  const evidence = path.join(process.env.HIMA_TEAM_EVIDENCE ?? path.join(repoRoot, '.scratch/issue107-live'), new Date().toISOString().replace(/[:.]/g, '-'));
  await mkdir(evidence, { recursive: true });
  const manifestBytes = await readFile(path.join(runtime, 'team-runtime.json'));
  const manifest = JSON.parse(manifestBytes.toString('utf8'));
  assert.equal(manifest.components.find((item: any) => item.id === 'hindsight')?.version, '0.10.3');
  const demo = process.env.HIMA_SPEC_DEMO_DIR;
  assert.ok(demo, 'Operator must supply the existing frozen demo directory');
  const correction = await readFile(path.join(demo, 'operator/human-correction.md'));
  assert.equal(sha256(correction), correctionHash);
  const inputs = await publicFixture('task1');
  const task2Inputs = await publicFixture('task2');
  const handoff = handoffDirectory ? JSON.parse(await readFile(path.join(handoffDirectory, 'retained-contribution-material.json'), 'utf8')) : undefined;
  if (handoff) {
    assert.equal(handoff.schema, 'issue107.retained-contribution-material/1');
    assert.equal(handoff.acceptanceOutcome.includes('FAIL'), true);
    assert.deepEqual(new Set(handoff.contributions.map((row: any) => row.memberId)), new Set(['researcher','challenger']));
    assert.ok(handoff.contributions.every((row: any) => row.originalResourcesReleased && row.originalClosedProof && row.resultSha256));
    assert.deepEqual(new Set(handoff.sources.map((row: any) => row.sha256)),
      new Set(inputs.filter(item => item.name.startsWith('document-')).map(item => item.identity.sha256)));
  }
  // Retain component/model identities. Integrator must freeze and verify the exact
  // embedding/reranker files before admission, as for #104; this test changes none.
  const sourcePaths = ['packages/harness/src/index.ts', 'packages/harness/src/run-store.ts',
    'packages/harness/src/team-memory.ts', 'packages/harness/src/team-attachments.ts',
    'packages/harness/src/oar-member-process.ts', 'packages/harness/src/oar-local-member.ts',
    'packages/harness/src/skills.ts', 'packages/harness/skills/hima-team-spec/SKILL.md',
    'packages/harness/skills/hima-team-spec/team.json', 'test/contract/himateam-spec.live.test.ts'];
  const sourceFileSha256 = Object.fromEntries(await Promise.all(sourcePaths.map(async file =>
    [file, sha256(await readFile(path.join(repoRoot, file)))])));
  const sourceHead = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repoRoot, encoding: 'utf8' }).trim();
  const handoffFiles = handoffDirectory ? await Promise.all(['prior-research.md','prior-counterexamples.md'].map(async name => ({
    name, bytes: await readFile(path.join(handoffDirectory, name)) }))) : [];
  await writeFile(path.join(evidence, 'candidate.json'), JSON.stringify({ sourceHead, sourceFileSha256,
    runtimeManifestSha256: sha256(manifestBytes), components: manifest.components, model: 'deepseek-flash', inputPolicy: 'public phase allowlists only',
    acceptanceScope: handoff ? 'prior failed task Host-committed research/counterexample handoff, new editing/spec task, then independent adopted recall task' : 'two-task source+recall composition with active native correction notice',
    ...(handoff ? { priorTask: handoff.original, handoffFileSha256: sha256(await readFile(path.join(handoffDirectory!, 'retained-contribution-material.json'))),
      stagedContributionSha256: Object.fromEntries(handoffFiles.map(item => [item.name, sha256(item.bytes)])) } : {}),
    budget: { totalMs: 1_800_000, testMs: 1_750_000, task1DeadlineMs: task1Deadline - start,
      retentionDeadlineMs: retentionDeadline - start, task2DeadlineMs: 1_700_000, totalTreeMiB: 3072 } }, null, 2));
  const skillHash = sha256(await readFile(path.join(himaSkillsDir(), 'hima-team-spec/SKILL.md')));
  const home = await createHimaHome({ desktopShaped: true });
  const liveEnvironment = { HIMA_TEST_SILENT_AGENT: '1', HIMA_TEST_LEGACY_AUTO_DRIVE: '0', HIMA_TEAM_RUNTIME: runtime,
    HIMA_POSTGRES_RUNTIME: path.join(runtime, 'postgres'),
    HIMA_HINDSIGHT_EMBEDDINGS_LOCAL_MODEL: path.join(runtime, 'models/BAAI-bge-small-en-v1.5'),
    HIMA_HINDSIGHT_RERANKER_LOCAL_MODEL: path.join(runtime, 'models/cross-encoder-ms-marco-MiniLM-L-6-v2') };
  const prior = new Map(Object.keys(liveEnvironment).map(key => [key, process.env[key]]));
  Object.assign(process.env, liveEnvironment);
  Object.assign(home.env, { HIMA_TEAM_RUNTIME: runtime, HIMA_POSTGRES_RUNTIME: path.join(runtime, 'postgres'),
    HIMA_HINDSIGHT_EMBEDDINGS_LOCAL_MODEL: path.join(runtime, 'models/BAAI-bge-small-en-v1.5'),
    HIMA_HINDSIGHT_RERANKER_LOCAL_MODEL: path.join(runtime, 'models/cross-encoder-ms-marco-MiniLM-L-6-v2'),
    DEEPSEEK_API_KEY: process.env.DEEPSEEK_API_KEY, DEEPSEEK_MODEL: 'deepseek-flash',
    DEEPSEEK_BASE_URL: process.env.DEEPSEEK_BASE_URL ?? 'https://api.deepseek.com/anthropic', DEEPSEEK_API: 'anthropic-messages' });
  await writeFile(path.join(evidence, 'home.json'), JSON.stringify({ home: home.home, skillHash }));
  let host: Awaited<ReturnType<typeof bootInProcess>> | undefined, hindsightStarted = false;
  const tasks: TeamTaskView[] = [], observations: unknown[] = [];
  const sourceStages = new Map<string, string[]>();
  let hindsightPid: number | undefined;
  let cleanupProved = false, functionalPassed = false, sessionId = '';
  let cleanupFailure: unknown, primaryFailure: unknown;
  try {
    // File uploads are owned by the Web App layer; this remains an in-process Host,
    // with no Electron window or model turn added by the composition itself.
    host = await bootInProcess(home, { withWebApp: true }); const service = host.ctx.hima, store = service.durable.store;
    await service.reconciled;
    sessionId = String((await createRootAgent(host.ctx, home.workspace)).id);
    const op = (request: unknown) => service.teamOperation(sessionId, request, 'human') as Promise<any>;
    const memory = (task: TeamTaskView, action: 'feedback'|'correct'|'adopt'|'status'|'query', request: unknown) =>
      service.workMemory(sessionId, { teamId: task.team.teamId, taskId: task.taskId, action, request }, 'person') as Promise<any>;
    const template = await specDefinition();
    const definition = handoff ? { ...template,
      members: template.members.filter(member => ['lead','editor'].includes(member.id)),
      collaboration: 'New integration task: the prior researcher and challenger are Host-verified staged inputs. Only lead and editor execute; retain conflicts and independently verify sources before delivery.' } : template;
    const team = await op({ action: 'save', definition, expectedVersion: null });
    const open = async (requestId: string, text: string, taskDeadline = deadline) => {
      const task = await op({ action: 'startTask', teamId: team.teamId, request: { requestId, teamId: team.teamId, expectedVersion: team.version,
        goal: text, input: { audience: '产品负责人和研发工程师', acceptance: ['可追溯的功能行为、异常与验收；未知保持未知'] },
        deadlineAt: new Date(taskDeadline).toISOString(), closure: 'Deliver sourced spec or honest unresolved decisions within the admitted deadline.' } }) as TeamTaskView;
      tasks.push(task); assert.equal(task.readiness.ready, true, JSON.stringify(task.readiness)); return task;
    };
    const stage = async (task: TeamTaskView, item: Awaited<ReturnType<typeof publicFixture>>[number], index: number) => {
      const agent = host!.ctx.get('agents')!.get(sessionId as never)!;
      const receipt = await host!.ctx.get('fileUploads')!.uploadStream({ sessionId: agent.id, name: item.name, data: (async function* () { yield item.bytes; })() });
      return op({ action: 'stage-attachment', teamId: team.teamId, taskId: task.taskId, request: { requestId: `live-stage-${index}`, receiptId: receipt.receiptId } });
    };
    const read = (task: TeamTaskView) => op({ action: 'readTask', teamId: team.teamId, taskId: task.taskId });
    const finish = async (task: TeamTaskView) => {
      let view: any, nextFailureCheck = 0;
      await waitUntil('actual native spec delivery and resource closure', async () => {
        view = await read(task);
        if (Date.now() >= nextFailureCheck) {
          nextFailureCheck = Date.now() + 5000;
          for (const invocation of await store.flowInvocations(task.currentRunId)) {
            const failure = await store.effectFact(invocation.identity.effectId, 'terminal-failure') as {reason?:string}|undefined;
            if (failure) assert.fail(`Native task effect failed before spec delivery: ${String(failure.reason ?? 'unknown').slice(0, 500)}`);
          }
        }
        for (const question of view.humanRequests ?? []) {
          await writeFile(path.join(evidence, task.taskId + '-human-request.json'), JSON.stringify(question, null, 2));
          assert.equal(question.output.version, 'hima-spec-source-selection/1', 'Other business questions require operator decisions; this bounded probe has no synthetic business answers');
          const stageIds = sourceStages.get(task.taskId); assert.ok(stageIds?.length);
          await op({ action: 'respond', teamId: team.teamId, taskId: task.taskId, request: { requestId: question.binding.requestId, binding: question.binding,
            output: { schemaVersion: question.output.version, value: { stageIds }, artifacts: [], diagnostics: [] } } });
        }
        if (['failed','cancelled'].includes(view.execution?.state)) assert.fail('Task ended without a spec; inspect retained task and native receipts');
        return view.execution?.state === 'succeeded' && view.execution.resourceState === 'closed';
      }, Math.max(1, Date.parse(task.deadlineAt) - Date.now()), 500);
      const result = view.execution.tasks.find((item: any) => item.result?.outputSchemaVersion === 'hima-functional-spec/1')?.result;
      assert.ok(result, 'Actual committed functional-spec result is required');
      await writeFile(path.join(evidence, task.taskId + '-result.json'), JSON.stringify(result, null, 2)); return result;
    };
    const sourceRequest = { requestId: 'source-ready', goal: 'Identify authorized source originals', input: {}, dependsOn: [], deadlineAt: new Date(task1Deadline).toISOString(),
      output: { version: 'hima-spec-source-selection/1', schema: { type: 'object', properties: { stageIds: { type: 'array', items: { type: 'string' } } }, required: ['stageIds'], additionalProperties: false } } };
    const task1Goal = handoff
      ? `This is a NEW editor integration task after failed original task ${handoff.original.taskId}. Two prior role results are Host-committed and physically closed, but the old lead/editor delivery is NOT complete. Use only the newly staged original documents and the separately staged prior-research/prior-counterexamples materials; reconcile old material SHA/locator to the new authorized stage IDs. Do not rerun researcher or challenger. Delegate only the OpenCode editor to integrate and challenge development usability, then the Pi lead independently verifies both originals, the prior contributions and editor work before submitting the first real functional spec. Both lead and editor must call read-material for both originals and both prior contribution files, using read-excerpt where needed. Preserve conflicts and unknown business choices rather than guessing. Read the installed hima-team-spec method and read-messages for source materials. If none arrived, invoke member_context ask-human with request ${JSON.stringify(sourceRequest)} and wait for its returned delegationId. On Host yield-accepted, await checked successor context rather than finalizing the original turn. Final delivery must cite current original locations, prior effect identities and what is newly edited. No old transcript or hidden human correction is available.\nBusiness objective: ${inputs[0]!.text.split('### T1-02')[0]}`
      : inputs[0]!.text + '\nRead the installed hima-team-spec method. Before finalizing, read-messages for source materials. If none arrived, invoke member_context ask-human with request ' + JSON.stringify(sourceRequest) +
        '. Then wait for its returned delegationId. The operator will supply only authorized stageIds. Do not invent content. Delegate independent source research to the OpenCode researcher and a counterexample review before delivery. Both Pi and OpenCode researchers must call read-material for both originals. Unresolved business choices may be delivered as conditional decisions. On Host yield-accepted, wait for checked successor context rather than finalizing the original turn.';
    const task1 = await open(handoff ? 'spec-reuse-editor-task' : 'spec-live-task1', task1Goal, task1Deadline);
    const stages = [];
    for (const [i, item] of inputs.filter(item => item.name.startsWith('document-')).entries()) {
      const saved = await stage(task1, item, i);
      assert.equal(saved.material.sha256, item.identity.sha256); assert.equal(saved.parser.status, 'parsed'); stages.push(saved);
    }
    const priorStages: any[] = [];
    for (const [index, item] of handoffFiles.entries()) {
      const agent = host.ctx.get('agents')!.get(sessionId as never)!;
      const receipt = await host.ctx.get('fileUploads')!.uploadStream({ sessionId: agent.id, name: item.name,
        data: (async function* () { yield item.bytes; })() });
      const staged = await op({ action: 'stage-attachment', teamId: team.teamId, taskId: task1.taskId,
        request: { requestId: `reuse-prior-${index}`, receiptId: receipt.receiptId } });
      assert.equal(staged.material.sha256, sha256(item.bytes)); assert.equal(staged.parser.status, 'parsed'); priorStages.push(staged);
    }
    const authorizedStages = [...stages, ...priorStages];
    await op({ action: 'send-message', teamId: team.teamId, taskId: task1.taskId, request: { requestId: 'spec-live-sources',
      recipientMemberIds: handoff ? ['lead','editor'] : definition.members.map(member => member.id),
      text: (handoff ? '原件与两份经 Host 核验的旧任务贡献已提交。旧任务验收失败；本任务须重新编辑并交付，不能把旧草稿当成完成。' : '原件已提交。') +
        '通过 read-material/read-excerpt 读取；保留分歧，未决业务取舍可条件交付。' + JSON.stringify(authorizedStages.map(item => ({ stageId: item.stageId, sha256: item.material.sha256 }))),
      stagedAttachmentIds: authorizedStages.map(item => item.stageId) } });
    sourceStages.set(task1.taskId, authorizedStages.map(item => item.stageId));
    const first = await finish(task1);
    assert.ok(first.value.conflicts.length, 'Conflicting source proposals must survive into the delivery');
    const sourceMap: any[] = [];
    for (const [i, stage] of stages.entries()) {
      const original = inputs.filter(item => item.name.startsWith('document-'))[i]!;
      const cited = first.value.sources.filter((source: any) => source.stageId === stage.stageId
        && source.materialId === stage.material.materialId && source.sha256 === stage.material.sha256
        && source.version === `${original.identity.documentId}@${original.identity.version}`);
      const resolved = cited.flatMap((source: any) => original.identity.locators.filter(locator => source.location.includes(locator))
        .flatMap(locator => stage.parser.chunks.filter((chunk: any) => chunk.text.includes(locator))
          .map((chunk: any) => ({ documentId: original.identity.documentId, version: original.identity.version,
            stageId: stage.stageId, materialSha256: stage.material.sha256, citedLocation: source.location,
            documentLocator: locator, parserLocation: chunk.location, chunkSha256: chunk.sha256 }))));
      assert.ok(resolved.length, 'Spec document locator must resolve through the exact current material and parser chunk');
      sourceMap.push(...resolved);
    }
    await writeFile(path.join(evidence, 'source-locator-map.json'), JSON.stringify(sourceMap, null, 2));
    const receipts = async (task: TeamTaskView) => {
      const rows: any[] = [];
      for (const invocation of await store.flowInvocations(task.currentRunId)) {
        const prepared = await store.effectFact(invocation.identity.effectId, 'prepared') as any;
        if (!prepared?.runtime) continue;
        const session = await store.externalEffectFact(invocation.identity, 'oar:native-session') as any;
        const native = session ? [session] : [];
        const events: any[] = [];
        if (session?.controlDirectory) {
          const control = await realpath(session.controlDirectory);
          assert.ok(control.startsWith((await realpath(home.home)) + path.sep), 'Native journal stays in this private Home');
          const file = path.join(control, 'journal.jsonl');
          const info = await lstat(file);
          assert.ok(info.isFile() && !info.isSymbolicLink());
          const lines = createInterface({ input: createReadStream(file), crlfDelay: Infinity });
          for await (const line of lines) {
            const row = JSON.parse(line);
            if (!['created', 'received', 'terminal', 'control'].includes(row.kind)
              && !(row.kind === 'event' && row.payload?.kind === 'tool_call_started')) continue;
            assert.deepEqual(await store.externalEffectFact(invocation.identity,
              `oar:observation:${row.streamGeneration}:${row.seq}`), row,
            'Selected native event must be the original persisted Host observation');
            events.push(row);
            assert.ok(events.length <= 256, 'Retained acceptance events are bounded');
          }
        }
        const replies = Object.entries(await store.listExternalEffectFacts(invocation.identity, 'oar:tool-reply:'))
          .map(([phase, value]) => ({ ...(value as object), callId: phase.slice('oar:tool-reply:'.length) })) as any[];
        // The runner's request UUID keys the durable Host reply. OAR's tool_call_started
        // callId is a different native identity, so never pair those by string equality.
        let calls: any[] = [];
        if (replies.length) {
          const controlDirectory = native[0]?.controlDirectory;
          assert.equal(typeof controlDirectory, 'string');
          const control = await realpath(controlDirectory);
          assert.ok(control.startsWith((await realpath(home.home)) + path.sep), 'Native request evidence stays in this private Home');
          calls = await Promise.all(replies.map(async reply => {
            assert.match(reply.callId, /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i);
            const file = path.join(control, 'native/requests', reply.callId + '.json');
            const info = await lstat(file);
            assert.ok(info.isFile() && !info.isSymbolicLink() && info.size <= 16_384);
            const bytes = await readFile(file);
            assert.equal(bytes.length, info.size);
            const request = JSON.parse(bytes.toString('utf8'));
            assert.equal(request.id, reply.callId);
            return { callId: reply.callId, action: request.action, request: request.request,
              requestSha256: sha256(bytes), requestMtimeMs: info.mtimeMs };
          }));
          assert.ok(events.some((event: any) => event.kind === 'event' && event.payload?.kind === 'tool_call_started'),
            'Persisted Host replies require actual native tool-call activity');
        }
        const skills = await store.externalEffectFact(invocation.identity, 'oar:skill-binding') as any;
        assert.ok(skills?.some((file: any) => file.path.endsWith('/hima-team-spec/SKILL.md') && file.sha256 === skillHash), 'Native staging uses the actual method bytes');
        rows.push({ effectId: invocation.identity.effectId, memberId: prepared.memberId, runtime: prepared.runtime, native, events, replies, calls });
      }
      return rows;
    };
    const firstReceipts = await receipts(task1);
    if (handoff) {
      assert.equal(firstReceipts.some(row => ['researcher','challenger'].includes(row.memberId)), false,
        'Previously completed research and counterexample roles must not be rerun in the new task');
      assert.ok(firstReceipts.some(row => row.memberId === 'editor'), 'The new task needs a fresh native editor contribution');
    }
    assert.deepEqual(new Set(firstReceipts.filter(row => row.native.length && (row.events.some((event: any) => event.kind === 'received') ||
      (row.runtime === 'opencode' && row.events.some((event: any) => event.kind === 'control' && event.payload?.action === 'prompt_ack') && row.replies.some((reply: any) => reply.ok)))).map(row => row.runtime)), new Set(['pi','opencode']));
    const sourceReads = firstReceipts.flatMap(row => row.calls.filter((call: any) => ['read-material','read-excerpt'].includes(call.action))
      .map((call: any) => {
        const reply = row.replies.find((item: any) => item.callId === call.callId);
        return { runtime: row.runtime, effectId: row.effectId, callId: call.callId, action: call.action,
          stageId: call.request.stageId, location: call.request.location, ok: reply?.ok === true,
          materialId: reply?.value?.material?.materialId, materialSha256: reply?.value?.material?.sha256,
          parserStatus: reply?.value?.parser?.status,
          chunks: reply?.value?.parser?.chunks?.map((chunk: any) => ({ location: chunk.location, sha256: chunk.sha256 })),
          excerptSha256: reply?.value?.sha256,
          responseSha256: reply?.ok ? sha256(Buffer.from(JSON.stringify(reply.value))) : undefined };
      }));
    assert.ok(sourceReads.length <= 64, 'Keep native source-read evidence bounded');
    await writeFile(path.join(evidence, 'source-read-receipts.json'), JSON.stringify(sourceReads, null, 2));
    for (const runtimeName of ['pi','opencode']) for (const stage of stages)
      assert.ok(sourceReads.some(read => read.runtime === runtimeName && read.action === 'read-material' && read.ok
        && read.stageId === stage.stageId && read.materialSha256 === stage.material.sha256),
      'Each runtime must actually read both source originals via Host');
    if (handoff) for (const runtimeName of ['pi','opencode']) for (const stage of priorStages)
      assert.ok(sourceReads.some(read => read.runtime === runtimeName && read.action === 'read-material' && read.ok
        && read.stageId === stage.stageId && read.materialSha256 === stage.material.sha256),
      'Both fresh roles must read the Host-staged prior committed contributions');
    // Read operator correction only AFTER the genuine initial output exists. The
    // correction file itself, evaluator and initial output never enter Task 2.
    hindsightStarted = true;
    const running = await service.teamRuntimeOperation({ action: 'start', serviceId: 'hindsight' }) as any;
    assert.equal(running.receipt.state, 'running'); hindsightPid = running.receipt.owned.pid; assert.ok(hindsightPid); observations.push({ service: running.receipt });
    const correctionText = correction.toString('utf8').split('### HC-01')[1]!.split('### HC-04')[0]!;
    await writeFile(path.join(evidence, 'operator-proxy.json'), JSON.stringify({
      role: 'human-authorized-agent-proxy', authorizationSourceThreadId: '01a132dd-860a-7620-a21c-9e03cf5e90c8',
      authorizationText: '不要让人类纠正干扰，你可以作为人类角色代替我去和他们互动，继续推进',
      correctionDocumentSha256: correctionHash, correctionTextSha256: sha256(Buffer.from(correctionText)),
      scope: 'Frozen D3D-HC@1.0 HC-01 through HC-03 only; product human entry, no new business judgment',
      userPersonallyClicked: false,
    }, null, 2));
    const initial = await memory(task1, 'feedback', { requestId: 'live-initial-summary', target: { kind: 'team' },
      text: JSON.stringify(first.value.functionalSpec).slice(0, 8000), reason: 'Actual first delivery retained before authorized agent-proxy demo correction; no forced wrong business decision', conditions: ['当前项目和团队首版研究'] }) as MemoryView;
    const feedback = await memory(task1, 'feedback', { requestId: 'live-correction-feedback', target: { kind: 'team' }, text: correctionText, reason: 'Human-authorized agent proxy persisted frozen D3D-HC@1.0 correction before adoption', conditions: ['叠衡 Sketch 首版架构探索及其试用交接'] }) as MemoryView;
    assert.equal(feedback.tip.state, 'candidate');
    const corrected = await memory(task1, 'correct', { requestId: 'live-human-correction', ...cas(initial), text: correctionText,
      reason: 'Human-authorized agent proxy submitted frozen D3D-HC@1.0 correction', conditions: ['叠衡 Sketch 首版架构探索及其试用交接'], sources: [feedbackSource(feedback)] }) as MemoryView;
    assert.equal(corrected.tip.state, 'candidate');
    const adopted = await memory(task1, 'adopt', { requestId: 'live-explicit-adoption', ...cas(corrected), action: 'adopted',
      reason: 'Human-authorized agent proxy explicitly adopted the exact replacement version returned by Host', evidenceRefs: [feedbackSource(corrected)], conditions: ['叠衡 Sketch 首版架构探索及其试用交接'] }) as MemoryView;
    const memoryReceipt = (view: MemoryView) => ({
      record: { memoryId: view.record.memoryId, version: view.record.version, sha256: view.record.sha256,
        scope: view.record.scope, sourceTaskId: view.record.sourceTaskId, sourceRunId: view.record.sourceRunId,
        sources: view.record.sources, conditions: view.record.conditions },
      tip: { eventId: view.tip.eventId, version: view.tip.version, revision: view.tip.revision,
        event: view.tip.event, state: view.tip.state, evidenceRefs: view.tip.evidenceRefs,
        conditions: view.tip.conditions, supersedesEventId: view.tip.supersedesEventId },
      index: { operationId: view.index.operationId, documentId: view.index.documentId,
        state: view.index.state, revision: view.index.revision, nativeStatus: view.index.nativeStatus },
    });
    const memoryEvidence = { correctionFileSha256: correctionHash, correctionTextSha256: sha256(Buffer.from(correctionText)),
      initial: memoryReceipt(initial), feedback: memoryReceipt(feedback), corrected: memoryReceipt(corrected),
      adopted: memoryReceipt(adopted) };
    await writeFile(path.join(evidence, 'memory-evidence.json'), JSON.stringify(memoryEvidence, null, 2));
    let retained: MemoryView | undefined;
    await waitUntil('real native corrected-document retention', async () => {
      const page = await memory(task1, 'status', { page: { limit: 30 }, reconcile: true });
      const item = page.records.find((item: MemoryView) => item.record.memoryId === adopted.record.memoryId);
      assert.notEqual(item?.index.state, 'failed');
      if (item?.index.state === 'confirmed' && item.index.nativeStatus === 'completed') retained = item;
      return retained !== undefined;
    }, Math.max(1, retentionDeadline - Date.now()), 1500);
    assert.ok(retained);
    observations.push({ retention: retained.index });
    await writeFile(path.join(evidence, 'memory-evidence.json'), JSON.stringify({ ...memoryEvidence, retained: memoryReceipt(retained) }, null, 2));
    const task2Text = task2Inputs[0]!.text;
    assert.equal(/K-27|边界复核单|可交接，热结论挂起|HC-0[123]|D3D-HC/u.test(task2Text), false,
      'The independent Task 2 public input must not contain the correction-only labels');
    const task2 = await open('spec-live-task2', task2Text + '\nRead current team memory and messages through member_context before finalizing. Cite the current applicable experience and its source; do not treat an operator notice as a source.');
    // The operator sends only a memory pointer after this independent task's
    // real leader session has started. It contains no correction answer.
    let activeLead: any;
    await waitUntil('Task 2 active native lead session', async () => {
      for (const invocation of await store.flowInvocations(task2.currentRunId)) {
        const prepared = await store.effectFact(invocation.identity.effectId, 'prepared') as any;
        const native = await store.externalEffectFact(invocation.identity, 'oar:native-session') as any;
        if (prepared?.memberId === definition.leaderMemberId && native) activeLead = invocation;
      }
      return Boolean(activeLead);
    }, Math.max(1, deadline - Date.now()), 250);
    const notice = await op({ action: 'send-message', teamId: team.teamId, taskId: task2.taskId,
      request: { requestId: 'spec-live-adopted-notice', recipientMemberIds: [definition.leaderMemberId],
        text: '本团队有新采纳的经验。请按当前业务目标用 query-memory 查询适用范围与来源，再决定是否修改规格；此通知不提供检索键或业务结论。', stagedAttachmentIds: [] } });
    assert.equal(/K-27|边界复核单|可交接，热结论挂起|HC-0[123]|D3D-HC/u.test(notice.message.text), false,
      'The human notice must not supply a correction-only retrieval key');
    const noticeDeliveryId = notice.deliveries[0]?.deliveryId;
    assert.ok(noticeDeliveryId, 'Human notice has a persisted delivery identity');
    let delivered: any;
    await waitUntil('adopted notice received by active native lead', async () => {
      delivered = await op({ action: 'reconcile-delivery', teamId: team.teamId, taskId: task2.taskId,
        request: { deliveryId: noticeDeliveryId } });
      if (delivered.state === 'rejected') assert.fail('Active native correction delivery rejected: ' + delivered.reason);
      return delivered.state === 'accepted';
    }, Math.max(1, deadline - Date.now()), 500);
    assert.equal(delivered.target.effectId, activeLead.identity.effectId);
    assert.equal(delivered.target.runId, task2.currentRunId);
    assert.equal(delivered.received.target.attemptId, delivered.target.attemptId);
    await writeFile(path.join(evidence, 'active-correction-delivery.json'), JSON.stringify({
      memoryId: adopted.record.memoryId, version: adopted.record.version, eventId: adopted.tip.eventId,
      revision: adopted.tip.revision, messageId: notice.message.messageId,
      contentDigest: notice.message.contentDigest, delivery: delivered }, null, 2));
    const second = await finish(task2);
    assert.notEqual(task2.taskId, task1.taskId); assert.notEqual(task2.currentRunId, task1.currentRunId);
    assert.ok(second.value.memoryRefs.some((item: any) => item.memoryId === adopted.record.memoryId && item.version === 2 && item.eventId === adopted.tip.eventId && item.revision === adopted.tip.revision));
    const specText = JSON.stringify(second.value.functionalSpec);
    assert.match(specText, /K-27/);
    assert.match(specText, /可交接，热结论挂起/);
    const roleBehavior = String(second.value.functionalSpec.userBehavior);
    assert.match(roleBehavior, /(?:主使用者|主要使用者|主用户|主操作员)\s*[=:：是]\s*(?:系统)?架构师|(?:系统)?架构师.{0,12}(?:是|为)\s*(?:首版)?(?:主要使用者|主用户)/u,
      'The architect must be the principal trial user, not merely mentioned');
    assert.match(roleBehavior, /封装.{0,12}复核|复核.{0,12}封装/u,
      'Packaging must remain the handoff reviewer');
    assert.match(specText, /两个候选|每个候选|2.{0,3}候选/);
    assert.match(specText, /责任人/);
    assert.match(specText, /接口预算/);
    assert.match(specText, /缺失边界|缺少.{0,5}边界|待补.{0,5}边界/);
    assert.match(specText, /下一项检查|下一步检查/);
    assert.match(specText, /热.{0,8}未知|未知.{0,8}热|热结论挂起/);
    await writeFile(path.join(evidence, 'task2-value-check.json'), JSON.stringify({
      sourceMemoryId: adopted.record.memoryId, sourceVersion: adopted.record.version,
      sourceEventId: adopted.tip.eventId, sourceRevision: adopted.tip.revision,
      productResultSha256: sha256(Buffer.from(JSON.stringify(second.value))),
      criteria: ['principal-user', 'reviewer', 'two-candidates', 'K-27-per-candidate', 'missing-boundary', 'responsible-owner', 'next-check', 'heat-unknown', 'handoff-state'],
      operatorReviewRequired: 'Read actual trial steps and success criteria after delivery. A rejected old proposal or negative non-goal may quote the old rule; accepting it as a success condition fails.' }, null, 2));
    const secondReceipts = await receipts(task2);
    assert.ok(secondReceipts.some(row => row.effectId === activeLead.identity.effectId &&
      row.events.some((event: any) => event.kind === 'received' && event.payload?.inputId === noticeDeliveryId &&
        `${event.nativeSession}:${event.streamGeneration}:${event.seq}` === delivered.received.nativeReceiptId)),
    'Persisted native lead received event must match the exact delivery receipt');
    const queryReceipts = secondReceipts.flatMap(row => row.calls.filter((call: any) => call.action === 'query-memory')
      .map((call: any) => {
        const reply = row.replies.find((item: any) => item.callId === call.callId);
        return { runtime: row.runtime, effectId: row.effectId, callId: call.callId, requestMtimeMs: call.requestMtimeMs,
          query: call.request.query, ok: reply?.ok === true,
          records: (reply?.value?.records ?? []).map((item: any) => ({ memoryId: item.record?.memoryId,
            version: item.record?.version, recordSha256: item.record?.sha256, sources: item.record?.sources,
            eventId: item.tip?.eventId, revision: item.tip?.revision, state: item.tip?.state,
            appliedConditions: item.appliedConditions, documentId: item.retrieval?.documentId,
            excerptSha256: item.retrieval?.excerpt ? sha256(Buffer.from(item.retrieval.excerpt)) : undefined })) };
      }));
    assert.ok(queryReceipts.length <= 32 && queryReceipts.every(item => typeof item.query === 'string' && item.query.length <= 1024),
      'Keep native query evidence bounded');
    await writeFile(path.join(evidence, 'query-receipts.json'), JSON.stringify(queryReceipts, null, 2));
    assert.ok(queryReceipts.some(item => item.ok && /[\u3400-\u9fff]/u.test(item.query)
      && /试用|客户|候选|架构|业务/u.test(item.query)
      && !/K-27|可交接，热结论挂起/u.test(item.query)
      && !item.query.includes(adopted.record.memoryId)
      && !item.query.includes(corrected.index.documentId)
      && !item.query.includes(adopted.tip.eventId)
      && (!/边界复核单|HC-0[123]|D3D-HC/u.test(item.query) || secondReceipts.some(row => row.calls.some((call: any) => {
        if (call.action !== 'readTask' || call.requestMtimeMs >= item.requestMtimeMs) return false;
        const reply = row.replies.find((value: any) => value.callId === call.callId);
        return reply?.ok === true && reply.value?.memory?.records?.some((record: any) =>
          record.record?.memoryId === adopted.record.memoryId && record.record?.version === adopted.record.version
          && record.tip?.eventId === adopted.tip.eventId && record.retrieval?.documentId === corrected.index.documentId);
      })))
      && item.records.some((record: any) => record.memoryId === adopted.record.memoryId && record.version === 2
        && record.eventId === adopted.tip.eventId && record.revision === adopted.tip.revision
        && record.documentId === corrected.index.documentId)),
    'Actual native Chinese business query must retrieve the current adopted experience without a hidden exact key');
    const firstSessions = new Set(firstReceipts.flatMap(row => row.native.map((native: any) => native.nativeSession)));
    for (const row of secondReceipts) for (const native of row.native) assert.ok(!firstSessions.has(native.nativeSession), 'Independent Task cannot reuse previous native conversation');
    for (const invocation of await store.flowInvocations(task2.currentRunId)) {
      const context = invocation.context as any;
      assert.equal(JSON.stringify(context.input).includes(correctionText), false, 'No full feedback/transcript injected as Task 2 assignment');
    }
    // Retain only allowlisted factual receipts: no model secrets or full native event payloads.
    observations.push({ first: firstReceipts.map(({ runtime, effectId, native }) => ({ runtime, effectId, native: native.map(({ nativeSession, streamGeneration }: { nativeSession:string; streamGeneration:string }) => ({ nativeSession, streamGeneration })) })),
      second: secondReceipts.map(({ runtime, effectId, native }) => ({ runtime, effectId, native: native.map(({ nativeSession, streamGeneration }: { nativeSession:string; streamGeneration:string }) => ({ nativeSession, streamGeneration })) })),
      memory: { memoryId: adopted.record.memoryId, version: adopted.record.version, eventId: adopted.tip.eventId, revision: adopted.tip.revision } });
    functionalPassed = true;
  } catch (error) { primaryFailure = error; throw error; } finally {
    try {
      if (host) {
        for (const task of tasks) {
          const service = host.ctx.hima;
          const view = await service.teamOperation(sessionId, { action: 'readTask', teamId: task.team.teamId, taskId: task.taskId }) as any;
          if (view.execution?.resourceState !== 'closed') {
            const run = await service.durable.store.run(view.currentRunId);
            await service.teamOperation(sessionId, { action: 'control', teamId: task.team.teamId, taskId: task.taskId,
              request: { requestId: 'spec-live-cleanup-' + task.taskId, action: 'cancel', expectedEpoch: run.epoch, expectedRevision: run.revision } }, 'human');
          }
        }
        if (hindsightStarted) {
          const stopped = await host.ctx.hima.teamRuntimeOperation({ action: 'stop', serviceId: 'hindsight' }) as any;
          assert.equal(stopped.receipt.owned.quiescent, true); hindsightStarted = false;
          assert.throws(() => process.kill(hindsightPid!, 0), (error: NodeJS.ErrnoException) => error.code === 'ESRCH', 'Owned Hindsight PID ended');
        }
      }
    } catch (error) { cleanupFailure = error; } finally {
      try {
        if (host) {
          const retiring = host.ctx.hima as unknown as { resourcesClosing?: Promise<void> };
          await host.dispose();
          if (!retiring.resourcesClosing) throw new Error('Original Host resource closer was not published');
          await retiring.resourcesClosing;
        }
        cleanupProved = cleanupFailure === undefined;
      } catch (error) { cleanupFailure ??= error; cleanupProved = false; }
      finally {
        for (const [key, value] of prior)
          if (value === undefined) delete process.env[key]; else process.env[key] = value;
        await writeFile(path.join(evidence, 'observations.json'), JSON.stringify(observations, null, 2));
        if (primaryFailure !== undefined || cleanupFailure !== undefined)
          await writeFile(path.join(evidence, 'failure-boundary.json'), JSON.stringify({
            primary: primaryFailure instanceof Error ? primaryFailure.message.slice(0, 1000) : String(primaryFailure ?? ''),
            cleanup: cleanupFailure instanceof Error ? cleanupFailure.message.slice(0, 1000) : String(cleanupFailure ?? ''),
            cleanupProved, taskIds: tasks.map(task => task.taskId),
          }, null, 2));
        if (cleanupProved && functionalPassed) await home.dispose();
      }
    }
  }
  if (cleanupFailure !== undefined) throw cleanupFailure;
  assert.equal(functionalPassed, true); assert.equal(cleanupProved, true);
  await writeFile(path.join(evidence, 'result.json'), JSON.stringify({ result: 'PASS', scope: 'two-task native sources and adopted Chinese recall',
    elapsedMs: Date.now() - start, activeCorrectionNativeDelivery: 'PASS', fullIssue107: 'requires review of retained business result' }, null, 2));
});
