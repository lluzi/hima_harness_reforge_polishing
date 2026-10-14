// External test adapter plane only. Load before original Hima Service.init releases DBOS adapters.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';
assert.ok(process.env.NODE_TEST_CONTEXT, 'Explicit Node test context is required');
assert.equal(process.env.HIMA_TEST_SILENT_AGENT, '1');
const lib = process.env.HIMA_DBOS_TEST_LIB;
const evidence = process.env.HIMA_ISSUE105_EVIDENCE;
assert.ok(lib && evidence && process.env.DSH_HOME);
const require = createRequire(path.join(lib, 'index.js'));
const { Service } = await import(pathToFileURL(require.resolve('@deepseek-ai/cordis')).href);
const { default: Hima } = await import(pathToFileURL(path.join(lib, 'index.js')).href);
const { OarLocalMemberRuntime } = await import(pathToFileURL(path.join(lib, 'oar-local-member.js')).href);
const { createOarMemberExecutor } = await import(pathToFileURL(path.join(lib, 'oar-member-process.js')).href);
const home = process.env.DSH_HOME;
const runnerModule = process.env.HIMA_ISSUE105_RUNNER;
assert.ok(runnerModule);
const original = Hima.prototype[Service.init];
Hima.prototype[Service.init] = async function () {
  const owner = this;
  let installed, executor, runtime;
  const write = (name, value) => {
    const file = path.join(evidence, name), temporary = file + '.tmp';
    fs.writeFileSync(temporary, JSON.stringify(value, null, 2)); fs.renameSync(temporary, file);
  };
  Object.defineProperty(owner, 'teamExecutor', { configurable: true, get: () => installed, set: () => {
    assert.equal(installed, undefined, 'Only one controlled adapter installation');
    const assets = { oarModule: 'ordinary-node-no-sdk', nodeExecutable: process.execPath,
      opencodeCommand: 'ordinary-node-no-cli', opencodeVersion: 'test-only' };
    runtime = new OarLocalMemberRuntime({ home, nodeExecutable: process.execPath, runnerModule, assets });
    executor = createOarMemberExecutor({ home, retainedMaterialsDir: owner.retainedMaterialsDir,
      services: owner.teamServices, store: owner.durable.store, localRuntime: runtime, runtimeAssets: async () => assets,
      sharedDeepSeekModel: async () => { throw Error('Product model fallback forbidden'); },
      memberContext: async (grant, request) => {
        // Exact production actor resolution; no synthetic grant, parent or Run tuple.
        const result = await owner.memberActorContext(grant, request);
        write('last-member-request.json', { grant, request, result });
        return result;
      } });
    installed = executor;
    owner.ctx.effect(() => () => executor.dispose(), 'test issue105 controlled adapter lifetime');
    // Read-only observation of retained Store facts. It creates no request, response or proof.
    const serial = async (items, read) => {
      const values = [];
      for (const item of items) values.push(await read(item));
      return values;
    };
    let busy = false;
    const timer = setInterval(() => { if (busy) return; busy = true; void (async () => {
      const retained = await owner.durable.store.transaction(async client => {
        await client.query('SET TRANSACTION READ ONLY');
        const rows = (await client.query('SELECT request,response,digest,response_digest FROM hima.team_human_requests ORDER BY task_id,request_id')).rows;
        const operator = (await client.query('SELECT actor_id FROM hima.host_operator WHERE singleton=true')).rows[0]?.actor_id;
        return { rows, operator };
      }, 'test.issue105.readHumanEvidence');
      // Observe only the principal created by the real Host/human UI; never initialize one.
      if (!retained.operator) return;
      const values = await serial(retained.rows, async row => {
        const binding = row.request.binding;
        const invocations = await owner.durable.store.flowInvocations(binding.runId);
        const effects = await serial(invocations, async invocation => {
          const prepared = await owner.durable.store.effectFact(invocation.identity.effectId, 'prepared');
          return { invocation,
          snapshot: await owner.durable.store.effectSnapshot(invocation.identity),
          prepared,
          resources: await owner.durable.store.effectResources(invocation.identity.effectId),
          native: await owner.durable.store.externalEffectFact(invocation.identity, 'oar:native-session'),
          closed: await owner.durable.store.externalEffectFact(invocation.identity, 'oar:closed'),
          // The Store resolves heads only from original logical roots, never a successor.
          head: prepared && !prepared.continuation ? await owner.durable.store.readTeamEffectHead(invocation.identity) : undefined,
          externalFacts: await owner.durable.store.listExternalEffectFacts(invocation.identity, 'oar:observation:') }; });
        for (const effect of effects) {
          const continuation = effect.head?.continuation;
          if (continuation) for (const candidate of effects) candidate.continuationReceipt = await owner.durable.store.effectFact(candidate.invocation.identity.effectId, 'team-result-input-receipt:' + continuation.continuationId);
        }
        return { ...row, operator: retained.operator, effects };
      });
      write('host-retained.json', values);
    })().catch(error => {
      const value = { error: String(error), observedAt: new Date().toISOString() };
      // Preserve the first observer error; shutdown can otherwise overwrite the cause.
      try { fs.writeFileSync(path.join(evidence, 'observation-first-error.json'), JSON.stringify(value, null, 2), { flag: 'wx' }); }
      catch (writeError) { if (writeError.code !== 'EEXIST') throw writeError; }
      write('observation-error.json', value);
    }).finally(() => { busy = false; }); }, 100);
    timer.unref();
    owner.ctx.effect(() => () => clearInterval(timer), 'test issue105 read-only observer');
  } });
  // Original init assigns original transport after executor; keep the controlled executor transport bound.
  Object.defineProperty(owner, 'teamTransport', { configurable: true, get: () => executor?.transport, set: () => {} });
  return original.call(this);
};
