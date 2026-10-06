import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { chmod, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { checkPack, loadPack, loadSite } from '@hima/harness';
import { localHome } from './support/fabric.ts';
import { packsDirOf, writePackVariant } from './support/pack.ts';


// The production wrapper independently refuses the unsandboxed fixture unless this exact test-only
// switch is present. This test file runs in its own Node process, so keep it stable across concurrent
// top-level cases instead of racing per-test save/restore operations.
process.env.HIMA_RESIDENT_TESTING = '1';

const declaration = `    outsourcing:
      role: resident-engineering-agent
      reads: [qorReport]
      knowledge: [push-method.md]
      artifactPrefix: engineering
      produces: qorReport
`;

test('a normal tool may declare one generic resident engineering delivery contract', async (t) => {
  const home = await localHome(t, { sleepSeconds: 0 });
  assert.ok(home);
  try {
    const id = 'resident-engineering-schema';
    await writePackVariant(packsDirOf(home.h), id, [
      ['tools:\n', `knowledge:\n  - file: push-method.md\n    purpose: Engineering playbook.\n\ntools:\n`],
      ['    inputs: [WORKSPACE, FLOW_ROOT, DESIGN, PERIOD_NS, CAMPAIGN]\n',
        `${declaration}    inputs: [WORKSPACE, FLOW_ROOT, DESIGN, PERIOD_NS, CAMPAIGN]\n`],
    ], [], undefined, { 'knowledge/push-method.md': '# Push method\n' });
    const pack = loadPack(packsDirOf(home.h), id);
    assert.deepEqual(pack.contract.tools[0]?.outsourcing, {
      role: 'resident-engineering-agent', reads: ['qorReport'], knowledge: ['push-method.md'],
      artifactPrefix: 'engineering', produces: 'qorReport',
    });
    const missing = checkPack(pack, loadSite(path.join(home.h.home, 'hima/sites'), 'local'));
    assert.equal(missing.fit, false);
    assert.ok(missing.errors.some((error) => /engineeringCapabilities/.test(error)), JSON.stringify(missing.errors));
    const historical = 'resident-engineering-historical-schema';
    await writePackVariant(packsDirOf(home.h), historical, [
      ['tools:\n', `knowledge:\n  - file: push-method.md\n    purpose: Engineering playbook.\n\ntools:\n`],
      ['    inputs: [WORKSPACE, FLOW_ROOT, DESIGN, PERIOD_NS, CAMPAIGN]\n',
        `${declaration.replace('      artifactPrefix: engineering\n', '')}    inputs: [WORKSPACE, FLOW_ROOT, DESIGN, PERIOD_NS, CAMPAIGN]\n`],
    ], [], undefined, { 'knowledge/push-method.md': '# Push method\n' });
    assert.equal(loadPack(packsDirOf(home.h), historical).contract.tools[0]?.outsourcing?.artifactPrefix, undefined,
      'preserved pre-artifactPrefix methods remain readable under the current schema');
  } finally {
    await home.h.dispose();
  }
});

test('outsourcing rejects unknown materials, unreadable delivery, and a second interactive protocol', async (t) => {
  const home = await localHome(t, { sleepSeconds: 0 });
  assert.ok(home);
  try {
    const variants = [
      ['resident-unknown-read', declaration.replace('reads: [qorReport]', 'reads: [missingReport]'), /unknown output.*missingReport/i],
      ['resident-unknown-knowledge', declaration.replace('knowledge: [push-method.md]', 'knowledge: [missing.md]'), /knowledge.*missing\.md/i],
      ['resident-unreadable-delivery', declaration.replace('produces: qorReport', 'produces: synthesisLog'), /produces.*reader/i],
      ['resident-interactive-conflict', `${declaration}    interactive:\n      mode: hybrid\n      adapter: hima-tcl-line-v1\n      commands: { read: [report], mutate: [], save: [], close: [] }\n`, /outsourcing.*interactive|interactive.*outsourcing/i],
    ] as const;
    for (const [id, outsourcing, expected] of variants) {
      await writePackVariant(packsDirOf(home.h), id, [
        ['tools:\n', `knowledge:\n  - file: push-method.md\n    purpose: Engineering playbook.\n\ntools:\n`],
        ['    inputs: [WORKSPACE, FLOW_ROOT, DESIGN, PERIOD_NS, CAMPAIGN]\n',
          `${outsourcing}    inputs: [WORKSPACE, FLOW_ROOT, DESIGN, PERIOD_NS, CAMPAIGN]\n`],
      ], [], undefined, { 'knowledge/push-method.md': '# Push method\n' });
      assert.throws(() => loadPack(packsDirOf(home.h), id), expected, id);
    }
  } finally {
    await home.h.dispose();
  }
});

test('checkpoint inventory caps transport output before retaining an unbounded listing', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'hima-inventory-output-'));
  const prior = process.env.PATH;
  try {
    const fakeFind = path.join(dir, 'find');
    await writeFile(fakeFind, '#!/usr/bin/env python3\nimport os\nos.write(1, b"x" * (4 * 1024 * 1024 + 4096))\n');
    await chmod(fakeFind, 0o755);
    process.env.PATH = `${dir}:${prior ?? ''}`;
    const { LocalChannel } = await import('@hima/harness');
    await assert.rejects(new LocalChannel('inventory-fixture').exec(['find', dir, '-maxdepth', '33', '-mindepth', '1', '-print0']), /byte output limit/);
  } finally {
    if (prior === undefined) delete process.env.PATH; else process.env.PATH = prior;
    await rm(dir, { recursive: true, force: true });
  }
});

