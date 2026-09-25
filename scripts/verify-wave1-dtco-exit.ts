// Read-only post-verifier for a completed Wave 1 lane A Run whose live harness assertion was too broad.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const args = process.argv.slice(2); const evidenceAt = args.indexOf('--evidence');
if (evidenceAt < 0 || !args[evidenceAt + 1] || args.length !== 2) throw new Error('usage: node scripts/verify-wave1-dtco-exit.ts --evidence <evidence.json>');
const evidencePath = path.resolve(args[evidenceAt + 1]!);
const evidence = JSON.parse(readFileSync(evidencePath, 'utf8')) as Record<string, any>;
assert.equal(evidence.schema, 'hima.wave1-dtco-exit/1');
const records = evidence.records as Record<string, any>[]; assert.ok(Array.isArray(records));
const jobs = records.filter(record => record.type === 'job');
const observations = records.filter(record => record.type === 'observation');
const nodes = records.filter(record => record.type === 'node' && record.state === 'done');
const launched = (nodeId: string) => jobs.find(record => record.event === 'launched' && record.nodeId === nodeId);
const finished = (launch: Record<string, any>) => jobs.find(record => record.event === 'finished' && record.job.session === launch.job.session && record.seq > launch.seq);
const compile = launched('compile'); const foundry = launched('foundry-synth'); assert.ok(compile && foundry);
const compileFinished = finished(compile); const foundryFinished = finished(foundry); assert.ok(compileFinished && foundryFinished);
assert.equal(compileFinished.exitCode, 0); assert.equal(foundryFinished.exitCode, 0);
const compileRead = observations.find(record => record.reader?.id === 'read-compile');
const foundryRead = observations.find(record => record.reader?.id === 'read-foundry-synth'); assert.ok(compileRead && foundryRead);
assert.ok(nodes.some(record => record.nodeId === 'compile') && nodes.some(record => record.nodeId === 'read-compile')
  && nodes.some(record => record.nodeId === 'foundry-synth') && nodes.some(record => record.nodeId === 'read-foundry-synth'));
assert.ok(compile.seq < compileRead.seq && compileRead.seq < foundry.seq && foundry.seq < foundryRead.seq,
  'the one Run must preserve compile -> Reader -> foundry-synth -> Reader order');
assert.equal(compile.runId, evidence.runId); assert.equal(foundry.runId, evidence.runId);
assert.equal(compileRead.runId, evidence.runId); assert.equal(foundryRead.runId, evidence.runId);

const destination = 'luzi@192.168.50.41'; const workspace = evidence.workspace as string; assert.match(workspace, /^\/data\/eda\/project\/hima_harness\/wave1-dtco-exit-/);
const remote = (command: string): string => execFileSync('ssh', ['-o', 'BatchMode=yes', '-o', 'ConnectTimeout=10', '-o', 'ControlPath=none', destination, command], {
  encoding: 'utf8', timeout: 60_000, maxBuffer: 8 * 1024 * 1024,
});
const facts = JSON.parse(remote(`python3 - <<'PY'\nimport json,re,pathlib\nw=pathlib.Path('${workspace}'); p=w/'flow/records/foundry-synth.json'; d=json.load(open(p)); a=next(x for x in d['artifacts'] if x['role']=='synthesis_netlist'); log=w/d['executions'][0]['log']['path']; text=log.read_text(errors='replace'); print(json.dumps({'recordStatus':d['status'],'stageExit':d['executions'][0]['exitCode'],'log':str(log),'db1Errors':len(re.findall(r'Error: File is not a DB file\\. \\(DB-1\\)',text)),'netlist':a}))\nPY`));
assert.equal(facts.recordStatus, 'passed'); assert.equal(facts.stageExit, 0); assert.equal(facts.db1Errors, 0); assert.ok(facts.netlist.bytes > 0);
const environment = remote("/usr/local/bin/empyrean-license status; ps -eo pid,args | grep -E '(icexplorer-xtop_exe|qualib_exe|dc_shell|lc_shell)' | grep -v grep | grep -v '<defunct>' || true").trim();
assert.match(environment, /selected=new old=inactive new=active/); assert.doesNotMatch(environment, /icexplorer-xtop_exe|qualib_exe|dc_shell|lc_shell/);
const result = { schema: 'hima.wave1-dtco-exit-verification/1', recordedAt: new Date().toISOString(), status: 'PASS',
  runId: evidence.runId, workspace, packDigest: evidence.run?.packDigest, sequence: {
    compileJob: compile.id, compileFinished: compileFinished.id, compileObservation: compileRead.id,
    foundryJob: foundry.id, foundryFinished: foundryFinished.id, foundryObservation: foundryRead.id,
  }, facts, environment,
  claimLimits: ['continuous compile/read-compile/foundry-synth/read-foundry-synth gate only', 'no PPA, signoff, or full Campaign result'] };
const output = path.join(path.dirname(evidencePath), 'verification.json'); writeFileSync(output, `${JSON.stringify(result, null, 2)}\n`);
process.stdout.write(`${JSON.stringify({ status: 'PASS', runId: evidence.runId, verification: output }, null, 2)}\n`);
