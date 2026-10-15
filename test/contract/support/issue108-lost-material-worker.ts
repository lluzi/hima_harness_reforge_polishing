/** Test-only original Host PID: publish one real retained Run artifact, then exit. */
import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const [home, harnessRoot] = process.argv.slice(2) as [string, string];
if (!home || !harnessRoot || !process.env.HIMA_POSTGRES_RUNTIME || !process.env.HIMA_DBOS_TEST_LIB
  || !process.env.HIMA_TEST_LINEAGE_DIR || process.env.NODE_TEST_CONTEXT === undefined) throw Error('Private original worker admission missing');
const lib = process.env.HIMA_DBOS_TEST_LIB;
const load = (name: string) => import(pathToFileURL(path.join(lib, name + '.js')).href);
const gate = await load('local-database'), durable = await load('durable-runtime');
if (path.resolve(gate.localLineageDirectory()) !== path.resolve(process.env.HIMA_TEST_LINEAGE_DIR)) throw Error('Wrong test lineage');
const database = await gate.startLocalDatabase({ home, runtimeDirectory: process.env.HIMA_POSTGRES_RUNTIME });
let runtime: any;
try {
  runtime = await durable.startDurableRuntime({ database, manifest: await durable.installedExecutableManifest(harnessRoot) });
  const retained = await gate.resolveRetainedMaterialsDirectory({ home });
  const file = path.join(retained, 'lost-run', 'original.txt');
  await mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
  const bytes = Buffer.from('actual retained Run artifact'); await writeFile(file, bytes, { mode: 0o600 });
  const runId = 'lost-material-run', digest = createHash('sha256').update(bytes).digest('hex');
  await runtime.store.createRun({ runId, inputSha256: digest, applicationVersion: runtime.applicationVersion,
    owner: 'owner', deadlineAt: '2099-01-01T00:00:00.000Z', data: { purpose: 'material-loss-negative' } });
  await runtime.store.ensureFlowFact(runId, 'source-code', async () => ({ retainedPath: file, sha256: digest, bytes: bytes.length }));
  await runtime.stop(); runtime = undefined; await database.stop();
  process.send?.({ identity: database.identity, retained, file, applicationVersion: durable.executableApplicationVersion(await durable.installedExecutableManifest(harnessRoot)) });
} finally { await runtime?.stop(); await database.stop(); process.disconnect?.(); }
