"""Pluggable opportunity-detector interface (plan §7.1).

Every detection method returns a list of CellOpportunity with one shared schema, so
Steps 2-4 (generate/integrate/evaluate) are method-agnostic.
"""
from __future__ import annotations
from abc import ABC, abstractmethod
from dataclasses import dataclass, field, asdict


@dataclass
class CellOpportunity:
    id: str                       # stable identifier
    function: str                 # Boolean function / fused subgraph (BLIF/JSON/expr); exact form filled by equiv.py
    matched_instances: list       # instance paths (or fused-pair strings) in the baseline netlist
    estimated_gain: dict          # {"delay_ns":.., "occurrences":.., ...} -- an ESTIMATE, real numbers come from Step 4
    method: str                   # "critpath" | "regularity" | "gnn"
    rationale: str                # human-readable why
    spec: dict = field(default_factory=dict)   # {fuse:[..], suggested_drive_strengths:[..], ...}
    score: float = 0.0            # ranking score

    def to_dict(self):
        return asdict(self)


class OpportunityDetector(ABC):
    name: str = "base"

    @abstractmethod
    def detect(self, ctx) -> list:
        """Return a ranked list[CellOpportunity] from a DetectContext."""
        ...
