/** Synthetic external-tool boundary for PLS-25 contract tests.
 *
 * This fixture never represents AES PPA or real EDA. It creates a private workspace,
 * labels it `synthetic-fixture`, and runs the Pack's production Python entrypoints.
 */
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import type { SpawnSyncReturns } from 'node:child_process';
import { chmod, cp, mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

export const aesDomainPack = path.resolve(import.meta.dirname, '../../../packs/aes-tsmc28-dtco');
export const aesStages = path.join(aesDomainPack, 'flow/stages.py');
export const aesStageReader = path.join(aesDomainPack, 'tools/read-stage.py');

export type AesDomainFixture = {
  workspace: string;
  inputs: Record<string, unknown>;
  run(stage: string, route?: string): SpawnSyncReturns<string>;
  read(report: string, stage: string): { run: SpawnSyncReturns<string>; out: string };
  select(route: string, candidateIds: readonly string[]): Promise<void>;
  dispose(): Promise<void>;
};

export const sha256 = (data: string | Buffer): string => createHash('sha256').update(data).digest('hex');

export async function writeSyntheticStageRecord(workspace: string, stage: string,
  artifacts: readonly { role: string; path: string; sourceType?: string }[], facts: Record<string, unknown> = {}): Promise<string> {
  const rows = await Promise.all(artifacts.map(async (item) => {
    const data = await readFile(item.path);
    return { role: item.role, path: path.relative(workspace, item.path), sha256: sha256(data), bytes: data.length,
      sourceType: item.sourceType ?? 'synthetic-fixture-artifact' };
  }));
  const target = path.join(workspace, 'flow/records', `${stage}.json`);
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, JSON.stringify({ schema:'aes-dtco-stage/1', stage, status:'passed',
    evidenceClass:'synthetic-fixture', inputs:[], artifacts:rows, executions:[], facts, method:{ fixture:true },
    scope:'synthetic fixture only; no AES PPA or real EDA claim' }, null, 2) + '\n');
  return target;
}

const syntheticTool = String.raw`#!/usr/bin/env python3
import pathlib, re, sys

def value(flag):
    return sys.argv[sys.argv.index(flag) + 1]

mode = sys.argv[1]
args = sys.argv[2:]
if mode == 'bool2cmos':
    cell, out = value('--cell-name'), pathlib.Path(value('--out'))
    pins, output = value('--inputs').split(','), value('--output')
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text('.subckt %s %s %s vdd gnd\nMp0 %s %s vdd vdd pmos\nMn0 %s %s gnd gnd nmos\n.ends %s\n' %
                   (cell, ' '.join(pins), output, output, pins[0], output, pins[0], cell))
    raise SystemExit(0)
if mode == 'eda':
    tool, args = args[0], args[1:]
elif mode in ('lc_shell', 'dc_shell', 'innovus'):
    tool = mode
else:
    raise SystemExit(9)
script = pathlib.Path(args[args.index('-f') + 1] if '-f' in args else args[args.index('-files') + 1])
text = script.read_text()
if tool == 'lc_shell':
    out = pathlib.Path(re.search(r'write_lib -format db \S+ -output \{([^}]+)\}', text).group(1))
    out.parent.mkdir(parents=True, exist_ok=True); out.write_bytes(b'SYNTHETIC DB\n')
    print('=== AES_DTCO LC READ COMPLETE ===\n=== AES_DTCO LC CHECK COMPLETE ===\n=== AES_DTCO LC WRITE COMPLETE ===')
    if (script.parents[3] / 'synthetic-lc-error').exists():
        print('Error: synthetic fixture library rejected')
elif tool == 'dc_shell':
    arm = re.search(r'set ::env\(XS28_ARM\) "([^"]+)"', text).group(1)
    run = script.parent; (run / 'results').mkdir(exist_ok=True); (run / 'reports').mkdir(exist_ok=True)
    master = 'XS_FIX_ZN' if arm == 'custom' else 'NAND2_X1'
    (run / 'results' / (arm + '.dc.v')).write_text('module aes_cipher_top(input clk,a,b,output z);\n%s U0 (.A(a),.B(b),.Z(z));\nendmodule\n' % master)
    (run / 'results' / (arm + '.dc.sdc')).write_text('create_clock -name clk -period 0.5 [get_ports clk]\n')
    (run / 'reports' / ('refs_' + arm + '.rpt')).write_text('%s 1\n' % master)
    (run / 'reports' / ('timing_' + arm + '.rpt')).write_text('slack (MET) 0.010\n')
    fixture_flow = script.parents[3]
    dc_version = 'SYNTHETIC-DC-B' if arm == 'custom' and (fixture_flow / 'synthetic-dc-version-mismatch').exists() else 'SYNTHETIC-DC-A'
    print('Version %s for synthetic64 SYNTHETIC-FIXTURE' % dc_version)
    print('=== AES_DTCO LIBRARY_VISIBLE_COUNT %d ===' % (1 if arm == 'custom' else 0))
    print('=== AES_DTCO SYNTHESIS_COMPLETE %s ===' % arm)
elif tool == 'innovus':
    arm = 'generated' if 'generated' in script.name else 'foundry'
    fixture_flow = script.parents[3]
    innovus_version = 'vSYNTHETIC-B' if arm == 'generated' and (fixture_flow / 'synthetic-innovus-version-mismatch').exists() else 'vSYNTHETIC-A'
    print('Version:\t%s, built SYNTHETIC-FIXTURE' % innovus_version)
    if script.name.startswith('init_'):
        target = pathlib.Path(re.search(r'saveDesign\s+([^\s]+)', text).group(1) + '.dat')
        target.parent.mkdir(parents=True, exist_ok=True); target.write_bytes(b'SYNTHETIC INIT DB\n')
        print('=== XS28 GENERATED_LIB_CELLS_AFTER_RESTORE %d ===' % (1 if arm == 'generated' else 0))
    elif script.name.startswith('pnr_'):
        target = pathlib.Path(re.search(r'saveDesign\s+([^\s]+)', text).group(1) + '.dat')
        gds = pathlib.Path(re.search(r'^streamOut\s+([^\s]+)', text, re.M).group(1))
        report_dir, prefix = re.search(r'^timeDesign -postRoute -outDir\s+(\S+)/postopt -prefix\s+(\S+)', text, re.M).groups()
        summary = pathlib.Path(report_dir) / 'postopt' / (prefix + '.summary')
        target.parent.mkdir(parents=True, exist_ok=True); target.write_bytes(b'SYNTHETIC POSTROUTE DB\n')
        gds.parent.mkdir(parents=True, exist_ok=True); gds.write_bytes(b'SYNTHETIC GDS\n')
        summary.parent.mkdir(parents=True, exist_ok=True)
        wns = '0.020' if arm == 'generated' else '0.010'
        summary.write_text('SYNTHETIC FIXTURE -- timeDesign Summary\nSetup views included:\n view_%s\n| Setup mode | all | reg2reg | default |\n| WNS (ns): | %s | %s | 0.000 |\n| TNS (ns): | 0.000 | 0.000 | 0.000 |\n| Violating Paths: | 0 | 0 | 0 |\n| All Paths: | 1 | 1 | 0 |\n' % (arm, wns, wns))
        actual_sdc = pathlib.Path(re.search(r'^write_sdc\s+(\S+)', text, re.M).group(1))
        if not (fixture_flow / 'synthetic-missing-actual-clock').exists():
            period = '0.4' if (fixture_flow / 'synthetic-changed-actual-clock').exists() else '0.5'
            actual_sdc.parent.mkdir(parents=True, exist_ok=True)
            actual_sdc.write_text('create_clock -name clk -period %s [get_ports clk]\n' % period)
        print('=== XS28 PNR DONE %s (GDS written) ===' % arm)
    else:
        report = pathlib.Path(re.search(r'verify_drc -limit\s+(\d+) -report \{([^}]+)\}', text).group(2))
        limit = re.search(r'verify_drc -limit\s+(\d+)', text).group(1)
        report.write_text('# Generated by: SYNTHETIC FIXTURE\n# Command: verify_drc -limit %s -report %s\nNo DRC violations were found\n' % (limit, report))
        print('=== AES_DTCO VERIFY_LIBRARY_VISIBLE %d ===' % (1 if arm == 'generated' else 0))
        print('=== AES_DTCO VERIFY_COMPLETE %s ===' % arm)
else:
    raise SystemExit(8)
`;

export async function createAesDomainFixture(): Promise<AesDomainFixture> {
  const workspace = await mkdtemp(path.join(os.tmpdir(), 'aes-domain-fixture-'));
  const flow = path.join(workspace, 'flow');
  const site = path.join(workspace, 'synthetic-site');
  const helpers = path.join(site, 'helpers');
  await mkdir(flow, { recursive: true }); await mkdir(helpers, { recursive: true });
  await cp(path.join(aesDomainPack, 'flow/domain'), path.join(flow, 'domain'), { recursive: true });
  const files: Record<string, string> = {
    'rtl/aes.v': 'module aes_cipher_top(input clk,a,b,output z); NAND2_X1 U0(.A(a),.B(b),.ZN(n)); INV_X1 U1(.A(n),.ZN(z)); NAND2_X1 U2(.A(a),.B(b),.ZN(n2)); INV_X1 U3(.A(n2),.ZN()); endmodule\n',
    'foundry.db': 'SYNTHETIC FOUNDRY DB\n',
    'foundry.lib': 'library (fixture) { cell (NAND2_X1) { pin(A){direction:input;} pin(B){direction:input;} pin(ZN){direction:output; function:"!(A*B)";} } cell (INV_X1) { pin(A){direction:input;} pin(ZN){direction:output; function:"!A";} } }\n',
    'skeleton.lib': 'cell(NAND2_X1){ pin(A){direction:input;} pin(B){direction:input;} pin(ZN){direction:output; function:"!(A*B)";} } cell(INV_X1){ pin(A){direction:input;} pin(ZN){direction:output; function:"!A";} }\n',
    'foundry.lef': 'VERSION 5.7 ;\nEND LIBRARY\n', 'tech.lef': 'VERSION 5.7 ;\nSITE core ;\nEND core\n',
    'qrc': 'SYNTHETIC QRC\n', 'foundry.gds': 'SYNTHETIC GDS\n', 'map': 'SYNTHETIC MAP\n',
    'tech.py': '# synthetic fixture\n', 'pdk.json': '{}\n',
    'geometry.json': JSON.stringify({ site_name:'CORE', site_width_nm:100, row_height_nm:1000,
      m1_pitch_nm:100, m2_pitch_nm:100, m2_offset_nm:50, m1_min_width_nm:40, m2_min_width_nm:40,
      m1_min_spacing_nm:30, m1_wide_metal_spacing_nm:30, m1_min_area_nm2:1000,
      m2_min_area_nm2:1000, rail_width_nm:100, neighbour_obs_standoff_nm:20, m1_m2_via_name:'VIA1',
      eol:{M1:{space_nm:30,width_nm:70,within_nm:30},M2:{space_nm:30,width_nm:70,within_nm:30}} }) + '\n',
    'timing-model.json': '{}\n', 'power-model.json': '{}\n', 'area-model.json': '{"slope":1,"intercept":1}\n',
  };
  for (const [name, body] of Object.entries(files)) {
    const target = path.join(site, name); await mkdir(path.dirname(target), { recursive: true }); await writeFile(target, body);
  }
  const tool = path.join(site, 'synthetic-tool.py'); await writeFile(tool, syntheticTool); await chmod(tool, 0o755);
  await writeFile(path.join(helpers, 'mock_char.py'), String.raw`class Device:
    def __init__(self, row):
        fields = row.split()
        self.d, self.g, self.s, self.b = fields[1:5]
        self.kind = 'p' if 'pmos' in fields[5].lower() else 'n'
        self.w = 1.0
        self.l = 1.0
def _majority(values):
    rows = list(values)
    return max(set(rows), key=rows.count) if rows else None
def parse_netlist(path):
    rows = open(path).read().splitlines()
    head = next(row for row in rows if row.lower().startswith('.subckt ')).split()
    devices = [Device(row) for row in rows if row[:1].lower() == 'm']
    return head[1], head[2:], devices
`);
  await writeFile(path.join(helpers, 'estimate_lib.py'), 'BANNER = "\\n/* %s */\\n"\n');
  const legacy = {
    MAX_CELLS: 2, MAX_ROUTE_CANDIDATES: 2, PROCESS_FAMILY: 'SYNTHETIC',
    CELL_ARCHITECTURE_REF: 'fixture://cell-architecture', CHARACTERIZATION_PROFILE_REF: 'fixture://characterization',
    DRIVE_STRENGTH: 'fixture', VT_CLASS: 'fixture', LIBERTY_SKELETON: path.join(site, 'skeleton.lib'),
    FOUNDRY_LIB: path.join(site, 'foundry.lib'), BOOL2CMOS_CMD: `/usr/bin/python3 ${tool} bool2cmos`,
    BOOL2CMOS_CWD: site, BOOL2CMOS_PDK_PROFILE: path.join(site, 'pdk.json'), GENERATION_TIMEOUT_SEC: 30,
    LIBRECELL_TECH_PY: path.join(site, 'tech.py'), GEOMETRY_RULE_DECK: path.join(site, 'geometry.json'),
    XS28_CHARMODEL_HELPER_DIR: helpers, XS28_CONTAINER_RUNTIME: tool, XS28_CONTAINER_IMAGE: 'synthetic-image',
    XS28_CONTAINER_HOST_ROOT: workspace, XS28_CONTAINER_MOUNT_POINT: workspace, XS28_LCLAYOUT_ACTIVATE: '/synthetic/activate',
    XS28_POWER_PIN: 'vdd', XS28_GROUND_PIN: 'gnd', ABSTRACT_TIMEOUT_SEC: 30,
    CHARMODEL_TIMING_MODEL: path.join(site, 'timing-model.json'), CHARMODEL_POWER_MODEL: path.join(site, 'power-model.json'),
    CHARMODEL_AREA_MODEL: path.join(site, 'area-model.json'), XS28_POWER_TEMPLATE_BASE_CELL: 'FIXTURE_CELL',
    GENERATED_LIBRARY_NAME: 'synthetic_generated', CHARACTERIZE_TIMEOUT_SEC: 30, LC_TIMEOUT_SEC: 30,
    CLOCK_NS: 0.5, SYNTH_TIMEOUT_SEC: 30, GENERATED_LIB_CELL_PATTERN: 'XS_*',
    TECH_LEF: path.join(site, 'tech.lef'), FOUNDRY_LEF: path.join(site, 'foundry.lef'),
    FOUNDRY_QRC_TECH: path.join(site, 'qrc'), FOUNDRY_GDS: path.join(site, 'foundry.gds'), XS28_GDS_MAP: path.join(site, 'map'),
    XS28_RC_TEMPERATURE: 25, XS28_PROCESS_NODE: 28, XS28_MAX_ROUTE_LAYER: 'M8', MULTI_CPU: 1,
    XS28_TAP_CELL: 'FIXTURE_TAP', XS28_TAP_INTERVAL: 10, XS28_FILLER_CELLS: 'FIXTURE_FILL',
    XS28_SWITCHING_ACTIVITY: 0.2, PNR_TIMEOUT_SEC: 30, DRC_LIMIT: 1000000, VERIFY_TIMEOUT_SEC: 30,
  };
  const inputs = { evidenceClass: 'synthetic-fixture', design: 'aes_cipher_top',
    rtlGlob: path.join(site, 'rtl/*.v'), foundryDb: path.join(site, 'foundry.db'),
    edaWrapper: `${tool}`, legacy };
  await writeFile(path.join(flow, 'inputs.json'), JSON.stringify(inputs, null, 2) + '\n');
  return {
    workspace, inputs,
    run(stage, route) { return spawnSync('/usr/bin/python3', [aesStages, stage, workspace, ...(route ? [route] : [])], { encoding: 'utf8' }); },
    read(report, stage) { const out = path.join(workspace, `read-${stage}.json`); return { run: spawnSync('/usr/bin/python3', [aesStageReader, report, out, stage], { encoding: 'utf8' }), out }; },
    async select(route, candidateIds) {
      const folder = path.join(flow, 'mining', route); const raw = await readFile(path.join(folder, 'raw.json'));
      const mine = JSON.parse(await readFile(path.join(flow, 'records', `mine-${route}.json`), 'utf8'));
      await writeFile(path.join(folder, 'selected.json'), JSON.stringify({ sourceSha256: sha256(raw), selected: [...candidateIds], codeSha256: mine.facts.codeSha256 }, null, 2) + '\n');
    },
    dispose() { return rm(workspace, { recursive: true, force: true }); },
  };
}
