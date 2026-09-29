// @hima-seam agent wrapped
// @hima-seam tools direct
// @hima-seam credentials direct
// L4 model probe (Issue #63, docs/agents/fast-convergence-testing.md principle 10): run each ATCS
// model-written document's producer with the real product model on retained deterministic inputs,
// then ask the Pack's own Reader whether it admits the output. Zero EDA, no Electron, no server.
//
// Issue #64 Track B port to Pack 0.2.0: the retained PR03 Run is a 0.1.9 Run, so the inputs 0.2.0 reads
// and 0.1.9 never wrote are derived from it by the Pack's own code (seed020, below) and reported per
// attempt: state/worker-slots.json (workerSlots 6), and for research-worker-01 and the Team a six-slot
// campaign plan whose w01 is the retained w01 package in the 0.2.0 shape (targetPins from its pin
// targets, the recipe scope, observe fast; w02..w06 parked) with the state/workers.json packages
// prepare-workers would stamp for it. The Team runs in scope mode (atcs-worker-01 version 4): the
// Reviewer's reply is checked as the Host checks it at Operator creation (plan hash, the recipe scope,
// hash-bearing mutations of the Operator tool).
//
// Producers probed, one fresh Run per attempt, N attempts each:
//   Workshops  diagnose-and-observe, plan-campaign, research-worker-01, compose-contributions,
//              evaluate-next-investment — a native owner Agent (the Home's default model, as in
//              production) drives only that Workshop node through hima_execute; the entry it writes
//              runs as a local Job (python3, no EDA); the Pack Reader tools/read-atcs.py reads it.
//   Team       atcs-worker-01 researcher and reviewer — real delegations through the Pack recipe
//              seam; the Host's own result check (delegation-runtime) plus the reviewed-action checks
//              the Host applies at Operator creation (index.ts). The operator is never created.
//
// Isolation: every document runs in its own child process with its own scratch Home, local Site and
// installed Pack copy whose graph.yml `entry` is the probed node (the only byte difference from the
// source Pack; both digests are reported). A tool guard refuses every tool except hima_execute /
// hima_context on that Run's probed node (Workshops) and hima_delegation_input (Team children).
//
// Inputs: the retained Workshop input captures and Reader observations of one finished Run, read
// from a retained Home's ledger and run-assets evidence (copied by sha256, never modified). For each
// Workshop the snapshot is the inputs the real model saw at its last recorded execution.
//
// Reader stand-ins (both reported per result): the design-state file re-hash (database, netlist,
// DEF, SPEF, SDC live only on the Site) is skipped; the w01 netlist hierarchy walk runs over a
// hierarchy built from instance paths proven in the retained data (DEF-resolved edit domains, the
// ECO-sized instance, PrimeTime endpoints) instead of the netlist.
//
// Credential: copied natively from --credential-home's credential store into each scratch Home
// (the kit.mjs way); never printed, never written to evidence; every retained file is scanned.
//
// usage: node scripts/probe-atcs-workshops.ts --out <fresh-dir> --retained <retained dsh Home>
//          --credential-home <dsh Home holding the product credential>
//          [--attempts 3] [--only plan-campaign,team,...] [--concurrency 3] [--attempt-minutes 20]
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, statSync, writeFileSync, appendFileSync, rmSync } from 'node:fs';
import { execFileSync, spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parse, stringify } from 'yaml';
import type { Agent } from '@deepseek-ai/dsh-agent';
import { loadPack, packDigestExcludes, retainRunMaterial, reviewedScopeProblem, runDelegations } from '@hima/harness';
import { bootInProcess, cancelTestAgent, createRootAgent, saidByModel, sayAsUser, toolCalls, toolResults, type InProcessHost } from '../test/contract/support/boot-inprocess.ts';
import { createHimaHome, repoRoot, type HimaHome } from '../test/contract/support/dsh-home.ts';
import { scanForSecret } from '../test/contract/support/moments.ts';
import { writeLocalSite } from '../test/contract/support/site.ts';
import { homePatchFile } from '../packages/desktop/src/hima-home.ts';

const PACK_ID = 'agentic-timing-closure-system';
const SELF = fileURLToPath(import.meta.url);
const sha256 = (bytes: string | Buffer) => createHash('sha256').update(bytes).digest('hex');
const now = () => new Date().toISOString();
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** The Workshop documents: node, Reader kind and extra argument, and the output the Reader reads. */
const WORKSHOPS = {
  'diagnose-and-observe': { node: 'diagnose', kind: 'observation-request', extra: [] as string[] },
  'plan-campaign': { node: 'plan', kind: 'campaign-plan', extra: [] as string[] },
  'research-worker-01': { node: 'research-worker-01', kind: 'worker-request', extra: ['w01'] },
  'compose-contributions': { node: 'compose', kind: 'integration-plan', extra: [] as string[] },
  'evaluate-next-investment': { node: 'decide-next', kind: 'next-decision', extra: [] as string[] },
} as const;
type WorkshopDoc = keyof typeof WORKSHOPS;
const DOCUMENTS = [...Object.keys(WORKSHOPS), 'team'] as const;
type Doc = (typeof DOCUMENTS)[number];

// -------------------------------------------------------------------------------------------------
// Arguments
// -------------------------------------------------------------------------------------------------
interface Options { out: string; retained: string; credentialHome: string; attempts: number; only: Doc[]; concurrency: number; attemptMs: number; child?: Doc }
function options(): Options {
  const args = process.argv.slice(2); const map = new Map<string, string>();
  const usage = 'usage: node scripts/probe-atcs-workshops.ts --out <fresh-dir> --retained <retained dsh Home> --credential-home <dsh Home> [--attempts 3] [--only a,b] [--concurrency 3] [--attempt-minutes 20]';
  for (let i = 0; i < args.length; i += 2) {
    if (!args[i]!.startsWith('--') || args[i + 1] === undefined) throw new Error(usage);
    map.set(args[i]!.slice(2), args[i + 1]!);
  }
  for (const key of map.keys()) if (!['out', 'retained', 'credential-home', 'attempts', 'only', 'concurrency', 'attempt-minutes', 'child'].includes(key)) throw new Error(`unknown option --${key}\n${usage}`);
  const need = (key: string) => { const value = map.get(key); if (!value) throw new Error(`missing --${key}\n${usage}`); return value; };
  const only = (map.get('only')?.split(',') ?? [...DOCUMENTS]) as Doc[];
  for (const doc of only) if (!DOCUMENTS.includes(doc)) throw new Error(`unknown document ${doc}; known: ${DOCUMENTS.join(', ')}`);
  const child = map.get('child') as Doc | undefined;
  return { out: path.resolve(need('out')), retained: path.resolve(need('retained')), credentialHome: path.resolve(need('credential-home')),
    attempts: Number(map.get('attempts') ?? 3), only, concurrency: Number(map.get('concurrency') ?? 3),
    attemptMs: Number(map.get('attempt-minutes') ?? 20) * 60_000, ...(child === undefined ? {} : { child }) };
}

// -------------------------------------------------------------------------------------------------
// Retained inputs: the Workshop input captures and Reader observations of one retained Run
// -------------------------------------------------------------------------------------------------
interface Retained { runId: string; evidence: string; ledgerSha256: string; items: RetainedItem[] }
interface RetainedItem { seq: number; kind: 'capture' | 'observation'; name?: string; workshop?: string; nodeId?: string; generation?: number; attempt?: number; path: string; sha: string; bytes: number }
function readRetained(home: string): Retained {
  const ledgerFile = path.join(home, 'storages/hima_ledger.json');
  const ledgerBytes = readFileSync(ledgerFile);
  const ledger = JSON.parse(ledgerBytes.toString('utf8')) as { tables: { records: Record<string, any> } };
  const evidenceRoot = path.join(home, 'hima/packs', PACK_ID, 'run-assets/.evidence');
  const runs = readdirSync(evidenceRoot); assert.equal(runs.length, 1, `expected one retained Run under ${evidenceRoot}`);
  const runId = runs[0]!; const evidence = path.join(evidenceRoot, runId);
  const items: RetainedItem[] = [];
  for (const r of Object.values(ledger.tables.records)) {
    if (r.runId !== runId) continue;
    if (r.type === 'knowledge' && r.origin === 'input') items.push({ seq: r.seq, kind: 'capture', name: r.file, workshop: r.workshop, nodeId: r.nodeId, generation: r.generation, attempt: r.attempt, path: r.path, sha: r.sha256, bytes: r.bytes });
    else if (r.type === 'observation') items.push({ seq: r.seq, kind: 'observation', path: r.path, sha: r.contentSha256, bytes: r.bytes });
  }
  items.sort((a, b) => a.seq - b.seq);
  return { runId, evidence, ledgerSha256: sha256(ledgerBytes), items };
}
function retainedBytes(retained: Retained, sha: string): Buffer {
  const bytes = readFileSync(path.join(retained.evidence, `${sha}.dat`));
  assert.equal(sha256(bytes), sha, `retained bytes ${sha} changed`);
  return bytes;
}
interface SeedFile { name: string; rel: string; sha: string; bytes: number; seq: number; source: string }
/** The inputs the real model saw at the Workshop's last recorded execution, completed from earlier captures. */
function workshopSnapshot(retained: Retained, workshopId: string, reads: readonly string[], outputPath: (name: string) => string): { files: SeedFile[]; unavailable: string[]; basis: string } {
  const captures = retained.items.filter((item) => item.kind === 'capture' && item.workshop === workshopId);
  assert.ok(captures.length > 0, `the retained Run holds no input capture of Workshop ${workshopId}`);
  const last = captures.at(-1)!;
  const group = captures.filter((item) => item.nodeId === last.nodeId && item.generation === last.generation && item.attempt === last.attempt);
  const start = Math.min(...group.map((item) => item.seq));
  const files: SeedFile[] = []; const unavailable: string[] = [];
  for (const name of reads) {
    const rel = outputPath(name);
    const inGroup = group.filter((item) => item.name === name).at(-1);
    const earlier = retained.items.filter((item) => item.seq < start && item.path.endsWith(`/${rel}`)).at(-1);
    // 0.2.0 reads a few files the 0.1.9 Workshop never did (plan-campaign: acceptancePolicy); the Run wrote
    // each once, so a later retained copy of the same Run is the same input (reported as such).
    const later = inGroup ?? earlier ? undefined : retained.items.filter((item) => item.path.endsWith(`/${rel}`)).at(-1);
    const chosen = inGroup ?? earlier ?? later;
    if (!chosen) { unavailable.push(name); continue; }
    files.push({ name, rel, sha: chosen.sha, bytes: chosen.bytes, seq: chosen.seq, source: inGroup ? 'captured by this Workshop execution'
      : earlier ? `latest ${chosen.kind} before seq ${start}` : `retained ${chosen.kind} at seq ${chosen.seq}, after this Workshop's last execution (written once by the Run)` });
  }
  return { files, unavailable, basis: `Workshop ${workshopId} execution ${last.nodeId} generation ${last.generation} attempt ${last.attempt} (captures seq ${start}..${Math.max(...group.map((item) => item.seq))})` };
}
/** Hierarchical instance paths, instance masters and library cells the retained data proves (Reader stand-ins). */
function knownInstances(retained: Retained): { instances: string[]; masters: Record<string, string>; cells: string[] } {
  const names = new Set<string>(); const masters: Record<string, string> = {}; const cells = new Set<string>();
  const walk = (value: unknown, key?: string): void => {
    if (Array.isArray(value)) { for (const item of value) walk(item, key); return; }
    if (value && typeof value === 'object') {
      const record = value as Record<string, unknown>;
      // A current master is proven by the retained sealed Contribution (preconditions, fromMaster) and the
      // DEF-resolved worker request; a changed-to master by the ECO that really ran.
      if (typeof record.instance === 'string') {
        for (const field of ['master', 'fromMaster']) if (typeof record[field] === 'string') { masters[record.instance] = record[field] as string; cells.add(record[field] as string); }
        if (typeof record.toMaster === 'string' && record.op === 'size_cell') cells.add(record.toMaster);
      }
      for (const [k, v] of Object.entries(value)) walk(v, k);
      return;
    }
    if (typeof value !== 'string' || !value.includes('/')) return;
    if (key === 'instances' || key === 'instance') names.add(value);
    // An endpoint/startpoint is a pin: its owner (everything before the last segment) is the instance.
    else if (key === 'endpoint' || key === 'startpoint') names.add(value.slice(0, value.lastIndexOf('/')));
  };
  for (const sha of new Set(retained.items.map((item) => item.sha))) {
    try { walk(JSON.parse(retainedBytes(retained, sha).toString('utf8'))); } catch { /* not JSON */ }
  }
  return { instances: [...names].sort(), masters, cells: [...cells].sort() };
}

// -------------------------------------------------------------------------------------------------
// The Reader, run as the Pack ships it, with the two reported stand-ins and an itemizer
// -------------------------------------------------------------------------------------------------
const READER_PY = String.raw`
import importlib.util, json, re, sys
from pathlib import Path
reader_path, kind, report, out, workspace, known_path, *extra = sys.argv[1:]
spec = importlib.util.spec_from_file_location("read_atcs", reader_path)
ra = importlib.util.module_from_spec(spec); spec.loader.exec_module(ra)
known = json.load(open(known_path))
stand_ins = set(); assumed = set()
# Stand-in 1: the design-state file re-hash (the design bytes live only on the Site).
def skip_design_refs(design_state, ws, core):
    stand_ins.add("design-state file re-hash skipped: database, netlist, DEF, SPEF and SDC bytes live only on the Site")
ra._verify_design_state_refs = skip_design_refs
# Stand-in 2: the netlist hierarchy, built from instance paths proven in the retained data; a leaf's
# type is its master where the retained data proves it, else the marker ~leaf.
def hierarchy_stand_in(netlist_path):
    stand_ins.add("netlist hierarchy stand-in: %d instance paths proven in the retained data (%d with a proven master), not the netlist" % (len(known["instances"]), len(known.get("masters", {}))))
    tree = {}
    for name in known["instances"]:
        segs = ra._split_instance_path(name)
        if not segs or any(s == "" for s in segs):
            continue
        module = known["top"]
        for i, seg in enumerate(segs):
            level = tree.setdefault(module, {})
            if i == len(segs) - 1:
                level.setdefault(seg, known.get("masters", {}).get(name, "~leaf"))
            else:
                child = module + "/" + seg
                level[seg] = child
                tree.setdefault(child, {})
                module = child
    return tree
ra._netlist_hierarchy = hierarchy_stand_in
# Stand-in 3 (C13): the sealed Liberty library is Site-only. A toMaster is a library cell when the
# retained data proves it; otherwise it is assumed one when it follows the Site's sizing pattern
# (reported). The function/VT family check runs as shipped wherever the current master is proven.
class LibraryStandIn:
    def __contains__(self, name):
        if name in known.get("cells", []):
            return True
        pattern = known.get("eco", {}).get("cellNominalSizingPattern") or ""
        if pattern and isinstance(name, str) and re.search(pattern, name):
            assumed.add(name); return True
        return False
if hasattr(ra, "_library_context"):
    def library_stand_in(ws, base_state, core):
        stand_ins.add("library stand-in: %d cells proven in the retained data; other names following the Site sizing pattern are assumed library cells; the family/VT check runs where the current master is proven" % len(known.get("cells", [])))
        return LibraryStandIn(), known.get("eco", {}), None
    ra._library_context = library_stand_in
    original_master_problems = ra._master_problems
    def master_problems(actions, hierarchy, top, base_state, ws, core, slot):
        pruned = {m: {i: t for i, t in inst.items() if t != "~leaf"} for m, inst in hierarchy.items()}
        return original_master_problems(actions, pruned, top, base_state, ws, core, slot)
    ra._master_problems = master_problems
result = {"kind": kind, "extra": extra}
sidecar = None
try:
    if hasattr(ra, "_read"):
        values, found = ra._read(kind, report, workspace, extra)
        if found is not None:
            ra._write_problems_file(report, found)
    else:
        values, found = ra.read(kind, report, workspace, extra), None
    result["exit"] = "ok"; result["values"] = values; result["problems"] = list(found or [])
except Exception as error:
    result["exit"] = "refused"; result["exception"] = "%s: %s" % (type(error).__name__, error); result["problems"] = []
    if hasattr(ra, "_REQUEST_HANDLERS") and kind in ra._REQUEST_HANDLERS:
        ra._write_problems_file(report, [], refused=result["exception"])
if hasattr(ra, "_problems_file") and ra._problems_file(report).exists():
    result["sidecar"] = {"path": str(ra._problems_file(report)), "text": ra._problems_file(report).read_text()}
result["standIns"] = sorted(stand_ins)
result["assumedLibraryCells"] = sorted(assumed)
counts = {v["type"]: v.get("value") for v in result.get("values", [])}
result["admitted"] = result["exit"] == "ok" and counts.get("tc_request_invalid_count") == 0 and (kind != "next-decision" or counts.get("tc_next_action") is not None)
try:
    doc = json.load(open(report))
    if kind == "worker-request" and isinstance(doc, dict) and "noSafeAction" in doc:
        result["noSafeAction"] = doc["noSafeAction"]
except Exception:
    pass
Path(out).write_text(json.dumps(result, indent=1, sort_keys=True) + "\n")
`;

// The Pack's resolver (knowledge endpoint-resolution.md) reads the Site-only netlist. In the scratch
// workspace, where the Harness would ship hima-readers/atcs-readiness/read-atcs.py, this stand-in
// answers resolve-instances from the instance paths the retained data proves and passes every other
// command to the Pack's own Reader beside it (reported in every Workshop result).
const RESOLVER_PY = String.raw`
import json, os, re, sys
from pathlib import Path
here = Path(__file__).resolve().parent
if len(sys.argv) < 2 or sys.argv[1] != "resolve-instances":
    os.execv(sys.executable, [sys.executable, str(here / "read-atcs.real.py")] + sys.argv[1:])
workspace, endpoints_path, out = sys.argv[2:5]
known = json.load(open(here / "probe-known-instances.json"))
names = set(known["instances"]); masters = known.get("masters", {})
endpoints = json.load(open(endpoints_path))
if isinstance(endpoints, dict):
    endpoints = endpoints.get("endpoints")
if not isinstance(endpoints, list):
    raise ValueError('ENDPOINTS_JSON must be a list of endpoint names or {"endpoints": [...]}')
def spellings(name):
    found = [name]
    bit = re.match(r"^(.*)\[(\d+)\]$", name)
    if bit:
        found += ["%s_%s_" % bit.groups(), "%s_%s" % bit.groups()]
    return found
resolved, unresolved = [], []
for endpoint in endpoints:
    if not isinstance(endpoint, str) or not endpoint.strip():
        unresolved.append({"endpoint": endpoint, "unresolved": "an endpoint must be a non-empty string"}); continue
    name = endpoint.strip(); row = None
    for spelled in spellings(name):
        if spelled in names:
            row = {"instance": spelled, "pin": None, "via": "instance"}; break
    if row is None and "/" in name:
        head, pin = name.rsplit("/", 1)
        if head in names:
            row = {"instance": head, "pin": pin, "via": "pin"}
    if row is None:
        unresolved.append({"endpoint": endpoint, "unresolved": "not an instance or instance pin proven in this probe's retained data (the netlist is Site-only; nets and ports are not resolved here)"})
    else:
        row.update(endpoint=endpoint, cell=masters.get(row["instance"]))
        resolved.append(row)
working = json.load(open(Path(workspace) / "state" / "working-state.json"))
Path(out).write_text(json.dumps({"designStateId": working.get("id"), "top": working.get("top"), "netlist": working.get("netlist"),
    "resolved": resolved, "unresolved": unresolved, "standIn": "probe resolver over retained instance paths, not the netlist"}, indent=1, sort_keys=True) + "\n")
`;

// The 0.2.0 inputs a retained 0.1.9 Run never wrote, derived by the Pack's own code (reported per attempt).
const SEED_PY = String.raw`
import json, sys
from pathlib import Path
flow, workspace, retained_plan, mode = sys.argv[1:5]
sys.path.insert(0, flow)
from atcs import core, workspaces
ws = Path(workspace)
derived = []
def write(rel, obj):
    at = ws / rel
    at.parent.mkdir(parents=True, exist_ok=True)
    at.write_text(json.dumps(obj, indent=2) + "\n")
    derived.append(rel)
if not (ws / "state/worker-slots.json").exists():
    write("state/worker-slots.json", core.stamp("worker-slots", {"workerSlots": len(workspaces.TASK_IDS),
          "activeSlots": list(workspaces.TASK_IDS), "parkedSlots": []}))
out = {"derived": derived}
if mode in ("worker", "team"):
    base = json.loads((ws / "state/working-state.json").read_text())
    old = json.loads(Path(retained_plan).read_text())
    caps = old["siteCapabilities"]
    w01 = {k: v for k, v in old["candidate"]["workPackages"]["w01"].items() if k not in ("schema", "id")}
    w01["baseStateId"] = base["id"]
    w01["editDomain"] = dict(w01["editDomain"], regions=w01["editDomain"].get("regions", []))
    w01["targetPins"] = [t.split("|", 2)[2] for t in w01["targets"] if "/" in t.split("|", 2)[2]]
    w01["scope"] = {"commands": list(workspaces.MUTATE_COMMANDS), "maxMutations": workspaces.SCOPE_MAX_MUTATIONS}
    w01["observe"] = "fast"
    packages = {"w01": w01}
    for slot in workspaces.TASK_IDS[1:]:
        packages[slot] = {"taskId": slot, "baseStateId": base["id"], "parked": True, "problem": "no blocker cluster left for this slot"}
    validated = {slot: workspaces.validate_work_package(package, base, caps) for slot, package in packages.items()}
    write("research/requests/campaign-plan.json", {"candidate": {"workPackages": packages,
          "reason": "the retained w01 blocker cluster; every other slot parked"}, "baseState": base, "siteCapabilities": caps})
    write("state/workers.json", {"workers": {slot: dict({"workPackageId": package["id"], "workPackage": package},
          **({"parked": True} if workspaces.is_parked(package) else {})) for slot, package in validated.items()},
          "requiredSlots": list(workspaces.TASK_IDS)})
    out["w01"] = {k: v for k, v in validated["w01"].items() if k not in ("schema", "id")}
    out["siteCapabilities"] = caps
print(json.dumps(out))
`;
function seed020(dir: string, workspace: string, retainedPlan: string, mode: 'workshop' | 'worker' | 'team'): { derived: string[]; w01?: Record<string, any>; siteCapabilities?: unknown } {
  const script = path.join(dir, 'probe-seed020.py'); if (!existsSync(script)) writeFileSync(script, SEED_PY);
  const ran = spawnSync('/usr/bin/python3', [script, path.join(repoRoot, 'packs', PACK_ID, 'flow'), workspace, retainedPlan, mode], { encoding: 'utf8', timeout: 60_000 });
  if (ran.status !== 0) throw new Error(`seed020 failed (${ran.status}): ${ran.stderr.slice(-2000)}`);
  return JSON.parse(ran.stdout);
}

interface ReaderResult { kind: string; exit: 'ok' | 'refused'; exception?: string; values?: { type: string; value: number | null; unknownReason?: string }[]; problems: string[]; standIns: string[]; admitted: boolean;
  sidecar?: { path: string; text: string }; assumedLibraryCells?: string[]; noSafeAction?: unknown }
function runReader(dir: string, readerFile: string, kind: string, report: string, workspace: string, known: string, extra: readonly string[], label: string): ReaderResult {
  const wrapper = path.join(dir, 'probe-reader.py'); if (!existsSync(wrapper)) writeFileSync(wrapper, READER_PY);
  const out = path.join(dir, `${label}.reader.json`);
  const ran = spawnSync('/usr/bin/python3', [wrapper, readerFile, kind, report, out, workspace, known, ...extra], { encoding: 'utf8', timeout: 120_000 });
  if (ran.status !== 0 || !existsSync(out)) return { kind, exit: 'refused', exception: `reader wrapper failed (${ran.status}): ${ran.stderr.slice(-2000)}`, problems: [], standIns: [], admitted: false };
  return JSON.parse(readFileSync(out, 'utf8')) as ReaderResult;
}

// -------------------------------------------------------------------------------------------------
// Scratch Home: profile, credential, local Site, Pack variant
// -------------------------------------------------------------------------------------------------
async function copyCredential(from: string, to: string): Promise<string> {
  const pnpm = path.join(repoRoot, 'node_modules/.pnpm');
  const dir = readdirSync(pnpm).find((name) => name.startsWith('@deepseek-ai+dsh-credentials-local@'));
  assert.ok(dir, 'the dsh local credential provider is not installed');
  const entry = path.join(pnpm, dir, 'node_modules/@deepseek-ai/dsh-credentials-local/lib/index.js');
  const req = createRequire(entry);
  const { Context, Service } = await import(pathToFileURL(req.resolve('@deepseek-ai/cordis')).href) as any;
  const { LocalCredentialProvider } = await import(pathToFileURL(entry).href) as any;
  const { credentialRef } = await import(pathToFileURL(req.resolve('@deepseek-ai/dsh-credentials')).href) as any;
  const withProvider = async <T>(file: string, fn: (provider: any) => Promise<T>): Promise<T> => {
    const provider = new LocalCredentialProvider(new Context(), { path: file, watch: false });
    const init = provider[Service.init](); const dispose = (await init.next()).value;
    try { await init.next(); return await fn(provider); } finally { if (typeof dispose === 'function') await dispose(); }
  };
  const ref = credentialRef('DEEPSEEK_API_KEY');
  const key = (await withProvider(path.join(from, '.credentials.yaml'), (p) => p.resolve(ref)) as { value?: unknown } | undefined)?.value;
  if (typeof key !== 'string' || key === '') throw new Error('the credential home holds no DEEPSEEK_API_KEY');
  await withProvider(path.join(to, '.credentials.yaml'), (p) => p.set(ref, key));
  return key;
}

interface Scratch { h: HimaHome; packsDir: string; siteInputs: string; sourceDigest: string; variantDigest: string; readerFile: string }
async function scratchHome(entry: string, credentialHome: string, siteCapabilities: unknown): Promise<{ scratch: Scratch; key: string }> {
  const h = await createHimaHome();
  const key = await copyCredential(credentialHome, h.home);
  const packsDir = path.join(h.home, 'hima/packs'); mkdirSync(packsDir, { recursive: true });
  const variant = path.join(packsDir, PACK_ID);
  cpSync(path.join(repoRoot, 'packs', PACK_ID), variant, { recursive: true });
  const graph = parse(readFileSync(path.join(variant, 'graph.yml'), 'utf8')) as { entry: string };
  graph.entry = entry; // the only byte difference from the source Pack
  writeFileSync(path.join(variant, 'graph.yml'), stringify(graph));
  const siteInputs = path.join(h.workspace, 'site-inputs'); mkdirSync(siteInputs, { recursive: true });
  writeFileSync(path.join(siteInputs, 'siteCapabilities.json'), `${JSON.stringify(siteCapabilities, null, 2)}\n`);
  const site = await writeLocalSite(h, {
    allowedWrappers: ['python3', '/usr/bin/python3', ...(loadPack(path.join(repoRoot, 'packs'), PACK_ID).contract.environment?.wrappers ?? [])],
    bindings: { designStateManifest: path.join(siteInputs, 'designStateManifest.json'), analysisContract: path.join(siteInputs, 'analysisContract'),
      siteCapabilities: path.join(siteInputs, 'siteCapabilities.json'), workspaceRoot: h.workspace },
    licences: { innovus: 1, primetime: 1, starrc: 1, xtop: 2 },
  });
  appendFileSync(path.join(h.profileDir, 'cordis.patch.yml'), '\n- id: hima\n  config:\n    sitesDir: ' + JSON.stringify(site.sitesDir)
    + '\n    packsDir: ' + JSON.stringify(packsDir) + '\n    knowledgeDir: ' + JSON.stringify(path.join(h.home, 'hima/knowledge/current')) + '\n');
  // Session titles only; every business request uses the native configured adapter.
  writeFileSync(homePatchFile(h.home), '- id: session-title-llm\n  disabled: true\n');
  const sourceDigest = loadPack(path.join(repoRoot, 'packs'), PACK_ID).folder.digest(packDigestExcludes);
  const variantDigest = loadPack(packsDir, PACK_ID).folder.digest(packDigestExcludes);
  return { scratch: { h, packsDir, siteInputs, sourceDigest, variantDigest, readerFile: path.join(variant, 'tools/read-atcs.py') }, key };
}

// -------------------------------------------------------------------------------------------------
// Child: one document, N attempts, one Home and one Host
// -------------------------------------------------------------------------------------------------
interface AttemptRecord { attempt: number; runId?: string; startedAt: string; wallMs: number; admitted: boolean; outcome: string; refusals: string[];
  tokens: Record<string, number>; modelRequests: number; details: Record<string, unknown> }

function usageOf(agent: Agent | undefined): Record<string, number> {
  const sum: Record<string, number> = {};
  if (!agent) return sum;
  for (const event of agent.session.snapshotEvents()) {
    const usage = (event.data as { usage?: Record<string, unknown> } | undefined)?.usage;
    if (event.type !== 'assistant/message' || !usage || typeof usage !== 'object') continue;
    for (const [k, v] of Object.entries(usage)) if (typeof v === 'number') sum[k] = (sum[k] ?? 0) + v;
  }
  return sum;
}
const addUsage = (a: Record<string, number>, b: Record<string, number>) => { for (const [k, v] of Object.entries(b)) a[k] = (a[k] ?? 0) + v; return a; };

async function child(opts: Options): Promise<void> {
  const doc = opts.child!;
  const dir = path.join(opts.out, doc); mkdirSync(dir, { recursive: true });
  const privateRoot = realpathSync(mkdtempSync(path.join('/tmp', `hima-probe-${doc}-`)));
  process.env.TMPDIR = privateRoot; process.env.TMUX_TMPDIR = privateRoot; delete process.env.TMUX; delete process.env.SSH_AUTH_SOCK;
  delete process.env.HIMA_TEST_LEGACY_AUTO_DRIVE; process.env.DSH_TELEMETRY_DISABLED = '1'; delete process.env.DEEPSEEK_API_KEY;
  if (doc === 'team') { process.env.NODE_TEST_CONTEXT = '1'; process.env.HIMA_TEST_SILENT_AGENT = '1'; } // owner is identity only
  else { delete process.env.NODE_TEST_CONTEXT; delete process.env.HIMA_TEST_SILENT_AGENT; } // production owner notifications
  let key = '';
  for (const stream of [process.stdout, process.stderr]) {
    const write = stream.write.bind(stream);
    stream.write = ((chunk: unknown, ...rest: unknown[]) => {
      const text = typeof chunk === 'string' ? chunk : Buffer.isBuffer(chunk) ? chunk.toString('utf8') : String(chunk);
      return Reflect.apply(write, stream, [key ? text.split(key).join('[REDACTED]') : text, ...rest]) as boolean;
    }) as typeof stream.write;
  }
  const clean = <T>(value: T): T => (key ? JSON.parse(JSON.stringify(value).split(key).join('[REDACTED]')) as T : value);
  const retained = readRetained(opts.retained);
  const known: Record<string, unknown> & { top: string; instances: string[] } = { top: '', ...knownInstances(retained) };
  const pack = loadPack(path.join(repoRoot, 'packs'), PACK_ID);
  const outputPath = (name: string) => { const output = pack.contract.outputs.find((item) => item.name === name); assert.ok(output, `no output ${name}`); return output.path; };
  // The Site capabilities the retained Run's Workshops stamped (siteCapabilities of its latest worker request).
  const latestRequest = retained.items.filter((item) => item.kind === 'observation' && item.path.endsWith(`/${outputPath('workerRequest01')}`)).at(-1);
  assert.ok(latestRequest, 'the retained Run holds no worker request observation');
  const requestDoc = JSON.parse(retainedBytes(retained, latestRequest.sha).toString('utf8')) as Record<string, any>;
  known.top = requestDoc.baseState.top;
  const eco = requestDoc.siteCapabilities?.xtopContext?.ecoParameters ?? {};
  known.eco = eco;
  for (const list of ['bufferListForSetup', 'bufferListForHold']) for (const cell of eco[list] ?? []) (known.cells as string[]).push(cell);
  known.cells = [...new Set(known.cells as string[])].sort();
  const knownFile = path.join(dir, 'known-instances.json'); writeFileSync(knownFile, `${JSON.stringify(known, null, 1)}\n`);
  const latestPlan = retained.items.filter((item) => item.kind === 'observation' && item.path.endsWith(`/${outputPath('campaignPlan')}`)).at(-1);
  assert.ok(latestPlan, 'the retained Run holds no campaign plan observation');
  const retainedPlanFile = path.join(dir, 'retained-campaign-plan.json'); writeFileSync(retainedPlanFile, retainedBytes(retained, latestPlan.sha));
  const entry = doc === 'team' ? 'operate-worker-01' : WORKSHOPS[doc as WorkshopDoc].node;
  const { scratch, key: copied } = await scratchHome(entry, opts.credentialHome, requestDoc.siteCapabilities); key = copied;
  const summary: Record<string, unknown> = { document: doc, startedAt: now(), sourceSha: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repoRoot, encoding: 'utf8' }).trim(),
    dirty: execFileSync('git', ['status', '--short'], { cwd: repoRoot, encoding: 'utf8' }).trim(), node: process.version,
    pack: { id: PACK_ID, version: pack.contract.version, sourceDigest: scratch.sourceDigest, installedVariantDigest: scratch.variantDigest,
      variant: `graph.yml entry = ${entry} (only difference)`, readerSha256: sha256(readFileSync(scratch.readerFile)) },
    resolverStandIn: doc === 'team' ? undefined : 'hima-readers/atcs-readiness/read-atcs.py answers resolve-instances from retained instance paths; every other command runs the Pack Reader',
    retained: { home: opts.retained, runId: retained.runId, ledgerSha256: retained.ledgerSha256 }, scratchHome: scratch.h.home, privateRoot,
    readerStandIns: { knownInstances: known.instances.length, provenMasters: Object.keys(known.masters as object).length, provenCells: (known.cells as string[]).length, top: known.top } };
  const attempts: AttemptRecord[] = [];
  const write = () => writeFileSync(path.join(dir, 'result.json'), `${JSON.stringify(clean({ ...summary, attempts }), null, 2)}\n`);
  write();
  process.chdir(scratch.h.workspace);
  const host = await bootInProcess(scratch.h);
  const policy = new Map<string, { kind: 'workshop'; runId: string; node: string } | { kind: 'silent' }>();
  const denied: unknown[] = []; const steps = new Map<string, number>(); const toolLog: unknown[] = [];
  host.ctx.tools.guard((execution: any) => {
    const agentId = String(execution.agent?.id ?? ''); const name = execution.name as string; const args = (execution.arguments ?? {}) as Record<string, unknown>;
    const refuse = (reason: string) => { denied.push({ at: now(), agent: agentId, name, action: args.action, reason }); return reason; };
    const rule = policy.get(agentId);
    if (rule === undefined) return name === 'hima_delegation_input' ? undefined : refuse('this probe permits a delegated child only hima_delegation_input');
    if (rule.kind === 'silent') return refuse('this probe keeps the Team owner silent; it is an identity only');
    if (name === 'hima_context' && args.run === rule.runId) return undefined;
    if (name !== 'hima_execute' || args.run !== rule.runId) return refuse(`this probe permits only hima_execute/hima_context on Run ${rule.runId} node ${rule.node}`);
    const action = String(args.action);
    if (!['begin', 'recommend', 'read', 'knowledge', 'write', 'work', 'complete'].includes(action)) return refuse(`this probe permits only the Workshop actions of node ${rule.node}`);
    if (action === 'begin' && args.nodeId !== rule.node) return refuse(`this probe permits beginning only node ${rule.node}`);
    return undefined;
  });
  host.ctx.on('agent/request', async ({ agent }: any, next: any) => {
    const id = String(agent.id); const count = (steps.get(id) ?? 0) + 1; steps.set(id, count);
    if (count > 120) { cancelTestAgent(agent, 'probe model-step budget exceeded'); throw new Error('probe model-step budget exceeded'); }
    return next();
  });
  host.ctx.on('tools/result', (execution: any, result: any) => {
    toolLog.push(clean({ at: now(), agent: String(execution.agent?.id ?? ''), name: execution.name, action: execution.arguments?.action, isError: result?.isError === true }));
    return undefined;
  });
  const ledger = host.ctx.hima.ledger;
  const goal = { target_setup_wns_ns: 0, target_hold_wns_ns: 0, max_physical_refreshes: 1 };
  try {
    for (let attempt = 1; attempt <= opts.attempts; attempt++) {
      const started = Date.now();
      const record: AttemptRecord = { attempt, startedAt: now(), wallMs: 0, admitted: false, outcome: 'not-run', refusals: [], tokens: {}, modelRequests: 0, details: {} };
      attempts.push(record); write();
      try {
        if (doc === 'team') await teamAttempt(record);
        else await workshopAttempt(doc as WorkshopDoc, record);
      } catch (error) {
        record.outcome = 'probe-error'; record.refusals.push(`probe error: ${String((error as Error)?.stack ?? error).slice(0, 2000)}`);
      } finally {
        record.wallMs = Date.now() - started;
        if (record.runId) { try { await host.ctx.hima.cancelRun(record.runId); } catch { /* already ended */ } }
        spawnSync('tmux', ['-S', path.join(privateRoot, `tmux-${process.getuid!()}`, 'default'), 'kill-server'], { stdio: 'ignore', timeout: 5000 });
        write();
      }
    }
  } finally {
    summary.deniedTools = denied; summary.toolLog = toolLog; summary.finishedAt = now();
    write();
    try { await host.dispose(); } catch (error) { summary.disposeError = String(error); }
    const scan = await scanForSecret([dir, scratch.h.home, privateRoot], key);
    for (const at of scan.holding) writeFileSync(at, readFileSync(at).toString('utf8').split(key).join('[REDACTED]'));
    summary.secretScan = { files: scan.files.length, holdingBeforeRedaction: scan.holding.filter((at) => !at.endsWith('.credentials.yaml')).length, unreadable: scan.unreadable.length };
    write();
  }

  // ---------------- Workshop attempt -------------------------------------------------------------
  async function workshopAttempt(docId: WorkshopDoc, record: AttemptRecord): Promise<void> {
    const spec = WORKSHOPS[docId];
    const declaration = pack.contract.workshops.find((item) => item.id === docId); assert.ok(declaration);
    const snapshot = workshopSnapshot(retained, docId, declaration.reads, outputPath);
    const attemptStart = Date.now();
    const owner = await createRootAgent(host.ctx, scratch.h.workspace); const actor = String(owner.id);
    const run = await host.ctx.hima.startRun({ pack: PACK_ID, site: 'local', goal, ownerSessionId: actor, timeBoxMs: 4 * 3_600_000, retryAllowance: 2 } as any);
    if (run.kind !== 'ran') throw new Error(`Run not admitted: ${JSON.stringify(run)}`);
    const runId = run.run.id; record.runId = runId; const workspace = run.workspace!;
    for (const file of snapshot.files) {
      const at = path.join(workspace, file.rel); mkdirSync(path.dirname(at), { recursive: true });
      writeFileSync(at, retainedBytes(retained, file.sha));
    }
    // Where the Harness ships the Pack's Reader for the Run's first reader (knowledge endpoint-resolution.md).
    const readers = path.join(workspace, 'hima-readers/atcs-readiness'); mkdirSync(readers, { recursive: true });
    writeFileSync(path.join(readers, 'read-atcs.py'), RESOLVER_PY);
    cpSync(scratch.readerFile, path.join(readers, 'read-atcs.real.py'));
    cpSync(knownFile, path.join(readers, 'probe-known-instances.json'));
    const seeded = seed020(dir, workspace, retainedPlanFile, docId === 'research-worker-01' ? 'worker' : 'workshop');
    const produced = path.join(workspace, outputPath(declaration.produces));
    assert.equal(existsSync(produced), false, 'the output must not be seeded');
    record.details.snapshot = { basis: snapshot.basis, files: snapshot.files, unavailable: snapshot.unavailable, derived020: seeded.derived, workspace };
    policy.set(actor, { kind: 'workshop', runId, node: spec.node });
    const prompt = `You own Campaign Run ${runId} (Pack ${PACK_ID}, Site local). Its current node is ${spec.node}, the Workshop ${docId}. `
      + `Carry out exactly this one node now, as you would inside the Campaign: read hima_context for the epoch and revision, begin ${spec.node}, `
      + `use recommend with the returned executionId, read the declared inputs and Pack knowledge you need, write the entry, work it once, `
      + `check its Job (hima_context, or read output @job-log), and complete the execution once the Job has written the declared output. `
      + `Begin no other node and change nothing else; when this node is complete, stop and report in one short paragraph.`;
    const deadline = Date.now() + opts.attemptMs;
    const nudges: string[] = [];
    const turn = async (text: string) => { await Promise.race([sayAsUser(owner, text), sleep(Math.max(1, deadline - Date.now()))]); };
    await turn(prompt);
    let settled = await settle(owner, runId, deadline);
    if (!existsSync(produced) && settled === 'settled' && Date.now() < deadline - 60_000) {
      const nudge = `Node ${spec.node} of Run ${runId} has not written its declared output ${outputPath(declaration.produces)} yet. Finish this node now: begin its next available attempt if the last one failed, write the entry, work it once, and complete it when the Job has written the output.`;
      nudges.push(nudge); await turn(nudge); settled = await settle(owner, runId, deadline);
    }
    if (settled !== 'settled') cancelTestAgent(owner, 'probe attempt deadline');
    const executions = Object.values(ledger.run(runId)?.control?.executions ?? {}).filter((item: any) => item.nodeId === spec.node)
      .map((item: any) => ({ id: item.id, attempt: item.attempt, phase: item.phase, result: item.result?.kind ?? item.result?.outcome, reason: item.reason }));
    const jobs = ledger.records({ runId, type: 'job' }).map((item: any) => ({ seq: item.seq, event: item.event, name: item.job?.name, exit: item.exitCode ?? item.exit ?? item.job?.exitCode }));
    record.tokens = usageOf(owner); record.modelRequests = steps.get(actor) ?? 0;
    record.details = { ...record.details, settled, nudges, executions, jobs, calls: toolCalls(owner).map((call) => ({ name: call.name, action: call.args.action, path: call.args.path, output: call.args.output, file: call.args.file })),
      said: saidByModel(owner).map((text) => text.slice(0, 1500)), failedToolResults: toolResults(owner).filter((item) => item.failed).map((item) => item.text.slice(0, 600)) };
    // Keep the authored code for review (the entry and helpers under the Workshop directory).
    const workshopDir = path.join(workspace, declaration.directory);
    if (existsSync(workshopDir)) cpSync(workshopDir, path.join(dir, `attempt-${record.attempt}-workshop`), { recursive: true });
    if (!existsSync(produced) || statSync(produced).mtimeMs < attemptStart) {
      record.outcome = 'no-output'; record.refusals.push(`Workshop wrote no ${outputPath(declaration.produces)} (executions: ${JSON.stringify(executions)})`);
      cancelTestAgent(owner, 'probe attempt finished'); return;
    }
    const bytes = readFileSync(produced); cpSync(produced, path.join(dir, `attempt-${record.attempt}-${path.basename(produced)}`));
    record.details.output = { path: outputPath(declaration.produces), sha256: sha256(bytes), bytes: bytes.length };
    const read = runReader(dir, scratch.readerFile, spec.kind, produced, workspace, knownFile, spec.extra, `attempt-${record.attempt}`);
    record.details.reader = read;
    record.admitted = read.admitted;
    record.outcome = read.admitted ? (read.noSafeAction !== undefined ? 'admitted (noSafeAction)' : 'admitted') : 'refused';
    if (!read.admitted) {
      if (read.exception) record.refusals.push(read.exception);
      const counts = (read.values ?? []).map((value) => `${value.type}=${value.value}${value.unknownReason ? ` (${value.unknownReason})` : ''}`);
      if (counts.length) record.refusals.push(`Reader values: ${counts.join('; ')}`);
      record.refusals.push(...read.problems);
      if (read.sidecar) record.details.sidecar = read.sidecar;
    }
    cancelTestAgent(owner, 'probe attempt finished');
  }

  async function settle(owner: Agent, runId: string, deadline: number): Promise<'settled' | 'timeout'> {
    let quietSince = 0;
    while (Date.now() < deadline) {
      const idle = await Promise.race([owner.whenIdle().then(() => true), sleep(1000).then(() => false)]);
      const records = ledger.records({ runId, type: 'job' }) as any[];
      const open = new Set<string>();
      for (const item of records) { const session = item.job?.session; if (!session) continue; if (item.event === 'launched') open.add(session); else open.delete(session); }
      const working = Object.values(ledger.run(runId)?.control?.executions ?? {}).some((item: any) => item.phase === 'working');
      if (idle && open.size === 0 && !working) { quietSince ||= Date.now(); if (Date.now() - quietSince > 8000) return 'settled'; }
      else quietSince = 0;
      await sleep(500);
    }
    return 'timeout';
  }

  // ---------------- Team attempt -----------------------------------------------------------------
  async function teamAttempt(record: AttemptRecord): Promise<void> {
    const team = pack.contract.agentTeams.find((item) => item.id === 'atcs-worker-01'); assert.ok(team);
    const researcherSpec = team.members.find((item) => item.id === 'researcher')!; const reviewerSpec = team.members.find((item) => item.id === 'reviewer')!;
    // Input (0.2.0): slot w01's request for the package seed020 derives from the retained w01 package, with
    // the retained request's evidence and prediction and one sessionPlan move per retained action (the
    // ECO that really ran, from the sealed Contribution when the request names none).
    const owner = await createRootAgent(host.ctx, scratch.h.workspace); const actor = String(owner.id);
    policy.set(actor, { kind: 'silent' });
    const run = await host.ctx.hima.startRun({ pack: PACK_ID, site: 'local', goal, ownerSessionId: actor, timeBoxMs: 4 * 3_600_000 } as any);
    if (run.kind !== 'ran') throw new Error(`Run not admitted: ${JSON.stringify(run)}`);
    const runId = run.run.id; record.runId = runId; const workspace = run.workspace!;
    const seedAt = (rel: string, bytes: Buffer) => { const at = path.join(workspace, rel); mkdirSync(path.dirname(at), { recursive: true }); writeFileSync(at, bytes); return at; };
    const before = (name: string) => retained.items.filter((item) => item.seq < latestRequest!.seq && item.path.endsWith(`/${outputPath(name)}`)).at(-1);
    for (const name of ['workingState']) { const item = before(name); assert.ok(item, `no retained ${name}`); seedAt(outputPath(name), retainedBytes(retained, item.sha)); }
    const seeded = seed020(dir, workspace, retainedPlanFile, 'team');
    let actions: { instance: string; toMaster: string }[] = Array.isArray(requestDoc.actions) ? requestDoc.actions : [];
    let derivedActions = false;
    if (actions.length === 0) {
      const contributionItem = retained.items.filter((item) => item.kind === 'observation' && item.path.endsWith(`/${outputPath('workerResult01')}`)).at(-1);
      assert.ok(contributionItem, 'no retained Contribution to derive worker actions from');
      const contribution = JSON.parse(retainedBytes(retained, contributionItem.sha).toString('utf8'));
      actions = contribution.operations.filter((op: any) => op.op === 'size_cell').map((op: any) => ({ instance: op.instance, toMaster: op.toMaster }));
      derivedActions = true;
    }
    const request: Record<string, any> = { candidate: seeded.w01, baseState: JSON.parse(readFileSync(path.join(workspace, outputPath('workingState')), 'utf8')),
      siteCapabilities: seeded.siteCapabilities,
      sessionPlan: actions.map((action) => ({ command: 'atcs_size_cell', object: action.instance,
        hypothesis: `size ${action.instance} to ${action.toMaster}: the retained evidence says its cell delay dominates the target paths`,
        falsifier: 'atcs_gain shows no setup gain at the targets, or hold breaks; then atcs_undo' })),
      ...(requestDoc.evidence === undefined ? {} : { evidence: requestDoc.evidence }), ...(requestDoc.prediction === undefined ? {} : { prediction: requestDoc.prediction }) };
    const requestBytes = Buffer.from(`${JSON.stringify(request, null, 2)}\n`); const requestSha = sha256(requestBytes);
    const planPath = seedAt(outputPath('workerRequest01'), requestBytes);
    const inputRead = runReader(dir, scratch.readerFile, 'worker-request', planPath, workspace, knownFile, ['w01'], `attempt-${record.attempt}-team-input`);
    record.details.input = { retainedRequestSha256: latestRequest!.sha, derived020: seeded.derived, derivedActions, actions, requestSha256: requestSha, readerAdmitsInput: inputRead.admitted, inputReader: inputRead };
    const retainedPath = await retainRunMaterial({ ledger, packsDir: scratch.packsDir }, runId, requestBytes, requestSha); assert.ok(retainedPath);
    const reader = pack.contract.outputs.find((item) => item.name === 'workerRequest01')!.reader!;
    await ledger.appendObservation(runId, { path: planPath, contentSha256: requestSha, retainedPath, bytes: requestBytes.length,
      reader: { id: reader, version: '1', reportKind: 'atcs-worker-request/1', emits: ['tc_request_invalid_count'] }, values: [] } as any);
    const control = () => ledger.run(runId)!.control!;
    const begun = await host.ctx.hima.executionAction({ runId, actor, action: 'begin', nodeId: 'operate-worker-01', requestId: 'probe-begin', expectedEpoch: control().epoch, expectedRevision: control().revision });
    if (begun.kind !== 'accepted') throw new Error(`begin operate-worker-01 refused: ${JSON.stringify(begun)}`);
    const executionId = begun.receipt!.executionId!;
    const deps = (host.ctx.hima as any).deps();
    let serial = 0;
    const delegate = (body: Record<string, unknown>) => host.ctx.hima.delegate({ runId, actor, requestId: `probe-${++serial}`, expectedEpoch: control().epoch, expectedRevision: control().revision, ...body } as never) as Promise<any>;
    const tokens: Record<string, number> = {}; let requests = 0;
    const memberRecords: Record<string, unknown>[] = [];
    record.details.members = memberRecords; // kept even when a later step throws
    const member = async (memberId: 'researcher' | 'reviewer', maxFollowups: number) => {
      const out: Record<string, unknown> = { memberId };
      const created = await delegate({ action: 'create', recipe: { teamId: team.id, version: team.version, memberId, executionId } });
      out.create = { status: created.status, reason: created.reason };
      if (created.status !== 'created') { out.admitted = false; out.refusal = `create refused: ${created.reason ?? JSON.stringify(created)}`; return out; }
      const delegationId = created.effectiveContract.delegationId as string; const childId = created.receipt.childSessionId as string;
      // Read the child's own durable session log (the Host's result path reads the same one): a
      // follow-up may continue the child in a fresh native handle, so a held Agent object goes stale.
      const query = host.ctx.get('sessionQuery' as never) as unknown as { readSession(id: string): Promise<{ events: { type: string; seq: number; data?: any }[] }> };
      const events = async () => (await query.readSession(childId)).events;
      const answers: unknown[] = [];
      memberRecords.push(out); out.answers = answers; out.delegationId = delegationId;
      for (let turnIndex = 0; turnIndex <= maxFollowups; turnIndex++) {
        const until = Date.now() + (memberId === 'researcher' ? researcherSpec : reviewerSpec).budgetShare.maxElapsedMs + 30_000;
        let log = await events();
        while (log.filter((event) => event.type === 'turn/end').length <= turnIndex) {
          if (Date.now() > until) { answers.push({ turn: turnIndex + 1, status: 'no-turn', reason: `turn ${turnIndex + 1} did not end within the member budget` }); break; }
          await sleep(1000); log = await events();
        }
        const ends = log.filter((event) => event.type === 'turn/end');
        if (ends.length <= turnIndex) { out.admitted = false; out.refusal = `${out.refusal ?? ''} ${turnIndex > 0 ? 'the follow-up' : 'the child'} produced no completed turn within the member budget`.trim(); break; }
        const result = await delegate({ action: 'result', delegationId });
        const last = log.filter((event) => event.type === 'assistant/message').at(-1)?.data?.message?.content as { type: string; text?: string }[] | undefined;
        const text = (last ?? []).filter((block) => block.type === 'text').map((block) => block.text ?? '').join('\n');
        answers.push({ turn: turnIndex + 1, status: result.status, reason: result.reason, text: text.slice(0, 4000), end: ends.at(-1)?.data });
        if (result.status === 'candidate' || result.status === 'accepted') { out.admitted = true; out.text = text; break; }
        out.admitted = false; out.refusal = result.reason ?? `result status ${result.status}: ${JSON.stringify(result.unknowns ?? [])}`;
        if (turnIndex < maxFollowups && result.status === 'refused') {
          const followup = await delegate({ action: 'followup', delegationId, text: `The owner refuses this reply: ${result.reason} Answer with the corrected single JSON object only.` });
          out.followup = { status: followup.status, reason: followup.reason };
          if (followup.status === 'refused') { out.followupRefused = followup.reason; break; }
        }
      }
      const finalLog = await events();
      for (const event of finalLog) if (event.type === 'assistant/message' && event.data?.usage) for (const [k, v] of Object.entries(event.data.usage)) if (typeof v === 'number') tokens[k] = (tokens[k] ?? 0) + v;
      requests += finalLog.filter((event) => event.type === 'assistant/message').length;
      out.calls = finalLog.flatMap((event) => event.type === 'assistant/message' ? ((event.data?.message?.content ?? []) as { type: string; name?: string }[]).filter((block) => block.type === 'tool-call').map((block) => block.name) : []);
      out.answers = answers; out.delegationId = delegationId;
      return out;
    };
    const adopt = async (delegationId: string) => {
      const row = runDelegations(deps, runId).find((item: any) => item.delegationId === delegationId) as any;
      return delegate({ action: 'adopt', delegationId, resultRecordId: row?.resultRecordId });
    };
    // Researcher, then the Reviewer on its adopted result (a stand-in researcher result when the real one was refused).
    const researcher = await member('researcher', researcherSpec.budgetShare.maxFollowups);
    if (researcher.admitted) researcher.adoption = (await adopt(researcher.delegationId as string)).status;
    else {
      const row = runDelegations(deps, runId).find((item: any) => item.effective.recipe?.memberId === 'researcher') as any;
      if (row) {
        const text = JSON.stringify({ schema: researcherSpec.resultSchema.id, hypotheses: ['stand-in: the probed researcher result was refused'], evidenceRefs: row.effective.inputRefs, limitations: ['probe stand-in'] });
        const standIn = await ledger.appendDelegation(runId, { delegationId: row.delegationId, parentSessionId: actor, childSessionId: row.childSessionId, requestId: `probe-standin-${record.attempt}`, requestDigest: 'a'.repeat(64),
          event: 'result-observed', payload: { candidate: true, source: 'native-live-session', handoff: { outputIdentity: sha256(JSON.stringify([{ type: 'text', text }])),
            contract: { recordId: row.contractRecordId, requestDigest: row.requestDigest }, output: { text, content: [{ type: 'text', text }], truncated: false }, completedTurn: { turn: 1, endSeq: 1 },
            unknowns: [], evidence: { artifactRefs: [], diffRefs: [], testRefs: [], limitations: ['probe stand-in'] } } } } as any);
        researcher.standInAdoption = (await delegate({ action: 'adopt', delegationId: row.delegationId, resultRecordId: standIn.id })).status;
      }
    }
    const reviewer = await member('reviewer', reviewerSpec.budgetShare.maxFollowups);
    // The Host's reviewed-scope checks at Operator creation (index.ts), applied to the reviewer's answer.
    if (reviewer.admitted) {
      const failures: string[] = [];
      let payload: Record<string, any> = {};
      try { payload = JSON.parse(String(reviewer.text)); } catch { failures.push('The reviewed action must be one JSON object.'); }
      const operator = team.members.find((item) => item.id === 'operator')!; const reviewed = operator.reviewedAction! as any;
      assert.equal(reviewed.mode, 'scope', 'the 0.2.0 worker Team reviews a scope');
      const tool = pack.contract.tools.find((item) => item.id === 'xtop-operator')!;
      if (payload.schema !== reviewerSpec.resultSchema.id || reviewerSpec.resultSchema.required.some((field) => !(field in payload))) failures.push('The reviewed action does not satisfy its Pack result schema.');
      if (payload[reviewed.planHashField] !== requestSha) failures.push('The reviewed scope plan SHA-256 differs from the current reader-backed plan.');
      const problem = reviewedScopeProblem(payload[reviewed.scopeField], reviewed);
      if (problem !== undefined) failures.push(`${problem[0]!.toUpperCase()}${problem.slice(1)}.`);
      else {
        const commands = payload[reviewed.scopeField].commands as string[];
        const untyped = commands.filter((command) => !tool.interactive!.commands.mutate.includes(command)
          || !tool.interactive!.arguments[command]?.some((item) => item.name === reviewed.hostPlanHashArgument && item.type === 'string'));
        if (untyped.length > 0) failures.push(`The reviewed scope names commands that are not hash-bearing mutations of the Operator tool: ${untyped.join(', ')}.`);
        reviewer.scope = payload[reviewed.scopeField];
        // The Pack's own rule (reviewer taskTemplate), reported but not a Host refusal: atcs_undo is always approved.
        reviewer.scopeKeepsUndo = commands.includes('atcs_undo');
      }
      reviewer.operatorCreationChecks = failures.length === 0 ? 'pass' : failures;
      if (failures.length) { reviewer.admitted = false; reviewer.refusal = failures.join(' '); }
    }
    record.tokens = tokens; record.modelRequests = requests;
    record.details = { ...record.details, researcher, reviewer };
    record.admitted = researcher.admitted === true && reviewer.admitted === true;
    record.outcome = `researcher ${researcher.admitted ? 'admitted' : 'refused'}; reviewer ${reviewer.admitted ? 'admitted' : 'refused'}`;
    if (!researcher.admitted) record.refusals.push(`researcher: ${researcher.refusal}`);
    if (!reviewer.admitted) record.refusals.push(`reviewer: ${reviewer.refusal}`);
  }
}

// -------------------------------------------------------------------------------------------------
// Parent: one child process per document, then the JSON + Markdown report
// -------------------------------------------------------------------------------------------------
function classify(text: string): string {
  if (/^probe error/i.test(text)) return 'probe';
  if (/no output|wrote no|not written|no completed turn/i.test(text)) return 'workshop-execution';
  if (/hierarch|leaf|outside the admitted edit domain/i.test(text)) return 'hierarchy';
  if (/baseStateId|base state id|id mismatch|does not resolve|stale|stateRef|observationRef|designStateId|plan SHA|working state id|not one action/i.test(text)) return 'identity';
  if (/JSON|Expecting|decode|must return one|parse/i.test(text)) return 'format';
  if (/missing|must be|must contain|must have|schema|taskId|not one of|required|satisfy|violates|differ/i.test(text)) return 'schema';
  return 'other';
}

async function parent(opts: Options): Promise<void> {
  if (existsSync(opts.out)) throw new Error(`the evidence directory already exists: ${opts.out}`);
  mkdirSync(opts.out, { recursive: true });
  const startedAt = now();
  const queue = [...opts.only]; const running = new Set<Promise<void>>();
  const launch = (doc: Doc) => new Promise<void>((resolve) => {
    const log = path.join(opts.out, `${doc}.log`);
    const childProcess = spawn(process.execPath, [SELF, '--child', doc, '--out', opts.out, '--retained', opts.retained, '--credential-home', opts.credentialHome,
      '--attempts', String(opts.attempts), '--attempt-minutes', String(opts.attemptMs / 60_000)], { cwd: repoRoot, stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env } });
    childProcess.stdout.on('data', (chunk) => appendFileSync(log, chunk)); childProcess.stderr.on('data', (chunk) => appendFileSync(log, chunk));
    childProcess.on('exit', (code) => { appendFileSync(log, `\n[child exit ${code}]\n`); process.stdout.write(`${doc}: child exit ${code}\n`); resolve(); });
  });
  while (queue.length || running.size) {
    while (queue.length && running.size < opts.concurrency) {
      const doc = queue.shift()!; process.stdout.write(`${doc}: started\n`);
      const task = launch(doc).finally(() => running.delete(task)); running.add(task);
    }
    await Promise.race(running);
  }
  const results = opts.only.map((doc) => {
    const file = path.join(opts.out, doc, 'result.json');
    return existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : { document: doc, attempts: [], error: 'no result written; see the child log' };
  });
  const rows = results.map((result: any) => {
    const attempts = result.attempts as AttemptRecord[];
    const admitted = attempts.filter((item) => item.admitted).length;
    const tokens = attempts.reduce((sum, item) => addUsage(sum, item.tokens ?? {}), {} as Record<string, number>);
    return { document: result.document, attempts: attempts.length, admitted, rate: attempts.length ? admitted / attempts.length : 0, tokens,
      wallMs: attempts.reduce((sum, item) => sum + (item.wallMs ?? 0), 0), modelRequests: attempts.reduce((sum, item) => sum + (item.modelRequests ?? 0), 0),
      refusals: attempts.flatMap((item) => item.refusals.map((text) => ({ attempt: item.attempt, class: classify(text), text }))) };
  });
  // The Team document admits only when both members do; each member's own rate is its own row.
  for (const result of results as any[]) {
    if (result.document !== 'team') continue;
    for (const role of ['researcher', 'reviewer']) {
      const attempts = result.attempts as AttemptRecord[];
      const member = (item: AttemptRecord) => (item.details as any)?.[role];
      const admitted = attempts.filter((item) => member(item)?.admitted === true).length;
      rows.push({ document: `team ${role}`, attempts: attempts.length, admitted, rate: attempts.length ? admitted / attempts.length : 0, tokens: {}, wallMs: 0,
        modelRequests: 0, refusals: attempts.filter((item) => member(item)?.admitted !== true).map((item) => {
          const text = String(member(item)?.refusal ?? 'not run'); return { attempt: item.attempt, class: classify(text), text }; }) });
    }
  }
  const report = { check: 'probe-atcs-workshops', startedAt, finishedAt: now(), options: { attempts: opts.attempts, only: opts.only, concurrency: opts.concurrency, attemptMinutes: opts.attemptMs / 60_000 },
    pack: (results.find((item: any) => item.pack) as any)?.pack, sourceSha: (results.find((item: any) => item.sourceSha) as any)?.sourceSha, rows, results };
  writeFileSync(path.join(opts.out, 'report.json'), `${JSON.stringify(report, null, 2)}\n`);
  const tokenText = (tokens: Record<string, number>) => Object.entries(tokens).map(([k, v]) => `${k} ${v}`).join(', ') || 'unreported';
  const md = [`# ATCS real-model Workshop probe`, '', `Started ${startedAt}, finished ${report.finishedAt}. Source ${report.sourceSha}. Pack ${report.pack?.id} ${report.pack?.version}, source digest ${report.pack?.sourceDigest}; each document ran on an installed copy differing only in graph.yml entry (per-document digests in report.json). Reader ${report.pack?.readerSha256}.`, '',
    '| Document | Admitted | Rate | Model requests | Tokens | Wall (s) |', '|---|---|---|---|---|---|',
    ...rows.map((row) => `| ${row.document} | ${row.admitted}/${row.attempts} | ${(row.rate * 100).toFixed(0)}% | ${row.modelRequests} | ${tokenText(row.tokens)} | ${(row.wallMs / 1000).toFixed(0)} |`), '',
    '## Refusals (exact text)', '',
    ...rows.flatMap((row) => row.refusals.length === 0 ? [] : [`### ${row.document}`, '', ...row.refusals.map((item) => `- attempt ${item.attempt} [${item.class}]: ${item.text.replace(/\n/g, ' ')}`), '']),
    '## Reader sidecars of refused documents', '',
    ...results.flatMap((result: any) => (result.attempts as AttemptRecord[]).filter((item) => (item.details as any)?.sidecar).map((item) => `### ${result.document} attempt ${item.attempt}\n\n\`\`\`\n${(item.details as any).sidecar.text.trim()}\n\`\`\`\n`)),
    '## Stand-ins', '', '- Reader: the design-state file re-hash is skipped (database, netlist, DEF, SPEF and SDC bytes live only on the Site).',
    '- Reader: the netlist hierarchy is built from instance paths proven in the retained data; a leaf carries its master where the retained data proves it.',
    '- Reader (C13): library membership is proven for retained cells and assumed for other names following the Site sizing pattern (listed per result); the function/VT check runs where the current master is proven.',
    '- Workshop: hima-readers/atcs-readiness/read-atcs.py answers resolve-instances from the retained instance paths; all other commands run the Pack Reader.', ''].join('\n');
  writeFileSync(path.join(opts.out, 'report.md'), md);
  process.stdout.write(`${md}\n\nevidence: ${opts.out}\n`);
}

const opts = options();
if (opts.child) await child(opts); else await parent(opts);
process.exit(0);
