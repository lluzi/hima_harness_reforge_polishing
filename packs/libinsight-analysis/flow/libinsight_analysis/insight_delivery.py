"""One command from an insight rule to a checked `hima-libinsight-analysis/1` delivery.

    libinsight_cli.py insight-delivery (--rule RULE_ID | --module analysis/FILE.py) [--root DIR]
        [--version N] [--prepared PATH] -- RULE ARGUMENTS...

It runs the rule (one of the Pack's example rules under `rules/`, or a rule module the resident wrote
under `analysis/`) with the given arguments, then writes into ROOT (the resident's private workspace):

- `analysis/<rule>/...`: the exact code that ran (the rule module and the helper modules it uses) and
  the rule JSON it wrote;
- `analysis-result.json`: the delivery, with the rule as its `insight` block, a table of the flagged
  items, every facts file hashed before and after as a source, the code and the command;
- `resident-delivery.json`: the delivery candidate.

It then runs the delivery check and prints `accepted ...` or one problem per line (exit 1).
"""
import json
import os
import shutil
import subprocess
import sys
import time

from . import common, delivery

FLOW = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
RULES = os.path.join(FLOW, "libinsight_analysis", "rules")
HELPERS = ("facts.py", "netlists.py")
MAX_ROWS = 2000


class UsageError(Exception):
    pass


def _parse(argv):
    if "--" not in argv:
        raise UsageError("insight-delivery (--rule RULE_ID | --module FILE) [--root DIR] [--version N] [--prepared PATH] -- RULE ARGUMENTS")
    split = argv.index("--")
    own, rule_args = argv[:split], argv[split + 1:]
    opts = {"root": ".", "rule": None, "module": None, "version": None, "prepared": None}
    i = 0
    while i < len(own):
        key = own[i]
        if key not in ("--root", "--rule", "--module", "--version", "--prepared") or i + 1 >= len(own):
            raise UsageError("unknown or incomplete option %r" % key)
        opts[key[2:]] = own[i + 1]
        i += 2
    if (opts["rule"] is None) == (opts["module"] is None):
        raise UsageError("give exactly one of --rule RULE_ID (an example rule) or --module FILE (your own rule module)")
    if "--out" in rule_args:
        raise UsageError("do not pass --out to the rule; insight-delivery chooses where the rule writes")
    return opts, rule_args


def _module(opts, root):
    if opts["rule"] is not None:
        path = os.path.join(RULES, opts["rule"] + ".py")
        if not os.path.isfile(path) or opts["rule"] in ("facts", "netlists", "__init__"):
            raise UsageError("no example rule %r; the example rules are %s" % (opts["rule"], ", ".join(example_rules())))
        return path
    path = opts["module"] if os.path.isabs(opts["module"]) else os.path.join(root, opts["module"])
    if not os.path.isfile(path):
        raise UsageError("rule module %s does not exist" % path)
    return os.path.abspath(path)


def example_rules():
    return sorted(name[:-3] for name in os.listdir(RULES)
                  if name.endswith(".py") and name[:-3] not in ("facts", "netlists", "__init__"))


def _code_dir(root, stem, files):
    """A fresh `analysis/<stem>[-rN]/` that either does not exist or already holds exactly these bytes."""
    for n in range(1, 100):
        rel = "analysis/%s" % stem if n == 1 else "analysis/%s-r%d" % (stem, n)
        target = os.path.join(root, rel)
        clash = False
        for src in files:
            dst = os.path.join(target, os.path.basename(src))
            if os.path.exists(dst) and common.sha256_file(dst) != common.sha256_file(src):
                clash = True
        if not clash:
            return rel
    raise UsageError("too many earlier versions of analysis/%s" % stem)


def _input_paths(rule_args):
    """(facts paths, other input paths) named by the rule arguments; globs resolved as the rules do."""
    sys.path.insert(0, FLOW)
    from libinsight_analysis.rules import facts as F
    facts_specs, others = [], []
    i = 0
    while i < len(rule_args):
        arg = rule_args[i]
        key, value = (arg.split("=", 1) + [None])[:2] if arg.startswith("--") and "=" in arg else (arg, None)
        if key in ("--facts", "--report", "--netlist", "--spice"):
            if value is None:
                i += 1
                value = rule_args[i] if i < len(rule_args) else None
            if value is None:
                break
            (facts_specs if key == "--facts" else others).append(value)
        i += 1
    import glob as _glob
    expanded = []
    for value in others:
        expanded.extend(sorted(_glob.glob(value)) if any(c in value for c in "*?[") else [value])
    others = expanded
    facts_paths = []
    for _label, path in F.parse_inputs(facts_specs) if facts_specs else []:
        if os.path.abspath(path) not in facts_paths:
            facts_paths.append(os.path.abspath(path))
    return facts_paths, [os.path.abspath(p) for p in others]


def _items_dataset(rule):
    kind, items = rule["kind"], rule.get("items") or []
    if kind == "path":
        columns = [("path", "number", None), ("instance", "string", None), ("cell", "string", None), ("arc", "string", None),
                   ("delay_ps", "number", "ps"), ("faster_equivalents", "number", None), ("best_ps", "number", "ps")]
        rows = []
        for n, p in enumerate(rule.get("paths") or [], 1):
            for s in p.get("rows") or []:
                rows.append([n, s.get("inst"), s.get("cell"), s.get("arc"), s.get("d"), s.get("nfast"), s.get("best")])
    elif kind == "vmin":
        temps = rule.get("temps") or []
        columns = [("cell", "string", None), ("variant", "string", None), ("class", "string", None), ("worst_extra_pct", "number", "%")]
        columns += [("extra_pct_%s_C" % t.replace("-", "m"), "number", "%") for t in temps]
        rows = [[i.get("label"), i.get("v"), i.get("cls"), i.get("x")] + [(i.get("extra") or {}).get(t) for t in temps] for i in items]
    elif kind == "gaps":
        columns = [("function", "string", None), ("variant", "string", None), ("jump", "number", "x"),
                   ("below", "string", None), ("above", "string", None), ("suggested_drive", "number", "x"), ("suggested_area", "number", "um2")]
        rows = [[i.get("cls"), i.get("v"), i.get("ratio"), (i.get("lo") or {}).get("s"), (i.get("hi") or {}).get("s"),
                 (i.get("miss") or {}).get("drive"), (i.get("miss") or {}).get("area")] for i in items]
    else:
        columns = [("cell", "string", None), ("variant", "string", None), ("corner", "string", None), ("table", "string", None),
                   ("arc", "string", None), ("roughness_x_tolerance", "number", "x")]
        rows = [[i.get("label"), i.get("v"), i.get("corner"), i.get("kind"), i.get("arc"), i.get("ratio")] for i in items]
    out_cols = []
    for name, kind_, unit in columns:
        col = {"name": name, "type": kind_}
        if unit:
            col["unit"] = unit
        col["nullMeans"] = "not reported for this item"
        out_cols.append(col)
    clean = []
    for row in rows[:MAX_ROWS]:
        clean.append([v if v is None or (isinstance(v, str)) or common.finite_number(v) else None for v in row])
    return {"columns": out_cols, "rows": clean}


def _next_version(prepared, analysis_id):
    versions = [a.get("version", 0) for a in (prepared.get("library") or {}).get("analyses", []) if a.get("id") == analysis_id]
    return max(versions) + 1 if versions else 1


def run(argv):
    opts, rule_args = _parse(argv)
    root = os.path.abspath(opts["root"])
    prepared_path = opts["prepared"] or os.path.join(FLOW, os.pardir, common.PREPARED_PATH)
    prepared = common.read_json_file(os.path.abspath(prepared_path), "prepared request")
    module = _module(opts, root)
    stem = os.path.basename(module)[:-3]
    helpers = [os.path.join(RULES, h) for h in HELPERS] if opts["rule"] is not None else []
    rel = _code_dir(root, stem, [module] + helpers)
    code_dir = os.path.join(root, rel)
    if not os.path.isdir(code_dir):
        os.makedirs(code_dir)
    facts_paths, other_paths = _input_paths(rule_args)
    before = dict((p, common.sha256_file(p)) for p in facts_paths + other_paths)
    out_json = os.path.join(code_dir, "rule.json")
    command = [sys.executable, module] + rule_args + ["--out", out_json]
    env = dict(os.environ, PYTHONPATH=FLOW + (os.pathsep + os.environ["PYTHONPATH"] if os.environ.get("PYTHONPATH") else ""),
               PYTHONDONTWRITEBYTECODE="1")
    started = time.time()
    done = subprocess.run(command, env=env, cwd=root, stdout=subprocess.PIPE, stderr=subprocess.PIPE, universal_newlines=True)
    elapsed = round(time.time() - started, 3)
    sys.stderr.write(done.stderr)
    if done.returncode != 0:
        print("the rule exited %d; nothing was delivered. Its message is above." % done.returncode)
        return 1
    after = dict((p, common.sha256_file(p)) for p in facts_paths + other_paths)
    with open(out_json) as stream:
        rule = json.load(stream)
    code_files = []
    for src in [module] + helpers:
        dst = os.path.join(code_dir, os.path.basename(src))
        if os.path.abspath(src) != os.path.abspath(dst) and not os.path.exists(dst):
            shutil.copyfile(src, dst)
        code_files.append(dst)
    main_path = os.path.join(rel, os.path.basename(module))
    with open(os.path.join(root, main_path), "rb") as stream:
        main_text = stream.read().decode("utf-8")
    files = [{"path": os.path.relpath(p, root), "sha256": common.sha256_file(p)}
             for p in code_files[1:] + [out_json]]
    sources = []
    for path in facts_paths:
        header = common.facts_header(path)
        sources.append({"path": path, "kind": "facts", "sha256Before": before[path], "sha256After": after[path],
                        "libertySha256": header["source"]["sha256"]})
    analysis_id = rule["id"].replace("_", "-")
    version = int(opts["version"]) if opts["version"] else _next_version(prepared, analysis_id)
    assumptions = ["Rule: %s" % rule["rule"]]
    assumptions += ["Also read %s (sha256 %s, unchanged: %s)." % (p, after[p], "yes" if before[p] == after[p] else "NO")
                    for p in other_paths]
    limits = ["Only the facts files listed as sources were read; other corners and variants were not checked."]
    if any(before[p] != after[p] for p in before):
        limits.append("An input file changed while the rule ran; re-run before trusting this result.")
    doc = {
        "schema": "hima-libinsight-analysis/1",
        "id": analysis_id,
        "version": version,
        "question": (prepared.get("question") or rule["title"])[:4000],
        "summary": ("%s: %s. %s" % (rule["title"], rule["result"], rule["rule"]))[:2000],
        "sources": sources,
        "datasets": {"items": _items_dataset(rule)},
        "plots": [{"id": "items", "title": "%s: flagged items, worst first" % rule["title"], "kind": "table", "dataset": "items"}],
        "code": {"main": {"path": main_path, "sha256": common.sha256_bytes(main_text.encode("utf-8")), "text": main_text},
                 "files": files},
        "run": {"command": " ".join(command), "exitCode": 0, "elapsedSeconds": elapsed, "usedQualib": False},
        "assumptions": assumptions,
        "limits": limits,
        "insight": rule,
    }
    result_path = os.path.join(root, "analysis-result.json")
    common.write_json(result_path, doc)
    with open(result_path, "rb") as stream:
        data = stream.read()
    artifacts = [{"path": "analysis-result.json", "sha256": common.sha256_bytes(data), "kind": "result"}]
    artifacts += [{"path": main_path, "sha256": doc["code"]["main"]["sha256"], "kind": "support"}]
    artifacts += [{"path": f["path"], "sha256": f["sha256"], "kind": "support"} for f in files]
    candidate = {"schema": "hima-resident-engineering-candidate/1", "outcome": "completed",
                 "summary": doc["summary"][:400], "stopReason": "analysis complete", "artifacts": artifacts}
    common.write_json(os.path.join(root, "resident-delivery.json"), candidate)
    found = delivery.problems(doc, root, prepared, len(data))
    if found:
        for line in found:
            print(line)
        return 1
    print("accepted %s sha256 %s: %s · %s" % (result_path, common.sha256_bytes(data), rule["id"], rule["result"]))
    return 0
