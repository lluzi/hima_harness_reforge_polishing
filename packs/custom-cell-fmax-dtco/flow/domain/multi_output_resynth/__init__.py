"""Pack-local multi-output structural netlist resynthesis.

The public surface is :func:`run_request`.  Callers exchange versioned JSON
documents and do not depend on the parser, cut index, ECO, or proof internals.
"""

from .service import REQUEST_SCHEMA, RESULT_SCHEMA, run_request

__all__ = ["REQUEST_SCHEMA", "RESULT_SCHEMA", "run_request"]
