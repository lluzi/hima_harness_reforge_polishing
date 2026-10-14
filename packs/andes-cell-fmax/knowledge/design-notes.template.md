# OpenC910: design notes for the custom-cell question

<!-- Template. `python3 flow/knowledge_charts.py <EDA_ROOT>` fills every $$name from the Site's own
tools and writes knowledge/design-notes.md (generated per Site, never committed). -->

What a designer asks before a Project: what the design is, where its timing stands at the end of
route, where the worst path's time goes, which cells matter, and what the stock libraries can still
offer. Every number below was printed by the Site's own tools (Synthesis and APR, HimaTime, Qualib)
for the reference build. A Project's first step builds this reference again and measures it; quote
the Project's numbers once it has them. In chat, say "Project", not "Campaign", and do not discuss
the Pack's own status or test stage.

## The design

- **OpenC910** (T-Head XuanTie C910): a dual-core RISC-V CPU with a shared L2 cache, $design_cells
  standard-cell instances (HimaTime), on 7 nm-class stock libraries in three Vt flavours (ULVT, LVT,
  SVT).$corner_line Clock `$clock` at $period ns ($ghz GHz).
- The flow is netlist load (prePlace), placement (place_opt), clock-tree synthesis (CTS) and routing
  with optimization (route). **Every result is the timing at the end of route, path group reg2reg**
  (flop to flop: the paths that set the core clock).

## The timing at route

- reg2reg: worst slack **$wns ps**, TNS $tns ns, **$nvp violating paths** (of $all_paths reg2reg
  paths).
- All path groups: worst slack $all_wns ps, TNS $all_tns ns, $all_nvp violating paths. $io_line
- Density $density %, total power $power mW; the clock tree has $clock_tree.

$groups_table

Through the flow (reg2reg):

$stages_table

## The worst path

The worst reg2reg path at route (slack $worst_slack ps) runs from `$worst_begin` ($worst_from) to
`$worst_end` ($worst_to). $sram_line

$worst_parts

The 8 worst reg2reg paths at route:

$paths_table

## HimaTime's high-value cells

HimaTime marks the timing graph and ranks the design's $hv_cells cells by $rank_types, keeping the
top $hv_per_rank per rank type: **$hv_instances high-value instances in $hv_lib library cells**,
listed as **$hv_listed cells**$stock_vt. Largest families: $hv_families.

HimaTime's cell what-if then asks, for each cell arc, what the design would get back if that arc
were $faster_pct % faster (delay x$scale): $rankings rankings ($ranking_keys), the top $top_n of
each, merged and deduplicated into **$merged arcs**. The three arcs with the most TNS back:

$top3

The three arcs with the most worst slack back:

$top3wns

## What custom cells can move

The reg2reg misses are a wall, not one outlier: the 8 worst paths sit within $wall_ps ps of each
other and $nvp paths fail. An SRAM access is fixed, but every path in the wall also carries logic
cells and the loads they drive. A few ps per path across the wall moves TNS and the violating-path
count a lot, and the worst slack moves with the wall's worst paths. Each arc alone gives back
little (up to $max_tns ns of TNS and $max_wns ps of worst slack in the what-if); the lever is the
$merged arcs together, on $hv_instances high-value instances. That is what a Project measures.

## The stock libraries (Qualib)

Qualib's view of the $ql_arcs what-if arcs on $ql_cells cells: ULVT is already the fastest Vt on
**$ulvt_fastest of $ql_arcs arcs**; LVT is a median $lvt_slower % slower and SVT $svt_slower %
slower, at the centre of each arc's delay table. The stock libraries have nothing faster to offer:
only a new cell can make these arcs faster. A custom cell must keep the footprint ($footprint),
keep its input capacitance within $cap_ratio x the stock cell's, and pass LVS ($lvs).

## The idea and the Goal

AndesCell designs a custom cell per arc: $iterations design-space iterations per arc toward an arc
delay $faster_pct % below the stock cell's, keeping the best versions. HimaTime then keeps only the
cells with a positive cell-level gain, Qualib screens them, and the full flow runs again with the
stock libraries plus those cells. The Goal: the custom-cell build's reg2reg worst slack at route
beats the reference by at least $goal % of the clock period ($goal_ps ps at $period ns).

## Charts to show

Show them with `hima_chart` (`{ pack: "andes-cell-fmax", file: "charts/<name>" }`):
`charts/reference-summary.chart.json` when you summarize the reference build at route,
`charts/path-groups.chart.json` and `charts/flow-stages.chart.json` for the path groups and the
stages, `charts/worst-paths.chart.json` and `charts/stage-breakdown.chart.json` when you explain the
worst paths, `charts/high-value-families.chart.json` for HimaTime's high-value cells and
`charts/library-vt.chart.json` when you explain why the stock libraries cannot help.

$charts
