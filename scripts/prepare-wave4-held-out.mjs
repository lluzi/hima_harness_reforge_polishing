// Stage one fresh, SHA-bound Wave 4 held-out Site profile without starting Hima, a model,
// or an EDA tool. The remote input directory is retained for the single Campaign and is
// never removed by this helper.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const destination = 'luzi@192.168.50.41';
const sshOptions = ['-o', 'BatchMode=yes', '-o', 'ConnectTimeout=10', '-o', 'ControlPath=none'];
const designRoot = '/data/eda/project/ibex_core/designs/src/ibex';
const rtlGlob = `${designRoot}/*.v`;
const designTop = 'ibex_core';
const basePhysical = '/data/eda/project/hima_harness/issue52-dc-qualification-20260924/physical-inputs.json';
const toolStack = '/data/eda/project/hima_harness/site_inputs/xspace_cell_aes_tsmc28/tool-stack.json';
const foundryLibrary = '/data/eda/project/techlib/tsmc28/logic/tcbn28hpcplusbwp40p140_180b/AN61001_20180509/TSMCHOME/digital/Front_End/timing_power_noise/NLDM/tcbn28hpcplusbwp40p140_180a/tcbn28hpcplusbwp40p140tt0p9v25c.lib';

const args = process.argv.slice(2);
const outAt = args.indexOf('--out');
if (outAt < 0 || !args[outAt + 1] || args.length !== 2) {
  throw new Error('usage: node scripts/prepare-wave4-held-out.mjs --out <fresh-private-profile.json>');
}
const out = path.resolve(args[outAt + 1]);
if (existsSync(out)) throw new Error(`refusing to overwrite ${out}`);

const remote = (command, timeout = 60_000) => execFileSync('ssh', [...sshOptions, destination, command], {
  encoding: 'utf8', timeout, maxBuffer: 16 * 1024 * 1024,
});
const upload = (target, content) => {
  const result = spawnSync('ssh', [...sshOptions, destination, 'tee', '--', target], {
    input: content, encoding: 'utf8', timeout: 60_000, maxBuffer: 1024 * 1024,
  });
  if (result.status !== 0) throw new Error(`remote write failed for ${target}: ${result.stderr || result.stdout}`);
};
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const canonical = value => JSON.stringify(value, (_key, item) => item && typeof item === 'object' && !Array.isArray(item)
  ? Object.fromEntries(Object.entries(item).sort(([left], [right]) => left.localeCompare(right))) : item);

const priorUseProbe = spawnSync('rg', ['-l', '-w', designTop,
  path.join(repoRoot, 'packs/custom-cell-fmax-dtco'),
  path.join(repoRoot, 'docs/assessment/2026-09-25/next-stage'),
  path.join(repoRoot, 'scripts/live-check-dtco-pilot.ts'),
  path.join(repoRoot, 'scripts/audit-completed-dtco-pilot.ts')], { encoding: 'utf8' });
if (![0, 1].includes(priorUseProbe.status ?? -1)) throw new Error(priorUseProbe.stderr || 'held-out history search failed');
const priorUse = priorUseProbe.stdout.trim().split('\n').filter(Boolean);
assert.deepEqual(priorUse, [], 'held-out top already appears in the sealed method or its current acceptance evidence');

const inventory = remote(`sha256sum -- ${rtlGlob}`).trim().split('\n').filter(Boolean).map(line => {
  const match = line.match(/^([0-9a-f]{64})\s+(.+)$/);
  assert.ok(match, `invalid remote sha256sum row: ${line}`);
  return { path: match[2], sha256: match[1] };
}).sort((left, right) => left.path.localeCompare(right.path));
assert.equal(inventory.length, 37, 'the reviewed ibex held-out inventory changed');
assert.ok(inventory.some(item => item.path.endsWith('/ibex_core.v')), 'held-out top source is absent');
const inventorySha256 = sha256(canonical(inventory));

const environmentBefore = remote("/usr/local/bin/empyrean-license status; ps -eo pid,args | grep -E '(icexplorer-xtop_exe|qualib_exe|dc_shell|lc_shell|innovus|pt_shell|StarXtract)' | grep -v grep | grep -v '<defunct>' || true").trim();
assert.match(environmentBefore, /selected=new old=inactive new=active/);
assert.doesNotMatch(environmentBefore, /icexplorer-xtop_exe|qualib_exe|dc_shell|lc_shell|innovus|pt_shell|StarXtract/);

const stamp = new Date().toISOString().replaceAll(/[-:.TZ]/g, '').slice(0, 14);
const remoteRoot = `/data/eda/project/hima_harness/wave4-heldout-${stamp}`;
remote(`test ! -e '${remoteRoot}' && mkdir -- '${remoteRoot}'`);
const constraints = `${remoteRoot}/constraints.tcl`;
const physicalInputs = `${remoteRoot}/physical-inputs.json`;
upload(constraints, `current_design ibex_core
set clk_period $CLK_NS
create_clock -name core_clock -period $clk_period [get_ports clk_i]
set_clock_latency [expr {$clk_period * 0.1}] [get_clocks core_clock]
set non_clock_inputs [remove_from_collection [all_inputs] [get_ports clk_i]]
set_input_delay [expr {$clk_period * 0.1}] -clock core_clock $non_clock_inputs
set_output_delay [expr {$clk_period * 0.1}] -clock core_clock [all_outputs]
set_input_transition 0.05 $non_clock_inputs
set_load 0.03 [all_outputs]
set_false_path -from [get_ports rst_ni]
set_max_area 0
`);
const physical = JSON.parse(remote(`cat '${basePhysical}'`));
physical.CLOCK_NAME = 'core_clock';
physical.CLOCK_NS = 0.5;
physical.GENERATED_LIBRARY_NAME = 'IBEX_WAVE4_GENERATED';
upload(physicalInputs, `${JSON.stringify(physical, null, 2)}\n`);

const stagedHashes = remote(`sha256sum -- '${constraints}' '${physicalInputs}' '${toolStack}' '${foundryLibrary}'`).trim().split('\n');
const profile = {
  schema: 1,
  site: {
    name: `wave4-heldout-${stamp}`,
    ssh: { destination, jumps: [], controlPersistSeconds: 60 },
    workspaceRoot: remoteRoot,
    allowedReadRoots: ['/data/eda/project', '/data/eda/software', '/data/eda/env', '/usr/local/bin', '/usr/bin'],
    allowedWriteRoots: [remoteRoot],
    allowedWrappers: ['/usr/bin/python3', '/usr/local/bin/eda'],
    toolCommands: ['python3', 'eda'],
    bindings: { designRoot, rtlGlob, designTop, constraints, foundryLibrary, physicalInputs, toolStack, workspaceRoot: remoteRoot },
    capacity: { cores: 8, memoryGiB: 16, parallelJobs: 5,
      licences: { 'Design-Compiler': 1, 'Library-Compiler': 1, Innovus: 1 } },
  },
  heldOut: {
    designTop,
    source: 'lowRISC Ibex commercial-project RTL already present on the approved Site; not used by custom-cell-fmax-dtco authoring, TEST, or earlier L5 evidence',
    selectionReason: 'single-clock medium-size design with an existing commercial synthesis structure; selected before reading any custom-cell result',
    sourceInventory: inventory,
    sourceInventorySha256: inventorySha256,
  },
  staging: { remoteRoot, environmentBefore, stagedHashes },
};
mkdirSync(path.dirname(out), { recursive: true, mode: 0o700 });
writeFileSync(out, `${JSON.stringify(profile, null, 2)}\n`, { mode: 0o600, flag: 'wx' });
process.stdout.write(`${JSON.stringify({ status: 'staged', profile: out, site: profile.site.name,
  remoteRoot, sourceFiles: inventory.length, sourceInventorySha256: inventorySha256, stagedHashes }, null, 2)}\n`);
