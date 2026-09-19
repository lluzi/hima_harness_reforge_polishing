#!/usr/bin/env python3
"""Copy this file as entry.py and implement research(); keep the runner contract."""
from pathlib import Path
import sys

WORKSPACE_ARG = 2 if len(sys.argv) >= 2 and sys.argv[1] == "--lfr-residual" else 1
FLOW = Path(sys.argv[WORKSPACE_ARG]).resolve() / "flow"
sys.path.insert(0, str(FLOW))
from ai_research_runner import residual_evidence_sha256, run, run_residual_research  # noqa: E402


def residual_research(context):
    """Address exactly the hash-bound residual question with bounded pure code.

    ``context`` is intentionally compact.  It contains the current F0-F3
    indicator vectors and pairwise relation, a runner-verified cross-round
    Pareto frontier, the cumulative Library state/failures and cost, and one
    explicit ``next_residual_question``.  It never contains an expected
    commercial gain or a request to predict DC/Innovus QoR.

    Return exactly::

      {"research_lenses": [
         {"name": str, "question": str,
          "evidence_sha256": [str, ...],
          "target_metric_layers": ["F0" | "F1" | "F2" | "F3", ...]}, ...],
       "candidate_program": {
         "language": "python", "entrypoint": "propose_candidates",
         "source": "def propose_candidates(residual, budget): ..."},
       "stop_reason": str}

    One lens must be named ``onsite-inspiration``. It is the sequential seventh
    strategy above the six fixed miners: analyze their combined evidence and, when
    present, the prior ``commercial_frontier_response`` before proposing a locally
    grounded selection policy. In later generations this lens must cite the current
    commercial-response evidence hash. It shares the one Library and E0 arm with all
    other lenses; it never creates a separate commercial experiment.

    Call ``residual_evidence_sha256(context)`` and cite one or more values from that returned list
    in every lens. Those hashes identify the residual evaluation/frontier/manifest/candidate-pool
    evidence accepted by the validator. Do not copy Workshop input-record hashes from a transcript:
    they identify the capture operation, not the residual evidence object.

    The candidate program is a pure proposal function.  It receives residual
    data and the deterministic budget object, performs no file/process/network I/O,
    and returns an array of
    ``{"lens": str, "transformation": object, "rationale": str}`` without
    assigning persistent identity. The deterministic runner executes it once
    in an isolated, resource-limited Python subprocess and revalidates the JSON.
    The runner owns hashes, schema, identity and budget; this function cannot
    launch commercial EDA or write Judge facts.
    At most ``budget["max_onsite_inspiration_proposals"]`` returned rows may name
    the ``onsite-inspiration`` lens. Use those slots only when the evidence supports
    a concrete opportunity; the remaining proposal budget stays available to the
    evidence-driven fixed-route lenses.

    When ``context.candidate_pool.proposals`` is non-empty, every returned
    transformation must select one of its ``proposal_key`` values. The runner
    resolves that key to the immutable production generation request after the
    model process exits; the model never reads or assigns its candidate ID.

    The embedded ``candidate_program.source`` uses this authorable subset:

    * define exactly ``propose_candidates(residual, budget)``; no imports,
      helpers, classes, ``while``, comprehensions, lambda or f-strings;
    * use ``range(<integer literal>)`` loops of at most 128 iterations; the
      aggregate static loop budget is 512; break when ``index >= len(pool)``;
    * ordinary variable numeric arithmetic and string concatenation are valid;
      file/process/dynamic-code calls and private attributes remain forbidden;
    * calls are limited to the fixed safe builtins and ``append/get/items/keys/values``.

    Start from this shape and replace the scoring/selection body with evidence-driven logic::

      def propose_candidates(residual, budget):
          pool = residual["candidate_pool"]["proposals"]
          output = []
          for index in range(128):
              if index >= len(pool):
                  break
              row = pool[index]
              key = row.get("proposal_key")
              if isinstance(key, str) and key:
                  output.append({"lens": "declared-lens",
                                 "transformation": {"proposal_key": key},
                                 "rationale": "evidence-derived reason"})
          return output
    """
    raise NotImplementedError("Author one data-dependent residual research turn here")


def research(candidates, context):
    """Return hypotheses and source-linked selections derived from this Campaign.

    candidates is the Boolean/interface-de-duplicated pool of complete, buildable
    source requests. Each candidate carries stable ``route``, ``source_methods``,
    ``method_rankings``, ``evidence``, ``interface``, ``equivalence_digest`` and
    ``implementation_route`` aliases. The original ``discovery_evidence`` and
    ``generator_contract`` remain available for deeper inspection. context contains
    the AES-independent design identity, explicit
    reg2reg pressure, source phase, the new-Cell slot budget,
    retained adopted Cells and prior synthesis/adoption feedback. Timing-driven evidence
    includes sampled path ranks, actual delay, normalized beginpoint/endpoint families,
    timing-family support, worst covered slack and a mechanically derived theoretical
    path-delay screening bound. This is the legacy Campaign adapter; new
    Library-richness work uses ``residual_research`` and F0-F3 indicators.

    Return exactly:
      {"hypotheses": [{"name": str, "question": str, "signals": [str, ...]}, ...],
       "selected": [{"route": str, "candidate_id": str,
                     "hypothesis": str, "rationale": str}, ...],
       "stop_reason": str}
    Fill min(context["max_new_cells"], len(candidates)). Retained candidates already
    occupy the other active-library slots. ``selected`` is ordered
    best-first and is the generation priority for one common library and one
    DC-to-APR validation flow. Hypotheses are collaborative research lenses; do
    not eliminate a method or create a separate validation arm for one.
    """
    raise NotImplementedError("Author a data-dependent discovery algorithm here")


if __name__ == "__main__":
    if len(sys.argv) == 4 and sys.argv[1] == "--lfr-residual":
        run_residual_research(residual_research, sys.argv[2], sys.argv[3])
    else:
        run(research, sys.argv)
