"""pixelopt: the pixel-layout-optimization Pack method.

Task 1 lands the stdlib-only foundation: errors and JSON tooling (``core``),
the case manifest reader (``manifest``), Goal resolution (``goal``) and the
Argus DRC deck parser (``rules``). Numeric modules (layout, nets, geometry,
compaction, attribution, ...) arrive in later tasks and import numpy/SciPy/
Shapely/gdstk lazily; nothing in this package's stdlib modules imports them.
"""

from .core import PixelError  # noqa: F401
