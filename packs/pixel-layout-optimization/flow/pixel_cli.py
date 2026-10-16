#!/usr/bin/env python3
"""``pixel_cli.py <subcommand> <workspace> [args]`` — the glue between the
Harness graph (``graph.yml``) and the Pack's ``flow/pixelopt/`` modules.

Three families:

- ``task-<id>`` (program tasks: ``prepare-case``, ``judge-original``,
  ``map-design-space``, ``learn-sensitivities``, ``solve-and-judge``,
  ``decide-round``, ``evaluate``, ``deliver``) — argv is
  ``<workspace> <task-input-path> <task-output-path>``; the dispatcher reads
  ``TASK_INPUT``, calls :func:`pixelopt.tasks.execute` and writes its
  ``{"schemaVersion","value","artifacts","diagnostics"}`` result to
  ``TASK_OUTPUT``.
- resident subcommands (``card``, ``history``, ``ledger``, ``show``, ``markers``,
  ``try-edit``, ``plan-check``, ``repair-check``) — the engineering agent's permitted tools; the
  layout-touching ones (``markers``, ``try-edit``) forward to the numeric
  driver with an explicit ``--campaign`` root, the rest are stdlib-only.
- ``num-*`` — the numeric subcommands, forwarded to
  :func:`pixelopt.numcmd.main` (imported lazily; it needs the pinned venv),
  except ``num-judge-one`` which re-enters the Task-5 judge.

Exit codes: ``0`` success; ``2`` a missing or malformed declared input; ``3`` a
refusal from a module given otherwise well-formed inputs. Every failure writes
a plain ``{"code","detail"}`` JSON object to stderr — never a raw traceback.

Standard library only; numeric modules are imported lazily inside ``num-*``.
"""
from __future__ import annotations

import argparse
import json
import os
import sys

sys.path[:0] = [os.path.dirname(os.path.abspath(__file__))]

from pixelopt import core, plan as plan_mod, receipt as receipt_mod, tasks  # noqa: E402
from pixelopt.core import PixelError  # noqa: E402


def _read_json(path):
    try:
        with open(path, "r", encoding="utf-8") as fh:
            return json.load(fh)
    except (OSError, ValueError) as exc:
        raise PixelError("missing-input", "cannot read %s: %s" % (path, exc))


def _readiness(workspace):
    return core.read_json(os.path.join(workspace, "state", "case-readiness.json"))


# --------------------------------------------------------------------------- #
# resident subcommands (print JSON to stdout)
# --------------------------------------------------------------------------- #

def _cmd_card(workspace, args):
    path = os.path.join(workspace, "state", "card.json")
    card = core.read_json(path)
    print(json.dumps(card, sort_keys=True, indent=1))


def _cmd_history(workspace, args):
    parser = argparse.ArgumentParser(prog="history")
    parser.add_argument("--last", type=int, default=None)
    opts = parser.parse_args(args)
    path = os.path.join(workspace, "state", "history.jsonl")
    rows = []
    if os.path.exists(path):
        with open(path, "r", encoding="utf-8") as fh:
            for line in fh:
                line = line.strip()
                if line:
                    rows.append(json.loads(line))
    if opts.last is not None:
        rows = rows[-opts.last:]
    print(json.dumps(rows, sort_keys=True, indent=1))


def _cmd_ledger(workspace, args):
    """The lever ledger of the last round decision: one line per lever, best measured first."""
    path = os.path.join(workspace, "state", "round-decision.json")
    decision = core.read_json(path)
    for e in decision.get("ledger") or []:
        print("%-70s %-9s n=%d legal=%d near-miss=%d dRatio(vs plain)=%s dRatio(vs base)=%s "
              "dAnode=%s dScan=%s" % (e.get("lever"), e.get("objective"), e.get("n", 0),
                                       e.get("legal", 0), e.get("nearMiss", 0),
                                       e.get("bestDRatioPctVsPlain"), e.get("bestDRatioPctVsBase"),
                                       e.get("bestDAnodeFfVsBase"), e.get("bestDScanFfVsBase")))
        for x in e.get("examples") or []:
            print("    %s %s round %s ratio %s legal %s params %s" % (
                x.get("source"), x.get("id"), x.get("round"), x.get("ratioPct"), x.get("legal"),
                json.dumps(x.get("params"), sort_keys=True)))


def _cmd_show(workspace, args):
    parser = argparse.ArgumentParser(prog="show")
    parser.add_argument("--campaign", required=True)
    parser.add_argument("candidate")
    opts = parser.parse_args(args)
    readiness = _readiness(workspace)
    receipt_path = os.path.join(opts.campaign, "cands", opts.candidate, "receipt.json")
    rows = receipt_mod.reader_values(receipt_path, opts.campaign, readiness)
    print(json.dumps({"candidate": opts.candidate, "values": rows},
                     sort_keys=True, indent=1))


def _cmd_plan_check(workspace, args):
    parser = argparse.ArgumentParser(prog="plan-check")
    parser.add_argument("--plan", required=True)
    parser.add_argument("--out", default=os.path.join("state", "round", "plan.json"))
    parser.add_argument("--campaign", default=None)
    opts = parser.parse_args(args)

    plan_doc = _read_json(opts.plan)
    readiness = _readiness(workspace)

    history_ids = list(plan_mod._history_ids(workspace))
    if opts.campaign:
        history_ids += list(plan_mod._history_ids(opts.campaign))

    schema_errors = core.validate(plan_doc, core.load_schema("plan"))
    out_path = opts.out if os.path.isabs(opts.out) else os.path.join(workspace, opts.out)
    if not schema_errors:
        core.write_json(out_path, plan_doc)

    errors = plan_mod.check(plan_doc, readiness, history_ids,
                            round=plan_doc.get("round") if isinstance(plan_doc, dict) else None)
    print(json.dumps({
        "errors": errors,
        "errorCount": len(errors),
        "written": (not schema_errors),
        "out": opts.out,
    }, sort_keys=True, indent=1))
    if schema_errors:
        raise PixelError("bad-plan", "plan is not schema-valid: " + "; ".join(schema_errors))
    if errors:
        # The checked copy is written so the Reader can name the errors, but the resident must see
        # a refusal: a plan with errors is judged by nothing.
        raise PixelError("bad-plan", "plan has %d error(s): %s" % (len(errors), "; ".join(errors)))


def _cmd_repair_check(workspace, args):
    """The repair engineer's ``plan-check``: check ``--plan`` against the repair orders, the
    schema and the ordinary bounded-edit rules, and write the checked copy to ``--out``."""
    parser = argparse.ArgumentParser(prog="repair-check")
    parser.add_argument("--plan", required=True)
    parser.add_argument("--out", default=os.path.join("state", "round", "repair-plan.json"))
    parser.add_argument("--campaign", default=None)
    opts = parser.parse_args(args)

    doc = _read_json(opts.plan)
    readiness = _readiness(workspace)
    history_ids = list(plan_mod._history_ids(workspace))
    order_ids = list(plan_mod.repair_orders_ids(workspace))
    if opts.campaign:
        history_ids += list(plan_mod._history_ids(opts.campaign))
        order_ids += list(plan_mod.repair_orders_ids(opts.campaign))
    schema_errors = core.validate(doc, core.load_schema("repair-plan"))
    out_path = opts.out if os.path.isabs(opts.out) else os.path.join(workspace, opts.out)
    if not schema_errors:
        core.write_json(out_path, doc)
    errors = plan_mod.check_repair(doc, readiness, order_ids, history_ids,
                                   round=doc.get("round") if isinstance(doc, dict) else None)
    print(json.dumps({"errors": errors, "errorCount": len(errors),
                      "written": (not schema_errors), "out": opts.out}, sort_keys=True, indent=1))
    if schema_errors:
        raise PixelError("bad-plan", "repair plan is not schema-valid: " + "; ".join(schema_errors))
    if errors:
        raise PixelError("bad-plan", "repair plan has %d error(s): %s" % (len(errors), "; ".join(errors)))


def _cmd_repair_round(workspace, args):
    """Resident fallback for the outsourced ``repair-round`` task: check the repair plan the
    resident delivered at ``state/round/repair-plan.json`` and emit a resident-output envelope with
    its ``pixel-repair-plan`` Reader values. It never fabricates a repair."""
    path = os.path.join(workspace, "state", "round", "repair-plan.json")
    if not os.path.exists(path):
        raise PixelError("bad-plan", "no repair plan delivered at state/round/repair-plan.json")
    readiness = _readiness(workspace)
    values = plan_mod.repair_reader_values(path, workspace, readiness)
    vmap = {r["type"]: r["value"] for r in values}
    ok = vmap.get("pixel_repair_plan_error_count") == 0
    print(json.dumps({
        "observations": [{"contentSha256": core.sha256_file(path), "values": values}],
        "engineering": {"outcome": "completed" if ok else "blocked",
                        "summary": "repair plan checked against the repair orders and the edit rules",
                        "stopReason": "" if ok else "repair plan has Reader errors"},
    }, sort_keys=True))


def _cmd_markers(workspace, args):
    parser = argparse.ArgumentParser(prog="markers")
    parser.add_argument("--campaign", required=True)
    parser.add_argument("--out", required=True)
    parser.add_argument("candidate")
    opts = parser.parse_args(args)
    numcmd = _import_numcmd()
    return numcmd.main(["num-markers", workspace, opts.candidate, opts.out,
                        "--campaign", opts.campaign])


def _cmd_try_edit(workspace, args):
    parser = argparse.ArgumentParser(prog="try-edit")
    parser.add_argument("--campaign", required=True)
    parser.add_argument("--ops", required=True)
    parser.add_argument("--out-dir", required=True)
    parser.add_argument("candidate")
    opts = parser.parse_args(args)
    numcmd = _import_numcmd()
    return numcmd.main(["num-try-edit", workspace, opts.candidate, opts.ops,
                        opts.out_dir, "--campaign", opts.campaign])


def _cmd_plan_round(workspace, args):
    """Resident fallback for the outsourced ``plan-round`` task: validate the
    plan the resident already delivered at ``state/round/plan.json`` and emit a
    resident-output envelope carrying its ``pixel-plan`` Reader values. It
    never fabricates a plan."""
    plan_path = os.path.join(workspace, "state", "round", "plan.json")
    if not os.path.exists(plan_path):
        raise PixelError("bad-plan", "no plan delivered at state/round/plan.json")
    readiness = _readiness(workspace)
    values = plan_mod.reader_values(plan_path, workspace, readiness)
    vmap = {r["type"]: r["value"] for r in values}
    ok = vmap.get("pixel_plan_error_count") == 0
    envelope = {
        "observations": [{"contentSha256": core.sha256_file(plan_path), "values": values}],
        "engineering": {
            "outcome": "completed" if ok else "blocked",
            "summary": "plan checked against schema, Goal, Strategy and history",
            "stopReason": "" if ok else "plan has Reader errors",
        },
    }
    print(json.dumps(envelope, sort_keys=True))


_PRINTING = {
    "card": _cmd_card,
    "history": _cmd_history,
    "ledger": _cmd_ledger,
    "show": _cmd_show,
    "plan-check": _cmd_plan_check,
    "plan-round": _cmd_plan_round,
    "repair-check": _cmd_repair_check,
    "repair-round": _cmd_repair_round,
}
_NUM_FORWARD = {
    "markers": _cmd_markers,
    "try-edit": _cmd_try_edit,
}


def _import_numcmd():
    from pixelopt import numcmd
    return numcmd


def _fail(code, detail, exit_code):
    sys.stderr.write(json.dumps({"code": code, "detail": detail}, sort_keys=True) + "\n")
    return exit_code


def _exit_for(code):
    return 2 if code in ("missing-input", "malformed-input") else 3


def main(argv=None):
    argv = list(sys.argv[1:] if argv is None else argv)
    if not argv:
        return _fail("missing-input", "usage: pixel_cli.py <subcommand> <workspace> [args]", 2)
    subcommand = argv[0]
    if len(argv) < 2:
        return _fail("missing-input", "usage: pixel_cli.py <subcommand> <workspace> [args]", 2)
    workspace = os.path.abspath(argv[1])
    rest = argv[2:]

    # program tasks
    if subcommand.startswith("task-"):
        try:
            task_input, task_output = rest
            inputs = _read_json(task_input)
            result = tasks.execute(subcommand[len("task-"):], workspace, inputs)
            core.write_json(task_output, result)
            return 0
        except PixelError as exc:
            return _fail(exc.code, exc.detail, _exit_for(exc.code))
        except (OSError, KeyError, TypeError, ValueError) as exc:
            return _fail("malformed-input", "%s: %s" % (type(exc).__name__, exc), 2)

    # numeric subcommands
    if subcommand == "num-judge-one":
        try:
            return judge_one(workspace, rest)
        except PixelError as exc:
            return _fail(exc.code, exc.detail, _exit_for(exc.code))
        except (OSError, KeyError, TypeError, ValueError) as exc:
            return _fail("malformed-input", "%s: %s" % (type(exc).__name__, exc), 2)
    if subcommand.startswith("num-") and subcommand not in _NUM_FORWARD:
        try:
            numcmd = _import_numcmd()
        except ImportError as exc:
            return _fail("tool-failed", "numeric driver unavailable: %s" % exc, 3)
        return numcmd.main([subcommand, workspace] + rest)

    # resident subcommands
    handler = _PRINTING.get(subcommand) or _NUM_FORWARD.get(subcommand)
    if handler is None:
        return _fail("missing-input", "unknown subcommand: %r" % subcommand, 2)
    try:
        rc = handler(workspace, rest)
        return rc if isinstance(rc, int) else 0
    except PixelError as exc:
        return _fail(exc.code, exc.detail, _exit_for(exc.code))
    except SystemExit as exc:  # argparse error
        return _fail("malformed-input", "bad arguments to %s" % subcommand, 2)
    except (OSError, KeyError, TypeError, ValueError) as exc:
        return _fail("malformed-input", "%s: %s" % (type(exc).__name__, exc), 2)


def judge_one(workspace, rest):
    from pixelopt import judge
    return judge.judge_one_main([workspace] + rest)


if __name__ == "__main__":
    sys.exit(main())
