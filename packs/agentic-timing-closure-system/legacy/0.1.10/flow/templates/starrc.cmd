# starrc.cmd -- minimal StarXtract command-file fallback.
#
# `atcs.adapters.compile_starrc_task` patches exactly the three fields
# below (the same three `packs/xtop-timing-closure/flow/closure.py`'s
# `patch_starrc_template` confirms exist in a real StarXtract command
# file: TOP_DEF_FILE, STAR_DIRECTORY, NETLIST_FILE -- read this Pack's
# `.superpowers/sdd/pack-mechanics.md` section 3.8 for that reference).
# STAR_DIRECTORY is always a *new*, private per-corner work directory this
# task allocates itself, never the input DEF's own directory.
#
# Every other field a real StarRC corner run needs (tech LEF, capacitance
# table, corner voltage/temperature, mapping files) is Site- and
# PDK-specific and is not fabricated here: a real deployment supplies its
# own complete per-corner base template (the same way the frozen
# `xtop-timing-closure` Pack's Site profile names one template per
# `starrc` corner) and `compile_starrc_task` accepts that text in place of
# this fallback, patching only the three confirmed fields either way.
TOP_DEF_FILE: __ATCS_DEF_PATH__
STAR_DIRECTORY: __ATCS_WORK_DIR__
NETLIST_FILE: __ATCS_SPEF_PATH__
