#!/usr/bin/env python3
"""Copy this file as entry.py and implement research(); keep the runner contract."""
from pathlib import Path
import sys

FLOW = Path(sys.argv[1]).resolve() / "flow"
sys.path.insert(0, str(FLOW))
from ai_research_runner import run  # noqa: E402


def research(candidates, context):
    """Return hypotheses and source-linked selections derived from this Campaign.

    candidates is a list of complete, buildable candidate dictionaries with an added
    ``route`` key. context contains the AES-independent design identity, explicit
    reg2reg pressure, the build budget and any retained synthesis/adoption feedback.

    Return exactly:
      {"hypotheses": [{"name": str, "question": str, "signals": [str, ...]}, ...],
       "selected": [{"route": str, "candidate_id": str,
                     "hypothesis": str, "rationale": str}, ...],
       "stop_reason": str}
    """
    raise NotImplementedError("Author a data-dependent discovery algorithm here")


if __name__ == "__main__":
    run(research, sys.argv)
