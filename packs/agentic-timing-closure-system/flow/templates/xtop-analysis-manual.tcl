########################################################################
# xtop-analysis-manual.tcl -- one worker's typed manual-analysis session
# (M3 evidence: `atcs.contributions.parse_ops_log`'s `ops.jsonl`). This
# file only fixes the *edit-domain gate* for this worker's session before
# sourcing the shared XTop session bootstrap and typed-command library in
# `xtop-operator.tcl` (workspace creation, library link, the `atcs_*`
# procedures) -- it never duplicates that setup.
#
# `atcs.adapters.compile_xtop_analysis_manual_task` bakes
# `::EDIT_DOMAIN_INSTANCES` / `::EDIT_DOMAIN_NETS` / `::EDIT_DOMAIN_PINS`
# and `::ATCS_MAX_MUTATIONS` in as validated Tcl list literals (this
# worker's own `work-package.editDomain`, `targetPins` and
# `scope.maxMutations`, fixed for the whole session -- never re-read or
# widened mid-session) immediately above this file's own text; every
# mutation procedure of the XTop expert toolkit in `xtop-operator.tcl`
# refuses a target outside that domain and refuses once the budget is used.
#
# Required env vars: OPERATOR_TCL OPS_LOG NAME_PREFIX
########################################################################
foreach required {OPERATOR_TCL OPS_LOG NAME_PREFIX} {
    if {![info exists env($required)]} { error "$required is required" }
}
if {![info exists ::EDIT_DOMAIN_INSTANCES]} { set ::EDIT_DOMAIN_INSTANCES {} }
if {![info exists ::EDIT_DOMAIN_NETS]} { set ::EDIT_DOMAIN_NETS {} }
if {![info exists ::EDIT_DOMAIN_PINS]} { set ::EDIT_DOMAIN_PINS {} }
if {![info exists ::ATCS_MAX_MUTATIONS]} { set ::ATCS_MAX_MUTATIONS 1 }
if {![file readable $env(OPERATOR_TCL)]} { error "OPERATOR_TCL is not readable: $env(OPERATOR_TCL)" }
source $env(OPERATOR_TCL)
