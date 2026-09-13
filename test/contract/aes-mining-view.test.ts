import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

test('the finite research view exposes all candidates beyond the chat cap without changing or overstating the source', async t => {
  const folder = await mkdtemp(path.join(os.tmpdir(), 'aes-mining-view-'));
  t.after(() => rm(folder, { recursive: true, force: true }));
  const source = path.join(folder, 'raw.json');
  const bytes = JSON.stringify({ algorithm_records: 'x'.repeat(300_000), strategy_id: 'timing_context',
    generation_requests: [
      { candidate_id: 'first', implementation_plan: { route: 'boolean_synthesis' }, discovery_evidence: { raw_support: 5, ppa_status: 'UNPROVEN' } },
      { candidate_id: 'last', implementation_plan: { route: 'cluster_compose' }, discovery_evidence: {} },
    ] });
  await writeFile(source, bytes);
  const root = path.resolve(import.meta.dirname, '../..');
  const program = `import sys,json\nsys.path.insert(0,sys.argv[1])\nfrom stages import mining_research_view\nprint(json.dumps(mining_research_view(sys.argv[2],'a'*64)))\n`;
  const result = spawnSync('/usr/bin/python3', ['-c', program, path.join(root, 'packs/aes-tsmc28-dtco/flow'), source], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  const view = JSON.parse(result.stdout);
  assert.ok(result.stdout.length < 8000, 'model sees every candidate without consuming the whole diagnostic report');
  assert.deepEqual(view.candidates.map((c: { candidate_id: string }) => c.candidate_id), ['first', 'last']);
  assert.equal(view.sourceSha256, createHash('sha256').update(bytes).digest('hex'));
  assert.equal(view.candidates[0].evidence.raw_support, 5);
  assert.equal(view.candidates[0].evidence.ppa_status, 'UNPROVEN');
  assert.equal(view.candidates[1].evidence.raw_support, null, 'missing evidence stays unknown');
  assert.equal(await readFile(source, 'utf8'), bytes);
});
