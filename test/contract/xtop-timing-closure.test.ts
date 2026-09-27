import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import os from 'node:os';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { BUILTIN_TCL_ADAPTER_DIGEST, choose, encodeRetainedInteractiveCommand, interactiveCommandsDigest, loadPack, checkPack, packDigestExcludes, packStage, loadSite, installPackMethod, resolveChooser, type InteractiveBinding, type ObservationRecord, type VerdictRecord } from '@hima/harness';
import { createHimaHome, repoRoot } from './support/dsh-home.ts';
import { bootInProcess, createRootAgent } from './support/boot-inprocess.ts';
import { himaCommand } from './support/command.ts';
import { writeLocalSite } from './support/site.ts';
import { waitUntil } from './support/fabric.ts';

const packId = 'xtop-timing-closure';
const xtopOperatorWrapper = '/data/eda/project/hima_harness/operator-admin/xtop-v5/xtop-operator-v5.sh';

test('the XTop closure Pack loads, fits its declared execution surface and passes its cheap data-contract tests', async (t) => {
  const h = await createHimaHome();
  t.after(() => h.dispose());
  const local = await writeLocalSite(h, {
    allowedWrappers: ['/usr/bin/python3', xtopOperatorWrapper],
    bindings: {
      inputInnovusDatabase: path.join(h.workspace, 'input.enc.dat'),
      siteProfile: path.join(h.workspace, 'site-profile.json'),
      sourceManifest: path.join(h.workspace, 'source-manifest.sha256'),
      workspaceRoot: h.workspace,
    },
    licences: { Innovus: 1, StarRC: 1, PrimeTime: 1, XTop: 1 },
  });
  const packDir = path.join(repoRoot, 'packs', packId);
  const pack = loadPack(path.join(repoRoot, 'packs'), packId);
  assert.ok(['none', 'tested', 'released'].includes(packStage(packDir).stage),
    'method development may precede TEST/seal; release remains a separate gate');
  assert.equal(pack.graph.nodes.length, 29);
  assert.equal(pack.graph.edges.length, 29);
  const team = pack.contract.agentTeams.find(candidate => candidate.id === 'timing-eco-team');
  assert.ok(team);
  assert.equal(team.triggerNode, 'run-xtop-fix');
  assert.deepEqual(team.members.map(member => member.id), ['researcher', 'reviewer', 'operator']);
  assert.deepEqual(team.members.find(member => member.id === 'operator')?.allowedTools, ['hima_interactive']);
  const check = checkPack(pack, loadSite(local.sitesDir, local.name));
  assert.equal(check.fit, true, check.errors.join('\n'));
  installPackMethod({ from: packDir, to: path.join(h.home, 'hima/packs', packId) });
  const host = await bootInProcess(h);
  try {
    const throughHost = await himaCommand(host, h.workspace, `/hima pack check ${packId} --site local`);
    assert.equal(throughHost.kind, 'success', throughHost.text);
    assert.match(throughHost.text, /xtop-timing-closure@1\.0\.16.*fit/s);
  } finally { await host.dispose(); }

  const tests = spawnSync('python3', ['-m', 'unittest', 'discover', '-s', path.join(packDir, 'flow/tests'), '-v'], {
    cwd: repoRoot,
    encoding: 'utf8',
  });
  assert.equal(tests.status, 0, `${tests.stdout}\n${tests.stderr}`);
});

test('Packs without an Agent Team recipe remain loadable and checkPack-compatible', async t => {
  const h = await createHimaHome(); t.after(() => h.dispose());
  const legacy = loadPack(path.join(repoRoot, 'packs'), 'opene902-timing-probe');
  assert.deepEqual(legacy.contract.agentTeams, []);
  const local = await writeLocalSite(h, { allowedReadRoots: [h.workspace], allowedWriteRoots: [h.workspace],
    allowedWrappers: ['make'], bindings: { flowRoot: h.workspace, design: 'fixture', workspaceRoot: h.workspace },
    licences: { 'Design-Compiler': 1 } });
  const checked = checkPack(legacy, loadSite(local.sitesDir, local.name));
  assert.equal(checked.fit, true, checked.errors.join('\n'));
});

test('run-xtop-fix keeps batch argv and exposes only the qualified typed Operator commands', async () => {
  const pack = loadPack(path.join(repoRoot, 'packs'), packId);
  const tool = pack.contract.tools.find((candidate) => candidate.id === 'run-xtop-fix');
  assert.ok(tool);
  assert.match(tool.description, /reader-backed.*owner-adopted reviewed/is,
    'the Pack exposes one typed action selected from the retained plan');
  assert.match(tool.description, /no generic file access|must not.*read.*plan path/is,
    'the Pack never assigns an unreachable fix-plan path to an interactive-only Operator child');
  assert.equal(tool.interactive?.mode, 'hybrid');
  assert.deepEqual(tool.argv, ['/usr/bin/python3', '${WORKSPACE}/flow/closure.py', 'xtop', '${WORKSPACE}']);
  assert.deepEqual(tool.interactive?.argv, [xtopOperatorWrapper, '${WORKSPACE}', '${WORKSPACE}/flow/closure.py',
    '${WORKSPACE}/flow/templates/xtop-operator.tcl']);
  assert.deepEqual(tool.interactive?.commands, {
    read: ['hima_operator_identity', 'hima_summary'], mutate: ['hima_apply_action'],
    save: ['hima_save_candidate'], close: ['hima_close'],
  });
  assert.deepEqual(tool.interactive?.arguments, {
    hima_operator_identity: [],
    hima_summary: [{ name: 'mode', type: 'string', choices: ['setup', 'hold'] }],
    hima_apply_action: [
      { name: 'kind', type: 'string', choices: ['setup-size', 'setup-buffer', 'hold-size', 'hold-buffer'] },
      { name: 'effort', type: 'string', choices: ['medium', 'high'] },
      { name: 'setupTargetNs', type: 'number', minimum: -0.2, maximum: 0.2 },
      { name: 'holdTargetNs', type: 'number', minimum: -0.2, maximum: 0.2 },
      { name: 'setupMarginNs', type: 'number', minimum: -0.2, maximum: 0.2 },
      { name: 'holdMarginNs', type: 'number', minimum: -0.2, maximum: 0.2 },
      { name: 'planSha256', type: 'string' },
    ],
    hima_save_candidate: [],
    hima_close: [],
  }, 'the retained Pack tells an Operator child the exact positional shape of every typed command');
  assert.equal(tool.interactive?.commands.read.includes('source'), false);
  assert.equal(tool.interactive?.commands.read.includes('exec'), false);
  const wrapper = await readFile(path.join(repoRoot, 'sites/linglong-swerv28/xtop-operator-v5.sh'), 'utf8');
  assert.match(wrapper, /trap cleanup_container EXIT HUP INT TERM/);
  assert.match(wrapper, /podman run --rm -it \\\n+  --name "\$container_name"/);
  assert.match(wrapper, /podman rm -f -- "\$container_name"/);

  const binding: InteractiveBinding = {
    id: 'xtop-literal-test', packId, packDigest: pack.folder.digest([]), nodeId: 'run-xtop-fix', toolId: tool.id,
    source: { kind: 'trusted-test-fixture', id: 'xtop-literal-test' },
    adapter: { id: 'hima-tcl-line-v1', version: '1', digest: BUILTIN_TCL_ADAPTER_DIGEST,
      completionProtocol: 'versioned-marker', allowsMultiline: false },
    environment: { id: 'fixture', digest: 'a'.repeat(64) }, mutation: 'qualified',
    limits: { startupWaitMs: 1, callWaitMaxMs: 1, commandMaxMs: 1, sessionMaxMs: 1, idleMaxMs: 1 },
  };
  const encoded = encodeRetainedInteractiveCommand(tool, binding, { commandId: 'plan-1', protocolToken: 'Q'.repeat(32),
    name: 'hima_apply_action', args: { kind: 'hold-buffer', effort: 'high', setupTargetNs: 0,
      holdTargetNs: 0, setupMarginNs: 0.02, holdMarginNs: 0.02, planSha256: 'a'.repeat(64) } });
  assert.equal(encoded.effect, 'mutation');
  assert.match(encoded.text, /hima_apply_action/);
  assert.throws(() => encodeRetainedInteractiveCommand(tool, binding, { commandId: 'source-1', protocolToken: 'S'.repeat(32),
    name: 'source', args: { arguments: ['/tmp/untrusted.tcl'] } }), /not classified/);
  assert.throws(() => encodeRetainedInteractiveCommand(tool, binding, { commandId: 'plan-extra', protocolToken: 'E'.repeat(32),
    name: 'hima_apply_action', args: { kind: 'hold-buffer', effort: 'high', setupTargetNs: 0,
      holdTargetNs: 0, setupMarginNs: 0.02, holdMarginNs: 0.02, planSha256: 'a'.repeat(64), script: 'source /tmp/x' } }), /unexpected.*script/i,
  'the fixed plan command refuses any model-authored path or Tcl argument');
  const close = encodeRetainedInteractiveCommand(tool, binding, { commandId: 'close-1', protocolToken: 'C'.repeat(32),
    name: 'hima_close', args: {} });
  assert.equal(close.effect, 'close');
  assert.match(close.text, /HIMA:C{32}:DONE"; exit/);

  const template = await readFile(path.join(repoRoot, 'packs/xtop-timing-closure/flow/templates/xtop-operator.tcl'), 'utf8');
  const saves = template.split('\n').filter((line) => line.trimStart().startsWith('save_workspace -as '));
  assert.deepEqual(saves, [], 'Operator retries retain only the admitted ECO output pair, never collision-prone named XTop workspaces');
  assert.match(template, /write_design_changes -format INNOVUS .* -output_dir \$::eco_output_dir -keep_route/,
    'hima_save_candidate still persists the declared logical/physical ECO pair');
  assert.match(template, /proc hima_apply_action \{kind effort setup_target hold_target setup_margin hold_margin plan_sha256\}/);
  assert.doesNotMatch(template, /proc hima_apply_plan/,
    'the Operator applies one reviewed action rather than an entire model-selected portfolio');
  assert.match(template, /candidate requires at least one successful typed mutation/,
    'save fails before creating residue when the Operator skipped every mutation');
  assert.match(template, /file delete -force \$::eco_output_dir/,
    'an empty failed save is removed so one admitted retry is not poisoned by empty residue');
  assert.match(template, /candidate write produced no unique netlist and physical ECO pair/,
    'save does not return DONE until the exact ECO pair exists');
  assert.match(template, /candidate ECO output already exists; refusing an uncertain overwrite/,
    'a retry cannot overwrite an earlier or uncertain candidate artifact');
});

test('the XTop typed save refuses zero-mutation residue and admits one exact ECO pair', async t => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'hima-xtop-operator-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const sta = path.join(root, 'sta'); await mkdir(sta);
  for (const name of ['tech.lef', 'cell.lef', 'design.v', 'design.def', 'libraries.tcl']) {
    await writeFile(path.join(root, name), '\n');
  }
  const actions = path.join(root, 'actions.tcl');
  await writeFile(actions, [
    'fix_hold_gba_violations -size_cell_only -size_rule nominal_keywords -hold_target 0 -setup_margin 0.02',
    'fix_hold_gba_violations -effort medium -hold_target 0 -setup_margin 0.02',
    'fix_setup_gba_violations -methods size_cell -effort high -setup_target 0 -hold_margin 0.02',
  ].join('\n') + '\n');
  const uncertainActions = path.join(root, 'uncertain-actions.tcl');
  await writeFile(uncertainActions, [
    'fix_hold_gba_violations -effort medium -hold_target 0 -setup_margin 0.02',
    'error partial-plan-failure',
  ].join('\n') + '\n');
  const template = path.join(repoRoot, 'packs/xtop-timing-closure/flow/templates/xtop-operator.tcl');
  const script = `
set env(DESIGN) top
set env(TECH_LEF) ${JSON.stringify(path.join(root, 'tech.lef'))}
set env(CELL_LEF_GLOB) ${JSON.stringify(path.join(root, 'cell.lef'))}
set env(NETLIST) ${JSON.stringify(path.join(root, 'design.v'))}
set env(DEF) ${JSON.stringify(path.join(root, 'design.def'))}
set env(STA_DATA) ${JSON.stringify(sta)}
set env(RUN_ROOT) ${JSON.stringify(root)}
set env(LIBRARY_TCL) ${JSON.stringify(path.join(root, 'libraries.tcl'))}
set env(ACTIONS_TCL) ${JSON.stringify(actions)}
set env(ACTION_COUNT) 3
set env(PLAN_SHA256) ${JSON.stringify('a'.repeat(64))}
set env(ECO_PREFIX) operator_g001
set env(OPERATOR_IDENTITY) fixture
foreach name {set_parameter create_workspace link_reference_library create_design_definition set_site_map set_removable_fillers import_designs check_placement_readiness read_timing_data check_inst_reference_library check_inst_timing_library summarize_gba_violations} {
  proc $name args {}
}
set fail_fix 0
proc fix_hold_gba_violations args { lappend ::fixes $args; if {$::fail_fix} { error partial-action-failure } }
proc fix_setup_gba_violations args { lappend ::fixes $args; if {$::fail_fix} { error partial-action-failure } }
set fixes {}
set write_mode empty
proc write_design_changes args {
  set output_dir [lindex $args [expr {[lsearch -exact $args -output_dir] + 1}]]
  set prefix [lindex $args [expr {[lsearch -exact $args -eco_file_prefix] + 1}]]
  if {$::write_mode eq "pair"} {
    close [open [file join $output_dir "\${prefix}_netlist_top.txt"] w]
    close [open [file join $output_dir "\${prefix}_physical_top.txt"] w]
  }
}
source ${JSON.stringify(template)}
if {![catch {hima_save_candidate} message] || ![string match {*requires at least one successful typed mutation*} $message]} { error zero-mutation-save-was-not-refused }
if {![catch {hima_apply_action hold-size high 0 0 0.02 0.02 ${'b'.repeat(64)}} message] || ![string match {*plan hash differs*} $message]} { error changed-plan-hash-was-not-refused }
if {[llength $::fixes] != 0 || $::hima_plan_state ne "uncertain"} { error changed-plan-hash-crossed-mutation-boundary }
set ::hima_plan_state ready
hima_apply_action hold-size high 0 0 0.02 0.02 ${'a'.repeat(64)}
if {[llength $::fixes] != 1} { error reviewed-action-was-not-applied-once }
if {[lsearch -exact [lindex $::fixes 0] -size_cell_only] < 0} { error hold-size-method-was-lost }
if {![catch {hima_apply_action hold-size high 0 0 0.02 0.02 ${'a'.repeat(64)}} message] || ![string match {*already attempted; state=applied*} $message]} { error duplicate-action-application-was-not-refused }
if {[llength $::fixes] != 1} { error duplicate-action-application-had-an-effect }
if {![catch {hima_save_candidate} message] || ![string match {*no unique netlist and physical ECO pair*} $message]} { error empty-save-was-not-refused }
if {[file exists [file join ${JSON.stringify(root)} eco_output]]} { error empty-save-residue-remained }
file mkdir [file join ${JSON.stringify(root)} eco_output]
close [open [file join ${JSON.stringify(root)} eco_output .partial] w]
if {![catch {hima_save_candidate} message] || ![string match {*refusing an uncertain overwrite*} $message]} { error hidden-residue-was-not-refused }
if {![file exists [file join ${JSON.stringify(root)} eco_output .partial]]} { error hidden-residue-was-deleted }
file delete -force [file join ${JSON.stringify(root)} eco_output]
set write_mode pair
set saved [hima_save_candidate]
if {![file exists [file join $saved operator_g001_netlist_top.txt]] || ![file exists [file join $saved operator_g001_physical_top.txt]]} { error exact-pair-was-not-retained }
if {![catch {hima_save_candidate} message] || ![string match {*refusing an uncertain overwrite*} $message]} { error nonempty-retry-was-not-refused }
set ::hima_plan_state ready
set ::hima_mutation_count 0
set ::fixes {}
set fail_fix 1
if {![catch {hima_apply_action hold-buffer high 0 0 0.02 0.02 ${'a'.repeat(64)}} message] || ![string match {*partial-action-failure*} $message]} { error partial-action-failure-was-not-retained }
if {$::hima_plan_state ne "uncertain" || [llength $::fixes] != 1} { error partial-plan-state-was-not-uncertain }
if {![catch {hima_apply_action hold-buffer high 0 0 0.02 0.02 ${'a'.repeat(64)}} message] || ![string match {*already attempted; state=uncertain*} $message]} { error uncertain-plan-was-replayed }
if {![catch {hima_save_candidate} message] || ![string match {*application is uncertain*} $message]} { error uncertain-plan-was-saved }
puts QUALIFIED
`;
  const checked = spawnSync('/usr/bin/tclsh', [], { input: script, encoding: 'utf8' });
  assert.equal(checked.status, 0, `${checked.stdout}\n${checked.stderr}`);
  assert.match(checked.stdout, /QUALIFIED/);
});

test('the admin generator binds qualification to linglong-swerv28 and the current Pack digest', async (t) => {
  const h = await createHimaHome(); t.after(() => h.dispose());
  const pack = loadPack(path.join(repoRoot, 'packs'), packId);
  const tool = pack.contract.tools.find((candidate) => candidate.id === 'run-xtop-fix')!;
  const template = await readFile(path.join(repoRoot, 'sites/linglong-swerv28/xtop-operator-environment.template.json'), 'utf8');
  const evidence = template
    .replace('<current-pack-digest>', pack.folder.digest(packDigestExcludes))
    .replace('<current-adapter-digest>', BUILTIN_TCL_ADAPTER_DIGEST)
    .replace('<current-commands-digest>', interactiveCommandsDigest(tool))
    .replace('<passed-after-fresh-production-root-qualification>', 'passed')
    .replaceAll('<64-lowercase-hex>', 'a'.repeat(64));
  const environment = path.join(h.home, 'xtop-operator-environment.json');
  const output = path.join(h.home, 'interactive-bindings.json');
  await writeFile(environment, evidence);
  const generated = spawnSync(process.execPath, [path.join(repoRoot, 'scripts/generate-xtop-operator-binding.mjs'),
    '--environment', environment, '--output', output], { cwd: repoRoot, encoding: 'utf8' });
  assert.equal(generated.status, 0, generated.stderr);
  const document = JSON.parse(await readFile(output, 'utf8'));
  assert.equal(document.bindings[0].site, 'linglong-swerv28');
  assert.match(document.bindings[0].id, /^linglong-swerv28:xtop-operator-v5:/);
  assert.equal(document.bindings[0].environment.id, 'linglong-swerv28:xtop-operator-v5');
  assert.equal(document.bindings[0].packDigest, pack.folder.digest(packDigestExcludes));
  assert.equal(document.bindings[0].commandsDigest, interactiveCommandsDigest(tool));
  assert.equal(document.bindings[0].mutation, 'qualified');
  const parsedEvidence = JSON.parse(evidence);
  const wrapperBytes = await readFile(path.join(repoRoot, 'sites/linglong-swerv28/xtop-operator-v5.sh'));
  const sourceBytes = await readFile(path.join(repoRoot, 'packs/xtop-timing-closure/flow/templates/xtop-operator.tcl'));
  const adapterBytes = await readFile(path.join(repoRoot, 'packs/xtop-timing-closure/flow/closure.py'));
  assert.equal(parsedEvidence.wrapper.path, xtopOperatorWrapper);
  assert.equal(parsedEvidence.wrapper.sha256, createHash('sha256').update(wrapperBytes).digest('hex'));
  assert.equal(parsedEvidence.sourceTemplate.sha256, createHash('sha256').update(sourceBytes).digest('hex'));
  const wrapperText = wrapperBytes.toString('utf8');
  assert.match(wrapperText, new RegExp(createHash('sha256').update(sourceBytes).digest('hex')),
    'the immutable production wrapper pins the current startup template bytes');
  assert.match(wrapperText, new RegExp(createHash('sha256').update(adapterBytes).digest('hex')),
    'the immutable production wrapper pins the current Pack adapter bytes');
  assert.match(wrapperText, /xtop-interactive-verify/,
    'the production wrapper verifies the plan projection immediately before and after XTop');

  const overwrite = spawnSync(process.execPath, [path.join(repoRoot, 'scripts/generate-xtop-operator-binding.mjs'),
    '--environment', environment, '--output', output], { cwd: repoRoot, encoding: 'utf8' });
  assert.notEqual(overwrite.status, 0, 'generation never silently overwrites an active administrator binding');
});

test('a real Host reads XTop physical evidence through its Pack observation node', async t => {
  const h = await createHimaHome(); t.after(() => h.dispose());
  const variant = path.join(h.home, 'xtop-observe-variant', packId);
  await mkdir(path.dirname(variant), { recursive: true });
  await cp(path.join(repoRoot, 'packs', packId), variant, { recursive: true });
  await rm(path.join(variant, 'VERSION.yml'), { force: true });
  const originalGraph=await readFile(path.join(variant,'graph.yml'),'utf8');
  await writeFile(path.join(variant, 'graph.yml'),originalGraph
    .replace(/^entry: prepare$/m,'entry: host-read-physical')
    .replace(/^nodes:$/m,'nodes:\n  - id: host-read-physical\n    kind: act\n    parameters: { observes: closureState }')
    .replace(/^loops:/m,'  - { from: host-read-physical, to: prepare }\nloops:'));
  installPackMethod({ from: variant, to: path.join(h.home, 'hima/packs', packId) });
  const inputDb=path.join(h.workspace,'input.enc.dat');await mkdir(inputDb);await writeFile(path.join(inputDb,'db.bin'),'fixture database');
  const siteProfile=path.join(h.workspace,'site-profile.json');await writeFile(siteProfile,'{}\n');
  const sourceManifest=path.join(h.workspace,'source-manifest.sha256');await writeFile(sourceManifest,'fixture source\n');
  await writeLocalSite(h,{allowedReadRoots:[h.workspace],allowedWriteRoots:[h.workspace],allowedWrappers:['/usr/bin/python3', xtopOperatorWrapper],
    bindings:{inputInnovusDatabase:inputDb,siteProfile,sourceManifest,workspaceRoot:h.workspace},
    licences:{Innovus:1,StarRC:1,PrimeTime:1,XTop:1}});
  const host=await bootInProcess(h);let runId:string|undefined;
  try{
    const owner=await createRootAgent(host.ctx,h.workspace);const actor=String(owner.id);
    const started=await host.ctx.hima.startRun({pack:packId,site:'local',goal:{target_setup_wns_ns:0,target_hold_wns_ns:0},ownerSessionId:actor});
    assert.equal(started.kind,'ran',JSON.stringify(started));if(started.kind!=='ran')return;runId=started.run.id;
    const record=host.ctx.hima.ledger.records({runId,type:'workspace'}).find(row=>row.type==='workspace');assert.ok(record);
    const workspace=record.workspace;
    const physicalRoot=path.join(workspace,'flow/iterations/g000/PHYSICAL');await mkdir(physicalRoot,{recursive:true});
    const drc=path.join(physicalRoot,'verify_drc.rpt');await writeFile(drc,'#  Command: verify_drc -limit 1000000 -report /site/drc.rpt\n  Total Violations : 0 Viols.\n');
    const connectivity=path.join(physicalRoot,'verify_connectivity.rpt');await writeFile(connectivity,'#  Command: verifyConnectivity -noAntenna -error 1000000 -report /site/conn.rpt\nBegin Summary\n    0 Problem(s) (IMPVFC-200): Special Wires.\n    0 total info(s) created.\nEnd Summary\n');
    const manifest=path.join(physicalRoot,'physical-check.json');await writeFile(manifest,JSON.stringify({schema:'xtop-timing-closure-physical-check/2',coverage:'complete',drcLimit:1000000,connectivityLimit:1000000,drcReport:'verify_drc.rpt',connectivityReport:'verify_connectivity.rpt'}));
    const measurement=path.join(workspace,'flow/iterations/g000/measurement.txt');await writeFile(measurement,'retained measurement\n');
    const fileRef=async(file:string,role:string)=>{const raw=await readFile(file);const relative=path.relative(workspace,file);return {role,
      path:relative.startsWith(`..${path.sep}`)?file:relative,sha256:createHash('sha256').update(raw).digest('hex'),bytes:raw.length};};
    const retainedProfile=await fileRef(siteProfile,'site-profile');
    const retainedManifest=await fileRef(sourceManifest,'source-manifest');
    const state={schema:'xtop-timing-closure-state/1',iteration:0,
      reportFiles:[await fileRef(measurement,'sta-report')],
      physical:{schema:'xtop-timing-closure-physical-check/2',coverage:'complete',drcLimit:1000000,connectivityLimit:1000000,
        drc:{count:0,report:await fileRef(drc,'physical-drc')},connectivity:{count:0,report:await fileRef(connectivity,'physical-connectivity')},
        manifest:await fileRef(manifest,'physical-check-manifest')},
      measurement:{scenariosSha256:'a'.repeat(64),profile:retainedProfile,sourceManifest:retainedManifest,spef:{worst:await fileRef(measurement,'spef')}},
      metrics:{setup_wns_ns:0,setup_tns_ns:0,setup_violations:0,hold_wns_ns:0,hold_tns_ns:0,hold_violations:0,unconstrained_endpoints:0,closure_score:0},endpointSlackNs:{}};
    const current=path.join(workspace,'flow/state/current.json');await mkdir(path.dirname(current),{recursive:true});await writeFile(current,JSON.stringify(state));
    await writeFile(path.join(workspace,'flow/state/runtime.json'),JSON.stringify({schema:'xtop-timing-closure-runtime/1',
      profileIdentity:retainedProfile,sourceManifest:retainedManifest}));
    let serial=0;
    const act=(action:'begin'|'work'|'complete',executionId?:string)=>{const control=host.ctx.hima.ledger.run(runId!)!.control!;return host.ctx.hima.executionAction({runId:runId!,actor,action,requestId:`xtop-reader-${++serial}`,expectedEpoch:control.epoch,expectedRevision:control.revision,...(action==='begin'?{nodeId:'host-read-physical'}:{executionId})});};
    const begun=await act('begin');assert.equal(begun.kind,'accepted',begun.reason);const executionId=begun.receipt?.executionId;assert.ok(executionId);
    const work=await act('work',executionId);assert.equal(work.kind,'accepted',work.reason);
    try { await waitUntil('XTop state reader completes',()=>host.ctx.hima.executionContext(runId!).executions.some(item=>item.id===executionId&&item.phase==='ready'),5000,20); }
    catch(error){
      const control=host.ctx.hima.ledger.run(runId)!.control!;
      const log=await host.ctx.hima.executionAction({runId,actor,action:'read',executionId,output:'@job-log',requestId:'xtop-reader-failed-log',expectedEpoch:control.epoch,expectedRevision:control.revision});
      t.diagnostic(JSON.stringify({execution:host.ctx.hima.executionContext(runId).executions.find(item=>item.id===executionId)?.result,log:log.data}));throw error;
    }
    const reading=host.ctx.hima.ledger.records({runId,type:'observation'}).find(row=>row.type==='observation');assert.ok(reading);
    assert.equal(reading.reader.id,'xtop-closure-state');
    assert.ok(reading.values.some(value=>value.type==='xtop_setup_wns'&&value.value===0));
  }finally{if(runId)await host.ctx.hima.cancelRun(runId);await host.dispose();}
});

test('XTop recommendation cannot claim completion while any required verdict fails or is undetermined', () => {
  const pack = loadPack(path.join(repoRoot, 'packs'), packId);
  const chooser = resolveChooser(pack, 'xtop-next-iteration', 'the reading').chooser;
  const base = { runId: 'run-xtop', siteId: 'site-local', seq: 1, at: '2026-09-23T00:00:00.000Z', generation: 1 } as const;
  const observation: ObservationRecord = {
    ...base, id: 'observation-xtop', writer: 'executor', type: 'observation', path: '/work/iteration.json',
    contentSha256: 'a'.repeat(64), bytes: 1, reader: {
      id: 'xtop-iteration-result', version: '1', reportKind: 'xtop-timing-closure-iteration/1',
      emits: ['xtop_closure_score', 'xtop_endpoint_remaining_count'], file: 'tools/read-output.py', sha256: 'b'.repeat(64),
    }, values: [
      { type: 'xtop_closure_score', unit: 'score', value: 1 },
      { type: 'xtop_endpoint_remaining_count', unit: 'count', value: 1 },
    ],
  };
  const verdict = (outcome: VerdictRecord['outcome'], ruleId: string, reason?: string): VerdictRecord => ({
    ...base, id: `verdict-${ruleId}`, writer: 'judge', type: 'verdict', outcome, ruleId, ruleVersion: '1',
    cites: [observation.id], valuesAsRead: [], ...(reason === undefined ? {} : { reason }),
  });
  const input = {
    bound: { revisionStep: 1 }, knobs: pack.contract.strategy, strategy: { strategyRevision: 0 },
    observation,
    constraint: verdict('PASS', 'xtop-iteration-evidence-valid'),
    goal: verdict('PASS', 'xtop-setup-clean'),
  };
  assert.deepEqual(choose(chooser, { ...input, verdicts: [...[input.constraint, input.goal], verdict('PASS', 'xtop-hold-clean')] }),
    { ok: true, chosen: { goalMet: true }, rationale: { score: 1, iteration: 1, revisionStep: 1 } });
  for (const outcome of ['FAIL', 'UNDETERMINED'] as const) {
    const result = choose(chooser, { ...input, verdicts: [...[input.constraint, input.goal], verdict(outcome, 'xtop-hold-clean', 'held evidence')] });
    assert.equal(result.ok, false);
    if (!result.ok) assert.match(result.reason, /xtop-hold-clean is/);
  }
  assert.deepEqual(choose(chooser, input), { ok: true, chosen: { goalMet: true }, rationale: { score: 1, iteration: 1, revisionStep: 1 } },
    'two-rule callers retain their existing chooser behavior');
});
