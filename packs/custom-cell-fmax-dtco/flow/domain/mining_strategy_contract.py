#!/usr/bin/env python3
"""Package authority for the six bounded Cell-opportunity search routes.

The routes are deliberately deterministic search objectives, not benefit
claims.  Every route must still emit exact Boolean evidence and a buildable
generation contract; mapper adoption and PPA are measured downstream.
"""
from __future__ import annotations


STRATEGIES = {
    "timing_criticality": {
        "engine": "timing",
        "objective": "critical_impact",
        "algorithms": (
            "critical_subgraph",
            "critical_k_input_cone",
            "multi_output_shared_logic",
        ),
        "request_algorithms": (
            "CRITICAL_K_INPUT_CONE",
            "MULTI_OUTPUT_SHARED_LOGIC",
        ),
    },
    "timing_context": {
        "engine": "timing",
        "objective": "critical_context_pareto",
        "algorithms": (
            "critical_subgraph",
            "critical_k_input_cone",
            "multi_output_shared_logic",
        ),
        "request_algorithms": (
            "CRITICAL_K_INPUT_CONE",
            "MULTI_OUTPUT_SHARED_LOGIC",
        ),
    },
    "structure_frequency": {
        "engine": "mapped",
        "objective": "nonoverlap_frequency",
        "algorithms": ("repeated_cluster", "multi_output_shared_logic"),
        "request_algorithms": ("REPEATED_CLUSTER", "MULTI_OUTPUT_SHARED_LOGIC"),
    },
    "structure_compaction": {
        "engine": "mapped",
        "objective": "covered_cell_compaction",
        "algorithms": ("repeated_cluster", "multi_output_shared_logic"),
        "request_algorithms": ("REPEATED_CLUSTER", "MULTI_OUTPUT_SHARED_LOGIC"),
    },
    "mapper_compatibility": {
        "engine": "mapped",
        "objective": "single_output_mapper_fit",
        "algorithms": ("repeated_cluster", "multi_output_shared_logic"),
        "request_algorithms": ("REPEATED_CLUSTER", "MULTI_OUTPUT_SHARED_LOGIC"),
    },
    "functional_diversity": {
        "engine": "mapped",
        "objective": "boundary_function_diversity",
        "algorithms": ("repeated_cluster", "multi_output_shared_logic"),
        "request_algorithms": ("REPEATED_CLUSTER", "MULTI_OUTPUT_SHARED_LOGIC"),
    },
}


def strategy(name):
    try:
        return STRATEGIES[name]
    except KeyError as exc:
        raise ValueError("unknown Package mining strategy: %s" % name) from exc
