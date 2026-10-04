import assert from 'node:assert/strict';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { repoRoot } from './dsh-home.ts';

const at = (name: string) => import(pathToFileURL(path.join(process.env.HIMA_DBOS_TEST_LIB ?? path.join(repoRoot, 'packages/harness/lib'), `${name}.js`)).href);

/** Admit the fixture through the product facade and await its actual copier receipt. */
export async function preparedFixtureRun(host: any, request: any) {
  const runtime = host.ctx.hima.durable;
  const started = await host.ctx.hima.startRun(request);
  assert.ok(['preparing', 'ran'].includes(started.kind), JSON.stringify(started));
  for (let n = 0; n < 400; n++) {
    const prepared = await runtime.store.flowFact(started.run.id, 'preparation');
    if (prepared) {
      assert.ok(['prepared', 'reused'].includes(prepared.kind), JSON.stringify(prepared));
      const run = await runtime.store.run(started.run.id);
      assert.equal(run.opening.data.run.id, run.runId);
      const { startFlow } = await at('flow-workflow');
      const handle = await startFlow(runtime, run.opening.data.start);
      return { run, handle, workspace: started.workspace };
    }
    await new Promise(resolve => setTimeout(resolve, 10));
  }
  throw new Error('Original product preparation did not produce a receipt');
}

/** Completion is one publication of the original report and archive, with real readable bytes. */
export async function assertFixturePublication(host: any, runId: string, home: string) {
  const service = host.ctx.hima;
  const { createDurableViewReaders } = await at('durable-views');
  const { resolveRetainedMaterialsDirectory } = await at('local-database');
  const deps = { ledger: service.ledger, judge: service.judge, durable: service.durable,
    host: host.ctx, sitesDir: path.join(home, 'hima/sites'), packsDir: path.join(home, 'hima/packs') };
  const readers = createDurableViewReaders(deps, { retainedMaterialsDir: await resolveRetainedMaterialsDirectory({ home }) });
  const records = await readers.readRunRecords(runId);
  assert.equal(records.filter((record: any) => record.type === 'archive' && record.delivery === 'complete').length, 1);
  assert.equal(records.filter((record: any) => record.type === 'experience').length, 1);
  assert.equal((await readers.readRunAssets(runId)).kind, 'read');
  assert.equal((await service.readExperience(runId)).kind, 'read');
}
