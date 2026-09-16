import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { chmod, mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const repoRoot = path.resolve(import.meta.dirname, '../..');
const adapter = path.join(repoRoot, 'packs/custom-cell-fmax-dtco/flow/domain/proxy_mapping.py');

function sha256(value: Buffer | string): string {
  return createHash('sha256').update(value).digest('hex');
}

async function fileSha256(file: string): Promise<string> {
  return sha256(await readFile(file));
}

async function executable(file: string, source: string): Promise<string> {
  await writeFile(file, source);
  await chmod(file, 0o755);
  return file;
}

async function fixture(failMapping = false) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'lfr-proxy-mapping-'));
  const rtl = path.join(root, 'design.sv');
  const reference = path.join(root, 'reference.lib');
  const augmented = path.join(root, 'augmented.lib');
  const sdc = path.join(root, 'design.sdc');
  const marker = path.join(root, 'mapping-invoked');
  await writeFile(rtl, 'module top(input a, input b, output y); assign y = a & b; endmodule\n');
  await writeFile(reference, `library (reference) {
cell (NAND2_X1)
  area : 1.0;
  pin (A)
    direction : input;
  pin (B)
    direction : input;
  pin (Y)
    direction : output;
    function : "!(A*B)";
}
`);
  await writeFile(augmented, `library (augmented) {
cell (AOI21_X2)
  area : 1.5;
  pin (A)
    direction : input;
  pin (B)
    direction : input;
  pin (C)
    direction : input;
  pin (Y)
    direction : output;
    function : "!((A*B)+C)";
}
`);
  await writeFile(sdc, [
    'create_clock -period 1.0 [get_ports clk]',
    'set_load 0.02 [all_outputs]',
    'set_false_path -from [get_ports scan_en]',
  ].join('\n') + '\n');
  const yosys = await executable(path.join(root, 'fake-yosys.py'), `#!/usr/bin/env python3
import json,re,sys
from pathlib import Path
if '-V' in sys.argv:
 print('Yosys 0.test (git sha1 fake)')
 raise SystemExit(0)
script=Path(sys.argv[sys.argv.index('-s')+1]).read_text()
log=Path(sys.argv[sys.argv.index('-l')+1])
log.write_text('complete fake mapping log\\n')
Path(${JSON.stringify(marker)}).write_text('yes')
${failMapping ? "raise SystemExit(9)" : ""}
def target(prefix):
 match=re.search(prefix+r' \\{([^}]+)\\}',script,re.M)
 if not match: raise SystemExit('missing '+prefix)
 return Path(match.group(1))
mapped=target(r'write_verilog -noattr -noexpr -simple-lhs')
stat_text=target(r'tee -o')
stat_json_matches=re.findall(r'tee -o \\{([^}]+)\\} stat(?: -json)? -liberty',script)
stat_text=Path(stat_json_matches[0]); stat_json=Path(stat_json_matches[1])
augmented='augmented.lib' in script
cell='AOI21_X2' if augmented else 'NAND2_X1'
pins='.A(a), .B(b), .C(a), .Y(y)' if augmented else '.A(a), .B(b), .Y(y)'
mapped.write_text('module top(input a,input b,output y);\\n  '+cell+' U0 ('+pins+');\\nendmodule\\n')
stat_text.write_text('Number of cells: 1\\n')
stat_json.write_text(json.dumps({'modules': {'top': {'num_cells': 1}}},sort_keys=True)+'\\n')
`);
  const abc = await executable(path.join(root, 'fake-abc.py'), `#!/usr/bin/env python3
print('UC Berkeley ABC fake')
`);
  const request = async (outputDir: string) => ({
    schema: 'lfr-proxy-mapping/1',
    top: 'top',
    rtl_files: [rtl],
    output_dir: outputDir,
    tools: {
      container_digest: 'sha256:' + '1'.repeat(64),
      yosys: { path: yosys, sha256: await fileSha256(yosys), commit: 'fake-yosys-commit', build_flags: ['--fake'] },
      abc: { path: abc, sha256: await fileSha256(abc), commit: 'fake-abc-commit', build_flags: ['--fake'] },
    },
    libraries: {
      reference: { mapping: reference, support: [], drive_variants: { NAND2_X1: 'X1' } },
      augmented: { mapping: augmented, support: [], drive_variants: { AOI21_X2: 'X2' } },
    },
    constraints: {
      delay_target_ps: 950,
      driving_cell: 'NAND2_X1',
      output_load: 0.02,
      sdc_files: [sdc],
    },
  });
  return { root, marker, request, yosys };
}

async function run(request: object, root: string, name: string) {
  const requestPath = path.join(root, `${name}.request.json`);
  const resultPath = path.join(root, `${name}.result.json`);
  await writeFile(requestPath, JSON.stringify(request));
  const completed = spawnSync('/usr/bin/python3', [adapter, '--request', requestPath, '--output', resultPath], { encoding: 'utf8' });
  const result = JSON.parse(await readFile(resultPath, 'utf8'));
  return { completed, result };
}

test('LFR mapping adapter produces repeatable paired evidence with an audited invariant plan', async (t) => {
  const held = await fixture();
  t.after(() => rm(held.root, { recursive: true, force: true }));
  const first = await run(await held.request(path.join(held.root, 'run-1')), held.root, 'first');
  const second = await run(await held.request(path.join(held.root, 'run-2')), held.root, 'second');
  assert.equal(first.completed.status, 0, first.completed.stderr);
  assert.equal(second.completed.status, 0, second.completed.stderr);
  assert.equal(first.result.status, 'succeeded');
  assert.deepEqual(first.result.script_audit, {
    invariant_plan_sha256: first.result.arms.reference.plan_sha256,
    allowed_differences: ['library_set', 'output_paths'],
    constraint_drift: false,
    top_drift: false,
    rtl_drift: false,
    profile_drift: false,
  });
  assert.equal(first.result.arms.reference.plan_sha256, first.result.arms.augmented.plan_sha256);
  assert.equal(first.result.constraints.unsupported_constraints[0].command, 'set_false_path');
  assert.deepEqual(first.result.arms.reference.adoption.cell_census, { NAND2_X1: 1 });
  assert.deepEqual(first.result.arms.augmented.adoption.cell_census, { AOI21_X2: 1 });
  assert.deepEqual(first.result.arms.reference.adoption.cell_census, second.result.arms.reference.adoption.cell_census);
  assert.deepEqual(first.result.arms.augmented.adoption.cell_census, second.result.arms.augmented.adoption.cell_census);
  const artifactHash = (result: any, arm: string, role: string) => result.arms[arm].artifacts.find((item: any) => item.role === role).sha256;
  assert.equal(artifactHash(first.result, 'reference', 'mapped_netlist'), artifactHash(second.result, 'reference', 'mapped_netlist'));
  assert.equal(artifactHash(first.result, 'augmented', 'mapped_netlist'), artifactHash(second.result, 'augmented', 'mapped_netlist'));
  assert.equal(first.result.tool_identity.yosys.sha256, await fileSha256(held.yosys));
  assert.deepEqual(first.result.tool_identity.yosys.build_flags, ['--fake']);
  assert.match(first.result.tool_identity.yosys.version_probe.output, /Yosys 0\.test/);
});

test('LFR mapping adapter rejects a tool hash mismatch before execution', async (t) => {
  const held = await fixture();
  t.after(() => rm(held.root, { recursive: true, force: true }));
  const request: any = await held.request(path.join(held.root, 'bad-hash-run'));
  request.tools.yosys.sha256 = '0'.repeat(64);
  const { completed, result } = await run(request, held.root, 'bad-hash');
  assert.equal(completed.status, 2);
  assert.equal(result.status, 'failed');
  assert.equal(result.error.code, 'invalid-request');
  assert.match(result.error.message, /hash mismatch/);
  await assert.rejects(readFile(held.marker));
});

test('LFR mapping adapter preserves a reference tool failure and does not run an augmented arm', async (t) => {
  const held = await fixture(true);
  t.after(() => rm(held.root, { recursive: true, force: true }));
  const { completed, result } = await run(await held.request(path.join(held.root, 'failed-run')), held.root, 'failed');
  assert.equal(completed.status, 2);
  assert.equal(result.status, 'failed');
  assert.equal(result.failure_arm, 'reference');
  assert.equal(result.error.code, 'mapping-tool-failed');
  assert.equal(result.arms.reference.return_code, 9);
  assert.equal(result.arms.augmented, undefined);
  assert.equal(await readFile(held.marker, 'utf8'), 'yes');
});
