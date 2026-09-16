import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const repoRoot = path.resolve(import.meta.dirname, '../..');
const domain = path.join(repoRoot, 'packs/custom-cell-fmax-dtco/flow/domain');

function runPython(code: string, input: unknown, args: string[] = []) {
  return spawnSync('/usr/bin/python3', ['-c', code, domain, ...args], {
    input: JSON.stringify(input), encoding: 'utf8',
  });
}

function request(candidateId: string, equivalenceDigest: string, drive = 'D1') {
  return {
    candidate_id: candidateId,
    generator_contract: {
      target_library_profile: {
        process_family: 'SYNTHETIC', cell_architecture_ref: 'fixture://architecture',
      },
      interface: {
        inputs: [{ name: 'I0', direction: 'input' }, { name: 'I1', direction: 'input' }],
        outputs: [{ name: 'Y', direction: 'output', liberty_function: 'I0 & I1' }],
      },
      equivalence_reference: {
        digest: equivalenceDigest, input_order: ['I0', 'I1'], output_order: ['Y'],
      },
      implementation_request: {
        mode: 'synthesize_transistor_topology', drive_strengths: [drive], vt_classes: ['SVT'],
      },
    },
  };
}

test('LFR cumulative Library appends immutable shards and projects only new functions', async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'lfr-library-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const first = request('CAND_FIRST', 'sha256:function-a');
  const firstAlias = request('CAND_ALIAS', 'sha256:function-a');
  const second = request('CAND_FIRST', 'sha256:function-b');
  const code = `import hashlib,json,sys\nfrom pathlib import Path\nsys.path.insert(0,sys.argv[1])\nfrom _generation_projection import empty_cumulative_manifest,append_cumulative_shard,delta_generation_requests,expected_delta_generation_jobs,validate_cumulative_manifest\nd=json.load(sys.stdin); root=Path(sys.argv[2])\nmanifest=empty_cumulative_manifest({'source':'fixture://foundry.lib','bytes':17,'sha256':'a'*64})\nmanifest=append_cumulative_shard(root,manifest,'0001',[d['first']])\nold=(root/'shards'/'0001'/'manifest.json').read_bytes(); old_sha=hashlib.sha256(old).hexdigest()\npatterns={'generation_requests':[d['firstAlias'],d['second']]}\ndelta=delta_generation_requests(patterns,manifest); jobs=expected_delta_generation_jobs(patterns,manifest)\nmanifest=append_cumulative_shard(root,manifest,'0002',delta)\nvalidate_cumulative_manifest(manifest)\nprint(json.dumps({'manifest':manifest,'delta':[r['candidate_id'] for r in delta],'jobs':[r['candidate_id'] for r in jobs],'oldSha':old_sha,'oldShaAfter':hashlib.sha256((root/'shards'/'0001'/'manifest.json').read_bytes()).hexdigest()},sort_keys=True))`;
  const ran = runPython(code, { first, firstAlias, second }, [root]);
  assert.equal(ran.status, 0, ran.stderr);
  const result = JSON.parse(ran.stdout);
  assert.deepEqual(result.delta, ['CAND_FIRST']);
  assert.deepEqual(result.jobs, ['CAND_FIRST'], 'round two must create no Job for the old function');
  assert.equal(result.oldShaAfter, result.oldSha, 'adding round 2 must not rewrite shard 0001');
  assert.deepEqual(result.manifest.shards.map((row: { id: string }) => row.id), ['0001', '0002']);
  assert.equal(result.manifest.functions.length, 2);
  assert.equal(result.manifest.functions[0].state, 'discovered');
  assert.deepEqual(result.manifest.functions[0].stateHistory, ['discovered']);
  assert.match(result.manifest.functions[0].functionKey, /^sha256:[0-9a-f]{64}$/);
  const shard = JSON.parse(await readFile(path.join(root, 'shards/0002/manifest.json'), 'utf8'));
  assert.equal(shard.schema, 'custom-cell-library-shard/1');
  assert.equal(shard.functionKeys.length, 1);
});

test('LFR cumulative evidence states advance monotonically and retain proxy rejection knowledge', async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'lfr-library-state-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const first = request('CAND_FIRST', 'sha256:function-a');
  const code = `import json,sys\nfrom pathlib import Path\nsys.path.insert(0,sys.argv[1])\nfrom _generation_projection import empty_cumulative_manifest,append_cumulative_shard,advance_function_state\nd=json.load(sys.stdin); m=empty_cumulative_manifest({'source':'fixture://f','bytes':1,'sha256':'c'*64}); m=append_cumulative_shard(Path(sys.argv[2]),m,'0001',[d]); key=m['functions'][0]['functionKey']; m=advance_function_state(m,key,'proxy-mapped'); m=advance_function_state(m,key,'proxy-rejected','augmented mapping did not adopt this function'); print(json.dumps(m['functions'][0],sort_keys=True))`;
  const ran = runPython(code, first, [root]);
  assert.equal(ran.status, 0, ran.stderr);
  const row = JSON.parse(ran.stdout);
  assert.deepEqual(row.stateHistory, ['discovered', 'proxy-mapped', 'proxy-rejected']);
  assert.deepEqual(row.knownFailures, ['augmented mapping did not adopt this function']);

  const skipRoot = root + '-skip';
  t.after(() => rm(skipRoot, { recursive: true, force: true }));
  const skip = runPython(`import json,sys\nfrom pathlib import Path\nsys.path.insert(0,sys.argv[1])\nfrom _generation_projection import empty_cumulative_manifest,append_cumulative_shard,advance_function_state\nd=json.load(sys.stdin); m=empty_cumulative_manifest({'source':'fixture://f','bytes':1,'sha256':'d'*64}); m=append_cumulative_shard(Path(sys.argv[2]),m,'0001',[d]); advance_function_state(m,m['functions'][0]['functionKey'],'cumulative')`, first, [skipRoot]);
  assert.notEqual(skip.status, 0);
  assert.match(skip.stderr, /cannot advance/);
});

test('LFR cumulative Library refuses to append after a retained shard artifact changes', async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'lfr-library-tamper-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const first = request('CAND_FIRST', 'sha256:function-a');
  const second = request('CAND_SECOND', 'sha256:function-b');
  const code = `import json,sys\nfrom pathlib import Path\nsys.path.insert(0,sys.argv[1])\nfrom _generation_projection import empty_cumulative_manifest,append_cumulative_shard\nd=json.load(sys.stdin); root=Path(sys.argv[2])\nmanifest=empty_cumulative_manifest({'source':'fixture://foundry.lib','bytes':17,'sha256':'a'*64})\nmanifest=append_cumulative_shard(root,manifest,'0001',[d['first']])\n(root/'shards'/'0001'/'functions.json').write_text('tampered\\n')\nappend_cumulative_shard(root,manifest,'0002',[d['second']])`;
  const rejected = runPython(code, { first, second }, [root]);
  assert.notEqual(rejected.status, 0);
  assert.match(rejected.stderr, /shard 0001 artifact functions\.json hash mismatch/);
  await assert.rejects(readFile(path.join(root, 'shards/0002/manifest.json')));

  const manifestCode = `import json,sys\nfrom pathlib import Path\nsys.path.insert(0,sys.argv[1])\nfrom _generation_projection import empty_cumulative_manifest,append_cumulative_shard\nd=json.load(sys.stdin); root=Path(sys.argv[2])\nmanifest=empty_cumulative_manifest({'source':'fixture://foundry.lib','bytes':17,'sha256':'a'*64})\nmanifest=append_cumulative_shard(root,manifest,'0001',[d['first']])\npath=root/'shards'/'0001'/'manifest.json'; path.write_text(path.read_text()+' ')\nappend_cumulative_shard(root,manifest,'0002',[d['second']])`;
  const secondRoot = await mkdtemp(path.join(os.tmpdir(), 'lfr-library-manifest-tamper-'));
  t.after(() => rm(secondRoot, { recursive: true, force: true }));
  const manifestRejected = runPython(manifestCode, { first, second }, [secondRoot]);
  assert.notEqual(manifestRejected.status, 0);
  assert.match(manifestRejected.stderr, /shard 0001 manifest hash mismatch/);
});

test('LFR function identity keeps physical drive variants distinct and rejects duplicates in one delta', () => {
  const first = request('CAND_FIRST', 'sha256:function-a', 'D1');
  const stronger = request('CAND_STRONGER', 'sha256:function-a', 'D2');
  const duplicate = request('CAND_DUPLICATE', 'sha256:function-a', 'D1');
  const identityCode = `import json,sys\nsys.path.insert(0,sys.argv[1])\nfrom _generation_projection import function_identity\nd=json.load(sys.stdin); print(json.dumps([function_identity(x)['key'] for x in d]))`;
  const identities = runPython(identityCode, [first, stronger]);
  assert.equal(identities.status, 0, identities.stderr);
  const keys = JSON.parse(identities.stdout);
  assert.notEqual(keys[0], keys[1], 'drive is a variant of one function class but a distinct materialized asset');

  const duplicateCode = `import json,sys\nsys.path.insert(0,sys.argv[1])\nfrom _generation_projection import empty_cumulative_manifest,delta_generation_requests\nd=json.load(sys.stdin); m=empty_cumulative_manifest({'source':'fixture://f','bytes':1,'sha256':'b'*64}); delta_generation_requests({'generation_requests':d},m)`;
  const rejected = runPython(duplicateCode, [first, duplicate]);
  assert.notEqual(rejected.status, 0);
  assert.match(rejected.stderr, /repeat a function identity/);
});
