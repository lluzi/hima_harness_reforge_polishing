import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { chmod, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const repoRoot = path.resolve(import.meta.dirname, '../..');
const entrypoint = path.join(
  repoRoot, 'packs/custom-cell-fmax-dtco/flow/library_richness.py',
);

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

function timingTables(delay: number): string {
  const delays = `${delay}, ${delay}`;
  return `
    cell_rise (delay_template) { values ("${delays}", "${delays}"); }
    cell_fall (delay_template) { values ("${delays}", "${delays}"); }
    rise_transition (delay_template) { values ("0.01, 0.01", "0.01, 0.01"); }
    fall_transition (delay_template) { values ("0.01, 0.01", "0.01, 0.01"); }
  `;
}

function library(name: string, includeFast: boolean): string {
  return `library (${name}) {
  time_unit : "1ns";
  capacitive_load_unit (1, pf);
  lu_table_template (delay_template) {
    variable_1 : input_net_transition;
    variable_2 : total_output_net_capacitance;
    index_1 ("0.01, 0.10");
    index_2 ("0.01, 0.10");
  }
  cell (DFF) {
    ff (IQ, IQN) {
      next_state : "D";
      clocked_on : "CK";
    }
    pin (D) {
      direction : input;
      capacitance : 0.01;
    }
    pin (CK) {
      direction : input;
      capacitance : 0.01;
    }
    pin (Q) {
      direction : output;
      function : "IQ";
    }
  }
  cell (BUF) {
    pin (A) {
      direction : input;
      capacitance : 0.01;
    }
    pin (Y) {
      direction : output;
      function : "A";
      timing () {
        related_pin : "A";
        timing_sense : positive_unate;
        ${timingTables(0.20)}
      }
    }
  }
  ${includeFast ? `cell (FAST) {
    pin (A) {
      direction : input;
      capacitance : 0.01;
    }
    pin (Y) {
      direction : output;
      function : "A";
      timing () {
        related_pin : "A";
        timing_sense : positive_unate;
        ${timingTables(0.10)}
      }
    }
  }` : ''}
}
`;
}

async function fixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), 'lfr-round-interface-'));
  const rtl = path.join(root, 'design.sv');
  const reference = path.join(root, 'reference.lib');
  const augmented = path.join(root, 'augmented.lib');
  await writeFile(rtl, `module top(input clk,input seed,output observed);
  reg state;
  always @(posedge clk) state <= seed;
  assign observed = state;
endmodule
`);
  await writeFile(reference, library('reference', false));
  await writeFile(augmented, library('augmented', true));

  const yosys = await executable(path.join(root, 'fake-yosys.py'), `#!/usr/bin/env python3
import json,re,sys
from pathlib import Path
if '-V' in sys.argv:
 print('Yosys 0.test (git sha1 round-fixture)')
 raise SystemExit(0)
script=Path(sys.argv[sys.argv.index('-s')+1]).read_text()
log=Path(sys.argv[sys.argv.index('-l')+1])
log.write_text('complete fake paired mapping\\n')
def targets(pattern):
 return re.findall(pattern+r' "([^"]+)"',script,re.M)
mapped=Path(targets(r'write_verilog -noattr -noexpr -simple-lhs')[0])
stats=targets(r'tee -o')
stat_text=Path(stats[0]); stat_json=Path(stats[1])
augmented='augmented.lib' in script
logic='FAST' if augmented else 'BUF'
mapped.write_text('module top(input clk,input seed,output observed);\\n'
                  '  DFF launch (.D(seed), .CK(clk), .Q(q0));\\n'
                  '  '+logic+' logic0 (.A(q0), .Y(n0));\\n'
                  '  DFF capture (.D(n0), .CK(clk), .Q(observed));\\n'
                  'endmodule\\n')
stat_text.write_text('Number of cells: 3\\n')
stat_json.write_text(json.dumps({'modules':{'top':{'num_cells':3}}},sort_keys=True)+'\\n')
`);
  const abc = await executable(path.join(root, 'fake-abc.py'), `#!/usr/bin/env python3
print('UC Berkeley ABC round fixture')
`);

  async function request(outputDir: string) {
    const mapping = {
      schema: 'lfr-proxy-mapping/1',
      top: 'top',
      rtl_files: [rtl],
      output_dir: outputDir,
      tools: {
        container_digest: `sha256:${'1'.repeat(64)}`,
        timeout_seconds: 10,
        yosys: { path: yosys, sha256: await fileSha256(yosys), commit: 'fixture', build_flags: ['--fixture'] },
        abc: { path: abc, sha256: await fileSha256(abc), commit: 'fixture', build_flags: ['--fixture'] },
      },
      libraries: {
        reference: { mapping: reference, support: [], drive_variants: { BUF: 'X1' } },
        augmented: { mapping: augmented, support: [], drive_variants: { BUF: 'X1', FAST: 'X1' } },
      },
      constraints: {
        delay_target_ps: 150,
        driving_cell: 'BUF',
        output_load: 0.01,
        sdc_files: [],
      },
    };
    return {
      schema: 'lfr-round/1',
      mapping,
      input_hashes: {
        [rtl]: await fileSha256(rtl),
        [reference]: await fileSha256(reference),
        [augmented]: await fileSha256(augmented),
      },
      candidate_cells: ['FAST'],
      timing: { clock_period_ps: 150, uncertainty_ps: 0 },
      scenarios: {
        optimistic: { initial_slew_ps: 8, wire_capacitance_in_library_units: 0 },
        nominal: { initial_slew_ps: 10, wire_capacitance_in_library_units: 0 },
        conservative: { initial_slew_ps: 20, wire_capacitance_in_library_units: 0.01 },
      },
      objective: { target_delta_ps: 50 },
      calibration: {
        status: 'valid',
        error_band_ps: 10,
        scope: 'fixture-only; no physical calibration claim',
        evidence_sha256: '2'.repeat(64),
      },
    };
  }
  return { root, request };
}

async function run(request: object, root: string, name: string) {
  const requestPath = path.join(root, `${name}.request.json`);
  const outputPath = path.join(root, `${name}.evaluation.json`);
  await writeFile(requestPath, JSON.stringify(request));
  const completed = spawnSync('/usr/bin/python3', [
    entrypoint, '--request', requestPath, '--output', outputPath,
  ], { encoding: 'utf8' });
  const result = JSON.parse(await readFile(outputPath, 'utf8'));
  return { completed, result };
}

test('LFR round interface binds evidence, evaluates paired reg2reg timing, and fails unsupported robustness closed', async (t) => {
  const held = await fixture();
  t.after(() => rm(held.root, { recursive: true, force: true }));

  const accepted = await run(
    await held.request(path.join(held.root, 'accepted-mapping')),
    held.root,
    'accepted',
  );
  assert.equal(
    accepted.completed.status,
    0,
    `${accepted.completed.stderr}\n${JSON.stringify(accepted.result, null, 2)}`,
  );
  assert.equal(accepted.result.status, 'succeeded');
  assert.equal(accepted.result.evidence_class, 'license-free-proxy-screening');
  assert.deepEqual(accepted.result.claim_limits, {
    fmax_claimed: false,
    commercial_adoption_claimed: false,
    physical_benefit_claimed: false,
    commercial_eda_executed: false,
  });
  assert.equal(accepted.result.mapping_adoption.candidate_instance_count, 1);
  assert.equal(accepted.result.scenarios.nominal.reference.worst_delay_ps, 200);
  assert.equal(accepted.result.scenarios.nominal.augmented.worst_delay_ps, 100);
  assert.equal(accepted.result.scenarios.nominal.predicted_delta_ps, 100);
  assert.ok(Math.abs(accepted.result.scenarios.nominal.reference.worst_slack_ps + 50) < 1e-9);
  assert.ok(Math.abs(accepted.result.scenarios.nominal.augmented.worst_slack_ps - 50) < 1e-9);
  assert.equal(accepted.result.objective.margin_ps, 40);
  assert.equal(accepted.result.exit_ready, true);
  assert.deepEqual(accepted.result.residual_reasons, []);
  assert.match(accepted.result.hashes.tools.yosys, /^[0-9a-f]{64}$/);
  assert.match(accepted.result.hashes.outputs.reference.mapped_netlist, /^[0-9a-f]{64}$/);
  assert.match(accepted.result.evaluation_payload_sha256, /^[0-9a-f]{64}$/);

  const unsupportedRequest: any = await held.request(path.join(held.root, 'unsupported-mapping'));
  unsupportedRequest.scenarios.optimistic.delay_scale = 0.8;
  const unsupported = await run(unsupportedRequest, held.root, 'unsupported');
  assert.equal(unsupported.completed.status, 0, unsupported.completed.stderr);
  assert.equal(unsupported.result.status, 'succeeded');
  assert.equal(unsupported.result.scenarios.optimistic.status, 'unsupported');
  assert.deepEqual(unsupported.result.scenarios.optimistic.unsupported_assumptions, ['delay_scale']);
  assert.equal(unsupported.result.exit_ready, false);
  assert.equal(
    unsupported.result.residual_reasons[0].code,
    'scenario-unsupported:optimistic',
  );
});
