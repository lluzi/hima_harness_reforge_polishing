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
const candidateCell = 'XS_PORTFOLIO_ROUNDTRIP_A2_SINGLE_0001_Y';
const productionPortfolio = path.join(
  repoRoot,
  'packs/custom-cell-fmax-dtco/flow/domain/tests/fixtures/lfr-pre-mapping-portfolio.production.json',
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

function library(name: string, includeFast: boolean, fastDelay = 0.10): string {
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
  ${includeFast ? `cell (${candidateCell}) {
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
        ${timingTables(fastDelay)}
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
  const augmentedSlow = path.join(root, 'augmented-slow.lib');
  await writeFile(rtl, `module top(input clk,input seed,output observed);
  reg state;
  always @(posedge clk) state <= seed;
  assign observed = state;
endmodule
`);
  await writeFile(reference, library('reference', false));
  await writeFile(augmented, library('augmented', true));
  await writeFile(augmentedSlow, library('augmented_slow', true, 0.50));

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
augmented='augmented' in script
if augmented:
 netlist=('module top(input clk,input seed,output observed);\\n'
          '  DFF launch (.D(seed), .CK(clk), .Q(q0));\\n'
          '  ${candidateCell} logic0 (.A(q0), .Y(n0));\\n'
          '  DFF capture (.D(n0), .CK(clk), .Q(observed));\\n'
          'endmodule\\n')
 count=3
else:
 netlist=('module top(input clk,input seed,output observed);\\n'
          '  DFF launch (.D(seed), .CK(clk), .Q(q0));\\n'
          '  BUF logic0 (.A(q0), .Y(n0));\\n'
          '  BUF logic1 (.A(n0), .Y(n1));\\n'
          '  DFF capture (.D(n1), .CK(clk), .Q(observed));\\n'
          'endmodule\\n')
 count=4
mapped.write_text(netlist)
stat_text.write_text('Number of cells: '+str(count)+'\\n')
stat_json.write_text(json.dumps({'modules':{'top':{'num_cells':count}}},sort_keys=True)+'\\n')
`);
  const abc = await executable(path.join(root, 'fake-abc.py'), `#!/usr/bin/env python3
print('UC Berkeley ABC round fixture')
`);

  async function request(outputDir: string, useSlowAugmented = false) {
    const selectedAugmented = useSlowAugmented ? augmentedSlow : augmented;
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
        augmented: { mapping: selectedAugmented, support: [], drive_variants: { BUF: 'X1', [candidateCell]: 'X1' } },
      },
      constraints: {
        delay_target_ps: 150,
        driving_cell: 'BUF',
        output_load: 0.01,
        sdc_files: [],
      },
    };
    const portfolio = JSON.parse(await readFile(productionPortfolio, 'utf8'));
    const selected = portfolio.selected[0];
    return {
      schema: 'lfr-round/3',
      mapping,
      input_hashes: {
        [rtl]: await fileSha256(rtl),
        [reference]: await fileSha256(reference),
        [selectedAugmented]: await fileSha256(selectedAugmented),
      },
      candidate_cells: [candidateCell],
      candidate_functions: [{
        candidate_id: selected.candidate_id,
        candidate_cells: [candidateCell],
        identity: selected.identity,
        selected: true,
      }],
      local_portfolio: {
        path: productionPortfolio,
        sha256: await fileSha256(productionPortfolio),
      },
      timing: { clock_period_ps: 150, uncertainty_ps: 0 },
      scenarios: {
        optimistic: { initial_slew_ps: 8, wire_capacitance_in_library_units: 0 },
        nominal: { initial_slew_ps: 10, wire_capacitance_in_library_units: 0 },
        conservative: { initial_slew_ps: 20, wire_capacitance_in_library_units: 0.01 },
      },
      metric_policy: {
        objectives: [
          { metric: 'F0.candidate_adoption_fraction', direction: 'maximize' },
          { metric: 'F1.levels_removed', direction: 'maximize' },
          { metric: 'F2.mapped_instance_count', direction: 'minimize' },
          { metric: 'F2.buffer_inverter_pressure_ratio', direction: 'minimize' },
          { metric: 'F3.worst_delay_indicator_ps', direction: 'minimize' },
          { metric: 'F3.negative_slack_mass_indicator_ps', direction: 'minimize' },
        ],
        required_metrics: [
          'F0.candidate_adoption_fraction',
          'F0.known_cell_fraction',
          'F2.mapped_instance_count',
          'F2.max_logic_level',
          'F2.mean_fanout',
          'F2.mean_load_indicator',
          'F2.buffer_inverter_pressure_ratio',
          'F2.mean_path_stage_count',
          'F3.worst_delay_indicator_ps',
          'F3.negative_slack_mass_indicator_ps',
          'F3.path_family_coverage',
        ],
      },
      budgets: { max_candidate_cells: 50, max_augmented_mapped_instances: 10 },
      comparison_evidence: {
        identity: 'fixture-commercial-observation',
        sha256: '2'.repeat(64),
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
  assert.equal(accepted.result.evidence_class, 'license-free-evaluation-agent');
  assert.deepEqual(accepted.result.claim_limits, {
    fmax_claimed: false,
    commercial_adoption_claimed: false,
    physical_benefit_claimed: false,
    expected_qor_claimed: false,
    commercial_eda_executed: false,
  });
  assert.equal(accepted.result.mapping_adoption.candidate_instance_count, 1);
  assert.equal(accepted.result.scenarios.nominal.reference.F0.candidate_adoption_fraction, 0);
  assert.equal(accepted.result.scenarios.nominal.augmented.F0.candidate_adoption_fraction, 1);
  assert.equal(accepted.result.scenarios.nominal.reference.F1.levels_removed, 0);
  assert.equal(accepted.result.scenarios.nominal.augmented.F1.levels_removed, 1);
  assert.equal(accepted.result.scenarios.nominal.augmented.F1.nodes_removed, 1);
  assert.equal(accepted.result.scenarios.nominal.augmented.F1.edges_removed, 1);
  assert.equal(accepted.result.scenarios.nominal.augmented.F1.cut_width_max, 3);
  assert.equal(accepted.result.scenarios.nominal.augmented.F1.dominator_endpoint_coverage, 1);
  assert.equal(accepted.result.scenarios.nominal.augmented.F1.overlap_ratio, 0);
  assert.equal(accepted.result.scenarios.nominal.augmented.F1.new_library_cells, 1);
  assert.equal(accepted.result.scenarios.nominal.changes['F1.levels_removed'], 1);
  assert.equal(accepted.result.scenarios.nominal.reference.F2.mapped_instance_count, 4);
  assert.equal(accepted.result.scenarios.nominal.augmented.F2.mapped_instance_count, 3);
  assert.equal(accepted.result.scenarios.nominal.reference.F2.max_logic_level, 2);
  assert.equal(accepted.result.scenarios.nominal.reference.F2.mean_path_stage_count, 2);
  assert.equal(accepted.result.scenarios.nominal.reference.F3.worst_delay_indicator_ps, 400);
  assert.equal(accepted.result.scenarios.nominal.augmented.F3.worst_delay_indicator_ps, 100);
  assert.equal(accepted.result.scenarios.nominal.changes['F2.mapped_instance_count'], -1);
  assert.equal(accepted.result.scenarios.nominal.changes['F3.worst_delay_indicator_ps'], -300);
  assert.equal(accepted.result.scenarios.nominal.metric_completeness.complete, true);
  assert.equal(accepted.result.metric_completeness.complete, true);
  assert.equal(accepted.result.scenarios.nominal.pairwise_relation.relation, 'augmented-dominates');
  assert.equal(accepted.result.pairwise_relation.relation, 'augmented-dominates');
  assert.equal(accepted.result.e0_library_validation_candidate.value, false);
  assert.match(
    accepted.result.e0_library_validation_candidate.meaning,
    /candidate Library is eligible for one expensive commercial observation/,
  );
  assert.equal(accepted.result.e0_library_validation_candidate.unit_of_analysis,
    'candidate-library-round');
  assert.equal(accepted.result.e0_library_validation_candidate.validation_layer, 'E0');
  assert.equal(accepted.result.e0_library_validation_candidate.factor_assessment.factors.F1.status,
    'positive');
  assert.equal(accepted.result.e0_library_validation_candidate.factor_assessment.factors.F2.status,
    'positive');
  assert.equal(accepted.result.e0_library_validation_candidate.factor_assessment.factors.F3.status,
    'positive');
  assert.ok(
    accepted.result.e0_library_validation_candidate.blocking_reasons.includes(
      'portfolio-frontier-not-supplied',
    ),
  );
  assert.equal(accepted.result.budgets.within_budget, true);
  assert.equal(accepted.result.objective, undefined);
  assert.equal(accepted.result.exit_ready, undefined);
  assert.match(accepted.result.hashes.tools.yosys, /^[0-9a-f]{64}$/);
  assert.equal(accepted.result.hashes.local_portfolio.sha256, await fileSha256(productionPortfolio));
  assert.match(accepted.result.hashes.outputs.reference.mapped_netlist, /^[0-9a-f]{64}$/);
  assert.match(accepted.result.evaluation_payload_sha256, /^[0-9a-f]{64}$/);

  const unsupportedRequest: any = await held.request(path.join(held.root, 'unsupported-mapping'));
  unsupportedRequest.scenarios.optimistic.delay_scale = 0.8;
  const unsupported = await run(unsupportedRequest, held.root, 'unsupported');
  assert.equal(unsupported.completed.status, 0, unsupported.completed.stderr);
  assert.equal(unsupported.result.status, 'succeeded');
  assert.equal(unsupported.result.scenarios.optimistic.status, 'unsupported');
  assert.deepEqual(unsupported.result.scenarios.optimistic.unsupported_assumptions, ['delay_scale']);
  assert.equal(unsupported.result.pairwise_relation.relation, 'incomplete');
  assert.equal(unsupported.result.e0_library_validation_candidate.value, false);
  assert.ok(
    unsupported.result.e0_library_validation_candidate.blocking_reasons.includes(
      'required-metric-vectors-incomplete',
    ),
  );
});

test('LFR rejects a caller direction that reverses canonical metric meaning', async (t) => {
  const held = await fixture();
  t.after(() => rm(held.root, { recursive: true, force: true }));
  const request: any = await held.request(path.join(held.root, 'reversed-direction-mapping'));
  const timingObjective = request.metric_policy.objectives.find(
    (item: any) => item.metric === 'F3.worst_delay_indicator_ps',
  );
  timingObjective.direction = 'maximize';
  const reversed = await run(request, held.root, 'reversed-direction');
  assert.equal(reversed.completed.status, 2);
  assert.equal(reversed.result.status, 'failed');
  assert.equal(reversed.result.stage, 'request');
  assert.equal(reversed.result.error.code, 'invalid-request');
  assert.match(reversed.result.error.message, /system-owned canonical direction 'minimize'/);
});

test('LFR rejects missing, hash-mismatched, or identity-inconsistent local F1 evidence before mapping', async (t) => {
  const held = await fixture();
  t.after(() => rm(held.root, { recursive: true, force: true }));

  const missing: any = await held.request(path.join(held.root, 'missing-f1-mapping'));
  delete missing.local_portfolio;
  const missingResult = await run(missing, held.root, 'missing-f1');
  assert.equal(missingResult.completed.status, 2);
  assert.equal(missingResult.result.stage, 'request');
  assert.match(missingResult.result.error.message, /local_portfolio must be an object/);

  const wrongHash: any = await held.request(path.join(held.root, 'bad-f1-hash-mapping'));
  wrongHash.local_portfolio.sha256 = '0'.repeat(64);
  const hashResult = await run(wrongHash, held.root, 'bad-f1-hash');
  assert.equal(hashResult.completed.status, 2);
  assert.equal(hashResult.result.stage, 'request');
  assert.match(hashResult.result.error.message, /local_portfolio hash mismatch/);

  const wrongIdentity: any = await held.request(path.join(held.root, 'bad-f1-identity-mapping'));
  wrongIdentity.candidate_functions[0].identity.function_class = 'NPN:k2:0x0';
  const identityResult = await run(wrongIdentity, held.root, 'bad-f1-identity');
  assert.equal(identityResult.completed.status, 2);
  assert.equal(identityResult.result.stage, 'request');
  assert.match(identityResult.result.error.message, /function identity mismatch/);
});

test('LFR keeps F1 F2 F3 parallel and does not reject E0 unless all three are negative', async (t) => {
  const held = await fixture();
  t.after(() => rm(held.root, { recursive: true, force: true }));
  const regressed = await run(
    await held.request(path.join(held.root, 'f3-regression-mapping'), true),
    held.root,
    'f3-regression',
  );
  assert.equal(
    regressed.completed.status,
    0,
    `${regressed.completed.stderr}\n${JSON.stringify(regressed.result, null, 2)}`,
  );
  const nominal = regressed.result.scenarios.nominal;
  assert.equal(nominal.reference.F2.mapped_instance_count, 4);
  assert.equal(nominal.augmented.F2.mapped_instance_count, 3);
  assert.equal(nominal.reference.F3.worst_delay_indicator_ps, 400);
  assert.equal(nominal.augmented.F3.worst_delay_indicator_ps, 500);
  assert.equal(nominal.pairwise_relation.relation, 'tradeoff');
  assert.equal(regressed.result.e0_library_validation_candidate.value, false);
  assert.deepEqual(regressed.result.e0_library_validation_candidate.blocking_reasons,
    ['portfolio-frontier-not-supplied']);
  assert.equal(regressed.result.e0_library_validation_candidate.factor_assessment.factors.F1.status,
    'positive');
  assert.equal(regressed.result.e0_library_validation_candidate.factor_assessment.factors.F2.status,
    'positive');
  assert.equal(regressed.result.e0_library_validation_candidate.factor_assessment.factors.F3.status,
    'negative');
  assert.equal(regressed.result.e0_library_validation_candidate.factor_assessment
    .all_parallel_factors_explicitly_negative, false);
});
