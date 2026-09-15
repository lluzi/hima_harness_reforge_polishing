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
export const customCellFmaxPack = path.resolve(import.meta.dirname, '../../../packs/custom-cell-fmax-dtco');
export const customCellFmaxStages = path.join(customCellFmaxPack, 'flow/stages.py');
export const customCellFmaxStageReader = path.join(customCellFmaxPack, 'flow/read-stage.py');

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
import gzip, pathlib, re, sys

def value(flag):
    return sys.argv[sys.argv.index(flag) + 1]

def save_checkpoint(base, label, links):
    base.parent.mkdir(parents=True, exist_ok=True)
    base.write_text('SYNTHETIC FIXTURE RESTORE %s\n' % label)
    data = pathlib.Path(str(base) + '.dat')
    data.mkdir(parents=True, exist_ok=True)
    (data / 'mmmc').mkdir(exist_ok=True)
    (data / 'design.bin').write_bytes(('SYNTHETIC %s DATA\n' % label).encode())
    (data / 'mmmc' / 'view.tcl').write_text('SYNTHETIC %s VIEW\n' % label)
    (data / 'empty.state').write_bytes(b'')
    for relative, target in links:
        link = data / relative
        link.parent.mkdir(parents=True, exist_ok=True)
        link.symlink_to(target)

def init_checkpoint_links(text, arm):
    lefs = re.search(r'^set init_lef_file\s+\[list\s+([^\]]+)\]', text, re.M).group(1).split()
    mmmc_path = pathlib.Path(re.search(r'^set init_mmmc_file\s+\[list\s+([^\]]+)\]', text, re.M).group(1))
    mmmc = mmmc_path.read_text()
    libs = re.search(r'create_library_set\s+-name\s+\S+\s+-timing\s+\[list\s+([^\]]+)\]', mmmc).group(1).split()
    sdc = re.search(r'create_constraint_mode\s+-name\s+\S+\s+-sdc_files\s+\[list\s+([^\]]+)\]', mmmc).group(1)
    qrc = re.search(r'create_rc_corner\s+-name\s+\S+\s+-qx_tech_file\s+(\S+)', mmmc).group(1)
    rows = [('libs/lef/' + pathlib.Path(value).name, value) for value in lefs]
    rows += [('libs/mmmc/' + pathlib.Path(value).name, value) for value in libs + [sdc]]
    rows += [('libs/mmmc/rc_' + arm + '/' + pathlib.Path(qrc).name, qrc)]
    return rows

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
    print('=== CUSTOM_CELL_FMAX LC READ COMPLETE ===\n=== CUSTOM_CELL_FMAX LC CHECK COMPLETE ===\n=== CUSTOM_CELL_FMAX LC WRITE COMPLETE ===')
    if (script.parents[3] / 'synthetic-lc-error').exists():
        print('Error: synthetic fixture library rejected')
elif tool == 'dc_shell':
    arm = re.search(r'set ::env\((?:XS28|CCFMAX)_ARM\) "([^"]+)"', text).group(1)
    top = re.search(r'set ::env\(DESIGN_TOP\) "([^"]+)"', text).group(1)
    clock_ns = float(re.search(r'set ::env\(CLK_NS\) "([0-9.]+)"', text).group(1))
    run = script.parent; (run / 'results').mkdir(exist_ok=True); (run / 'reports').mkdir(exist_ok=True)
    master = 'XS_FIX_ZN' if arm == 'custom' else 'NAND2_X1'
    (run / 'results' / (arm + '.dc.v')).write_text('module %s(input clk,a,b,output z);\n%s U0 (.A(a),.B(b),.Z(z));\nendmodule\n' % (top, master))
    fixture_flow = script.parents[3]
    input_delay = '0.2' if arm == 'custom' and (fixture_flow / 'synthetic-custom-input-delay').exists() else '0.1'
    (run / 'results' / (arm + '.dc.sdc')).write_text('### SYNTHETIC FIXTURE SDC\n# Created by write_sdc on SYNTHETIC-%s\n###\ncreate_clock -name clk -period %s [get_ports clk]\nset_clock_uncertainty %s [get_clocks clk]\nset_input_delay -clock clk %s [get_ports a]\n' % (arm, clock_ns, clock_ns * 0.25, input_delay))
    (run / 'reports' / ('refs_' + arm + '.rpt')).write_text('%s 1\n' % master)
    (run / 'reports' / ('timing_' + arm + '.rpt')).write_text('slack (MET) 0.010\n')
    (run / 'reports' / ('area_' + arm + '.rpt')).write_text('Total cell area: 100.0\n')
    dc_version = 'SYNTHETIC-DC-B' if arm == 'custom' and (fixture_flow / 'synthetic-dc-version-mismatch').exists() else 'SYNTHETIC-DC-A'
    print('   Version %s for synthetic64 - SYNTHETIC-FIXTURE' % dc_version)
    print('=== AES_DTCO LIBRARY_VISIBLE_COUNT %d ===' % (1 if arm == 'custom' else 0))
    print('=== AES_DTCO SYNTHESIS_COMPLETE %s ===' % arm)
    print('=== CUSTOM_CELL_FMAX LIBRARY_VISIBLE_COUNT %d ===' % (1 if arm == 'custom' else 0))
    print('=== CUSTOM_CELL_FMAX DC_UNCERTAINTY_NS %s ===' % (clock_ns * 0.50))
    print('=== CUSTOM_CELL_FMAX ROUTE_UNCERTAINTY_NS %s ===' % (clock_ns * 0.25))
    print('=== CUSTOM_CELL_FMAX SYNTHESIS_COMPLETE %s ===' % arm)
elif tool == 'innovus':
    arm = 'generated' if 'generated' in script.name else 'foundry'
    fixture_flow = script.parents[3]
    innovus_version = 'vSYNTHETIC-B' if arm == 'generated' and (fixture_flow / 'synthetic-innovus-version-mismatch').exists() else 'vSYNTHETIC-A'
    if not (script.name.startswith('init_') and (fixture_flow / 'synthetic-init-missing-version').exists()):
        print('Version:\t%s, built SYNTHETIC-FIXTURE' % innovus_version)
    if script.name.startswith('init_'):
        target = pathlib.Path(re.search(r'saveDesign\s+([^\s]+)', text).group(1))
        save_checkpoint(target, arm + '-init', init_checkpoint_links(text, arm))
        if not (arm == 'generated' and (fixture_flow / 'synthetic-init-missing-visibility').exists()):
            print('=== XS28 GENERATED_LIB_CELLS_AFTER_RESTORE %d ===' % (1 if arm == 'generated' else 0))
            print('=== CCFMAX GENERATED_LIB_CELLS_AFTER_RESTORE %d ===' % (1 if arm == 'generated' else 0))
        print('=== core area: {2.0 2.0 22.0 22.0} ===')
    elif script.name.startswith('pnr_'):
        target = pathlib.Path(re.search(r'saveDesign\s+([^\s]+)', text).group(1))
        restored = pathlib.Path(re.search(r'^restoreDesign\s+(\S+)', text, re.M).group(1))
        links = [(str(link.relative_to(restored)), link.readlink())
                 for link in restored.rglob('*') if link.is_symlink()]
        links = [row for row in links if not str(row[1]).endswith('.dc.sdc')]
        rc_model = script.parent / 'rc_model.bin'
        rc_model.write_bytes(b'SYNTHETIC POSTROUTE RC MODEL\n')
        links.append(('libs/misc/rc_model.bin', rc_model))
        gds = pathlib.Path(re.search(r'^streamOut\s+([^\s]+)', text, re.M).group(1))
        report_dir, prefix = re.search(r'^timeDesign -postRoute -outDir\s+(\S+)/postopt -prefix\s+(\S+)', text, re.M).groups()
        saved_io = pathlib.Path(re.search(r'^saveIoFile -locations \{([^}]+)\}', text, re.M).group(1))
        loaded_io = re.search(r'^loadIoFile \{([^}]+)\}', text, re.M)
        saved_io.parent.mkdir(parents=True, exist_ok=True)
        if loaded_io:
            saved_io.write_bytes(pathlib.Path(loaded_io.group(1)).read_bytes())
        else:
            saved_io.write_text('(iopin\n (top\n  (pin name="clk" offset=1.0000 layer=2 width=0.0500 depth=0.2800 place_status=placed )\n )\n)\n')
        summary = pathlib.Path(report_dir) / 'postopt' / (prefix + '.summary.gz')
        paths = pathlib.Path(report_dir) / 'postopt' / (prefix + '_all.tarpt.gz')
        save_checkpoint(target, arm + '-postroute', links)
        gds.parent.mkdir(parents=True, exist_ok=True); gds.write_bytes(b'SYNTHETIC GDS\n')
        summary.parent.mkdir(parents=True, exist_ok=True)
        rounded_open = arm == 'generated' and (fixture_flow / 'synthetic-rounded-zero-violations').exists()
        wns = '0.000' if rounded_open else ('0.010' if arm == 'generated' and (fixture_flow / 'synthetic-equal-fmax').exists() else ('0.000' if arm == 'generated' and (fixture_flow / 'synthetic-lower-fmax').exists() else ('0.020' if arm == 'generated' else '0.010')))
        violating = '3' if rounded_open else '0'
        command = 'timeDesign -postRoute -outDir %s/postopt -prefix %s' % (report_dir, prefix)
        summary_text = '# Generated by: SYNTHETIC FIXTURE\n# Command: %s\n| Setup mode | all | reg2reg | default |\n| WNS (ns): | %s | %s | 0.000 |\n| TNS (ns): | 0.000 | 0.000 | 0.000 |\n| Violating Paths: | %s | %s | 0 |\n| All Paths: | 1 | 1 | 0 |\n' % (command, wns, wns, violating, violating)
        view = 'view_wrong' if (fixture_flow / 'synthetic-mismatched-timing-view').exists() else 'view_' + arm
        path_text = '# Generated by: SYNTHETIC FIXTURE\n# Command: %s\nPath 1: SYNTHETIC Setup Check\nAnalysis View: %s\n= Slack Time %s\n' % (command, view, wns)
        if (fixture_flow / 'synthetic-corrupt-timing-gzip').exists():
            summary.write_bytes(b'NOT GZIP')
        else:
            with gzip.open(summary, 'wt') as handle: handle.write(summary_text)
        if not (fixture_flow / 'synthetic-missing-timing-companion').exists():
            with gzip.open(paths, 'wt') as handle: handle.write(path_text)
        hold_summary = pathlib.Path(report_dir) / 'posthold' / (prefix.replace('post', 'hold') + '_hold.summary.gz')
        hold_paths = pathlib.Path(report_dir) / 'posthold' / (prefix.replace('post', 'hold') + '_all_hold.tarpt.gz')
        hold_summary.parent.mkdir(parents=True, exist_ok=True)
        hold_wns = '-0.010' if (fixture_flow / 'synthetic-hold-violation').exists() else '0.010'
        hold_paths_count = '1' if hold_wns.startswith('-') else '0'
        hold_command = 'timeDesign -postRoute -hold -outDir %s/posthold -prefix hold' % report_dir
        hold_text = '# Generated by: SYNTHETIC FIXTURE\n# Command: %s\n| Hold mode | all | reg2reg | default |\n| WNS (ns): | %s | %s | 0.000 |\n| TNS (ns): | 0.000 | 0.000 | 0.000 |\n| Violating Paths: | %s | %s | 0 |\n| All Paths: | 1 | 1 | 0 |\n' % (hold_command, hold_wns, hold_wns, hold_paths_count, hold_paths_count)
        hold_path_text = '# Generated by: SYNTHETIC FIXTURE\n# Command: %s\nPath 1: SYNTHETIC Hold Check\nAnalysis View: view_%s\n= Slack Time %s\n' % (hold_command, arm, hold_wns)
        with gzip.open(hold_summary, 'wt') as handle: handle.write(hold_text)
        with gzip.open(hold_paths, 'wt') as handle: handle.write(hold_path_text)
        route_drc = pathlib.Path(report_dir) / 'route.drc.rpt'
        route_drc.write_text('# Command: verify_drc -limit 100000 -report %s\n%s\n' % (route_drc, 'Total Violations: 2' if (fixture_flow / 'synthetic-route-drc').exists() else 'No DRC violations were found'))
        connectivity = pathlib.Path(report_dir) / 'connectivity.rpt'
        connectivity.write_text('%s\n' % ('Total connectivity violations: 3' if (fixture_flow / 'synthetic-connectivity').exists() else 'No connectivity violations'))
        (pathlib.Path(report_dir) / 'power.rpt').write_text('Power Units = 1mW\nTotal Power: 1.25\n')
        (pathlib.Path(report_dir) / 'gatecount.rpt').write_text('[0] held_out_datapath Gates=42 Cells=21 Area=12.5 um^2\n')
        (pathlib.Path(report_dir) / 'summary.rpt').write_text('# Instances: 25\n% Pure Gate Density #6 ((fixture)): 55.5%\n')
        actual_sdc = pathlib.Path(re.search(r'^write_sdc\s+(\S+)', text, re.M).group(1))
        if not (fixture_flow / 'synthetic-missing-actual-clock').exists():
            input_sdcs = [link for link in restored.rglob('*') if link.is_symlink() and str(link.readlink()).endswith('.dc.sdc')]
            period = re.search(r'create_clock\b[^\n]*-period\s+([0-9.]+)', input_sdcs[0].read_text()).group(1)
            period = '0.4' if (fixture_flow / 'synthetic-changed-actual-clock').exists() else period
            actual_sdc.parent.mkdir(parents=True, exist_ok=True)
            actual_sdc.write_text('create_clock -name clk -period %s [get_ports clk]\n' % period)
        print('=== XS28 PNR DONE %s (GDS written) ===' % arm)
        print('=== CCFMAX PNR DONE %s (GDS written) ===' % arm)
    else:
        report = pathlib.Path(re.search(r'verify_drc -limit\s+(\d+) -report \{([^}]+)\}', text).group(2))
        limit = re.search(r'verify_drc -limit\s+(\d+)', text).group(1)
        report.write_text('# Generated by: SYNTHETIC FIXTURE\n# Command: verify_drc -limit %s -report %s\nNo DRC violations were found\n' % (limit, report))
        final = re.search(r'timeDesign -postRoute -outDir \{([^}]+)\} -prefix final', text)
        if final:
            timing = pathlib.Path(final.group(1))
            timing.mkdir(parents=True, exist_ok=True)
            wns = '0.010' if arm == 'generated' and (fixture_flow / 'synthetic-equal-fmax').exists() else ('0.000' if arm == 'generated' and (fixture_flow / 'synthetic-lower-fmax').exists() else ('0.020' if arm == 'generated' else '0.010'))
            command = 'timeDesign -postRoute -outDir %s -prefix final' % timing
            summary = '# Generated by: SYNTHETIC FIXTURE\n# Command: %s\n| Setup mode | all | reg2reg | default |\n| WNS (ns): | %s | %s | 0.000 |\n| TNS (ns): | 0.000 | 0.000 | 0.000 |\n| Violating Paths: | 0 | 0 | 0 |\n| All Paths: | 1 | 1 | 0 |\n' % (command, wns, wns)
            paths = '# Generated by: SYNTHETIC FIXTURE\n# Command: %s\nPath 1: SYNTHETIC Setup Check\nAnalysis View: view_%s\n= Slack Time %s\n' % (command, arm, wns)
            with gzip.open(timing / 'final.summary.gz', 'wt') as handle: handle.write(summary)
            with gzip.open(timing / 'final_all.tarpt.gz', 'wt') as handle: handle.write(paths)
        print('=== AES_DTCO VERIFY_LIBRARY_VISIBLE %d ===' % (1 if arm == 'generated' else 0))
        print('=== AES_DTCO VERIFY_COMPLETE %s ===' % arm)
        print('=== CUSTOM_CELL_FMAX VERIFY_LIBRARY_VISIBLE %d ===' % (1 if arm == 'generated' else 0))
        print('=== CUSTOM_CELL_FMAX FINAL_DB_INSTANCE_COUNT %d ===' % (0 if (fixture_flow / 'synthetic-zero-final-adoption').exists() else (1 if arm == 'generated' else 0)))
        print('=== CUSTOM_CELL_FMAX VERIFY_COMPLETE %s ===' % arm)
else:
    raise SystemExit(8)
`;

type FixtureOptions = {
  pack?: string;
  stages?: string;
  reader?: string;
  top?: string;
  schema?: string;
  customBindings?: boolean;
};

async function createDomainFixture(options: FixtureOptions = {}): Promise<AesDomainFixture> {
  const pack = options.pack ?? aesDomainPack;
  const stages = options.stages ?? aesStages;
  const reader = options.reader ?? aesStageReader;
  const top = options.top ?? 'aes_cipher_top';
  const workspace = await mkdtemp(path.join(os.tmpdir(), 'aes-domain-fixture-'));
  const flow = path.join(workspace, 'flow');
  const site = path.join(workspace, 'synthetic-site');
  const helpers = path.join(site, 'helpers');
  await mkdir(flow, { recursive: true }); await mkdir(helpers, { recursive: true });
  await cp(path.join(pack, 'flow/domain'), path.join(flow, 'domain'), { recursive: true });
  const files: Record<string, string> = {
    'rtl/aes.v': `module ${top}(input clk,a,b,output z); NAND2_X1 U0(.A(a),.B(b),.ZN(n)); INV_X1 U1(.A(n),.ZN(z)); NAND2_X1 U2(.A(a),.B(b),.ZN(n2)); INV_X1 U3(.A(n2),.ZN()); endmodule\n`,
    'foundry.db': 'SYNTHETIC FOUNDRY DB\n',
    'foundry.lib': 'library (fixture) { cell (NAND2_X1) { pin(A){direction:input;} pin(B){direction:input;} pin(ZN){direction:output; function:"!(A*B)";} } cell (INV_X1) { pin(A){direction:input;} pin(ZN){direction:output; function:"!A";} } }\n',
    'skeleton.lib': 'cell (NAND2_X1)\n  area : 1.0\n  pin(A)\n    direction : input\n  pin(B)\n    direction : input\n  pin(ZN)\n    direction : output\n    function : "!(A*B)"\ncell (INV_X1)\n  area : 0.5\n  pin(A)\n    direction : input\n  pin(ZN)\n    direction : output\n    function : "!A"\n',
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
  const inputs = options.customBindings ? {
    evidenceClass: 'synthetic-fixture', designTop: top, DESIGN_TOP: top,
    rtlGlob: path.join(site, 'rtl/*.v'), DESIGN_RTL_GLOB: path.join(site, 'rtl/*.v'),
    foundryDb: path.join(site, 'foundry.db'), FOUNDRY_DB: path.join(site, 'foundry.db'),
    constraintsTcl: path.join(site, 'constraints.tcl'), CONSTRAINTS_FILE: path.join(site, 'constraints.tcl'),
    clockName: 'clk', EDA_WRAPPER: tool,
    ...Object.fromEntries(Object.entries(legacy).map(([key, value]) => [key.replace(/^XS28_/, 'CCFMAX_'), value])),
    PLACE_SITE: 'core',
  } : { evidenceClass: 'synthetic-fixture', design: top,
    rtlGlob: path.join(site, 'rtl/*.v'), foundryDb: path.join(site, 'foundry.db'),
    edaWrapper: `${tool}`, legacy };
  await writeFile(path.join(site, 'constraints.tcl'), 'create_clock -name clk -period 0.5 [get_ports clk]\n');
  await writeFile(path.join(flow, 'inputs.json'), JSON.stringify(inputs, null, 2) + '\n');
  return {
    workspace, inputs,
    run(stage, route) { return spawnSync('/usr/bin/python3', [stages, stage, workspace, ...(route ? [route] : [])], { encoding: 'utf8' }); },
    read(report, stage) { const out = path.join(workspace, `read-${stage}.json`); return { run: spawnSync('/usr/bin/python3', [reader, report, out, stage], { encoding: 'utf8' }), out }; },
    async select(route, candidateIds) {
      const folder = path.join(flow, 'mining', route); const raw = await readFile(path.join(folder, 'raw.json'));
      const mine = JSON.parse(await readFile(path.join(flow, 'records', `mine-${route}.json`), 'utf8'));
      await writeFile(path.join(folder, 'selected.json'), JSON.stringify({ sourceSha256: sha256(raw), selected: [...candidateIds], codeSha256: mine.facts.codeSha256 }, null, 2) + '\n');
    },
    dispose() { return rm(workspace, { recursive: true, force: true }); },
  };
}

export async function createAesDomainFixture(): Promise<AesDomainFixture> {
  return createDomainFixture();
}

/** A held-out, flat-binding fixture.  It runs the portable Pack's own stage and reader
 * adapters; its synthetic external tools make no EDA or AES claim. */
export async function createCustomCellFmaxFixture(): Promise<AesDomainFixture> {
  return createDomainFixture({ pack: customCellFmaxPack, stages: customCellFmaxStages,
    reader: customCellFmaxStageReader, top: 'held_out_datapath', customBindings: true });
}
