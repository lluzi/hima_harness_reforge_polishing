# Site profile for the portable custom Cell Fmax Campaign

HimaGuide constructs two Site-local JSON objects and passes their file paths as `physicalInputs`
and `toolStack`. The user does not edit Pack YAML. `bind-inputs` merges the objects, rejects duplicate
keys, validates every value below, and only then writes the Campaign-private `flow/inputs.json`.
Paths remain on the Site. Both comparison arms use the same values.

## Physical and method inputs

| Field | Type | Meaning and discovery source |
| --- | --- | --- |
| `CLOCK_NAME` | one-line text | Clock constrained by the supplied design constraints. Read from the SDC or ask only if ambiguous. |
| `CLOCK_NS` | positive number | Common physical comparison clock in ns, derived from the supplied SDC. |
| `FOUNDRY_LIB` | plain file | Baseline Liberty used for mining, characterization scaffolding and PnR. Discover beside the selected library view. |
| `FOUNDRY_DB_FILE` | optional plain file | Compiled baseline library used by Design Compiler when it is separate from the Liberty text. HimaGuide discovers the matching `.db`; legacy Sites that pass a compiled DB as `foundryLibrary` may omit it. |
| `FOUNDRY_LEF`, `TECH_LEF` | plain files | Cell and technology LEF used by both PnR arms. Discover from the Site flow or PDK setup. |
| `FOUNDRY_QRC_TECH` | plain file | QRC extraction technology used by both arms. |
| `FOUNDRY_GDS` | plain file | Foundry library GDS merged identically into both stream-outs. |
| `CCFMAX_GDS_MAP` | plain file | Stream-out layer map. |
| `LIBERTY_SKELETON` | plain file | Function/area skeleton derived from the same baseline library; it is mining input, not timing signoff. |
| `LIBRECELL_TECH_PY`, `GEOMETRY_RULE_DECK` | plain files | Abstract-layout technology and geometry rules supplied with the method/PDK adapter. |
| `CHARMODEL_TIMING_MODEL`, `CHARMODEL_POWER_MODEL`, `CHARMODEL_AREA_MODEL` | plain files | Identified learned models. Their results remain predictions. |
| `BOOL2CMOS_PDK_PROFILE` | plain file | Generator PDK profile used to build candidate transistor netlists. |
| `PROCESS_FAMILY`, `CELL_ARCHITECTURE_REF`, `CHARACTERIZATION_PROFILE_REF` | one-line text | Provenance labels for the selected PDK/library/method profiles. |
| `DRIVE_STRENGTH`, `VT_CLASS` | one-line text | Target library class for generated candidates. |
| `PLACE_SITE` | one-line text | Innovus row/site name from the technology LEF. It is never assumed to be `core`. |
| `CCFMAX_POWER_PIN`, `CCFMAX_GROUND_PIN` | one-line text | Power and ground rail names from the library/technology profile. |
| `CCFMAX_TAP_CELL`, `CCFMAX_FILLER_CELLS` | one-line text | Site-valid tap master and legacy filler declaration. V5 does not insert ordinary filler; the retained filler field preserves profile compatibility. |
| `CCFMAX_MAX_EFFECTIVE_DENSITY` | fraction | Common placement and optimization density target, including logic, clock and tap cells; the Pack rejects configured values above 0.85 and inserts no DCAP. |
| `CCFMAX_PG_HORIZONTAL_LAYER`, `CCFMAX_PG_VERTICAL_LAYER` | layer names | Site-qualified block-level PG ring/stripe layers. |
| `CCFMAX_PG_RING_WIDTH_UM`, `CCFMAX_PG_RING_SPACING_UM`, `CCFMAX_PG_STRIPE_WIDTH_UM`, `CCFMAX_PG_STRIPE_SPACING_UM`, `CCFMAX_PG_STRIPE_SET_DISTANCE_UM`, `CCFMAX_PG_STRIPE_START_OFFSET_UM` | positive distances | Matched PG geometry inputs. They establish routing-resource competition; IR/EM and final DRC remain separate gates. |
| `CCFMAX_CLOCK_BUFFER_CELLS`, `CCFMAX_CLOCK_INVERTER_CELLS` | whitespace-separated DCCK Cell names | Site-valid balanced clock buffer and inverter masters shared by both CCOpt runs. Every name must start with `DCCK`; the routed netlist independently proves actual `CTS_` use. |
| `CCFMAX_TAP_INTERVAL` | positive integer | Site method's tap interval. |
| `CCFMAX_PROCESS_NODE` | positive number | Innovus process setting used by both arms. |
| `CCFMAX_MAX_ROUTE_LAYER` | `M<number>` name | Common maximum routing layer. The stage adapter converts the reviewed Site name (for example `M7`) to the positive integer required by Innovus `-routeTopRoutingLayer`; invalid names stop before tool launch. |
| `CCFMAX_RC_TEMPERATURE` | finite number above absolute zero | Common extraction temperature. |
| `CCFMAX_SWITCHING_ACTIVITY` | number in `[0,1]` | Common activity used for the retained power report. |
| `CCFMAX_POWER_TEMPLATE_BASE_CELL` | one-line text | Baseline cell used by the prediction adapter. |
| `GENERATED_LIBRARY_NAME`, `GENERATED_LIB_CELL_PATTERN` | one-line text | Generated library identity and exact master pattern used for visibility/adoption checks. |
| `MAX_NEW_CELLS` | integer `1..50` | Maximum new Cell delta admitted in one Library-richness round. It does not count already retained shards. HimaGuide defaults to the Pack's tested breadth and only asks when the Site has a stricter resource limit. |
| `MAX_CELLS` | positive integer | Cumulative custom-Library hard cap across immutable shards. This is no longer the per-round generation breadth; it must be at least `MAX_NEW_CELLS`. HimaGuide derives it from `MAX_NEW_CELLS` and the Pack's bounded research-round budget rather than asking the engineer for a Cell count. |
| `MAX_ROUTE_CANDIDATES` | integer `1..40` | Per-method raw evidence bound; equivalent proposals are folded before AI research and never create separate DC/APR arms. |

## Tool and adapter inputs

| Field | Type | Meaning and discovery source |
| --- | --- | --- |
| `EDA_WRAPPER` | executable plain file | Existing Site wrapper that dispatches `dc_shell`, `lc_shell` and `innovus`; discover from Site documentation/PATH. |
| `LFR_YOSYS_BIN`, `LFR_ABC_BIN` | executable plain files | License-free mapping executables. HimaGuide discovers them from the Site PATH, an installed Yosys data directory or the Pack-tested tool image; the engineer is not asked to browse for them. |
| `LFR_YOSYS_SHA256`, `LFR_ABC_SHA256` | lowercase SHA-256 | Hashes computed by HimaGuide from the discovered executables. `bind-inputs` independently recomputes them and refuses an identity mismatch. |
| `LFR_YOSYS_COMMIT`, `LFR_ABC_COMMIT` | one-line text | Commit or build identity reported by the executable/package metadata. Use an explicit package-build identity when the source commit is unavailable; do not invent `unknown`. |
| `LFR_YOSYS_BUILD_FLAGS`, `LFR_ABC_BUILD_FLAGS` | nonempty arrays of one-line strings | Build/package flags discovered from the tool package or retained tested profile. These are provenance, not user tuning knobs. |
| `LFR_PROXY_CONTAINER_DIGEST` | one-line `sha256:...` or `host:...` identity | Exact tool-image digest, or a stable host build identity when the tools are installed directly. |
| `LFR_PROXY_TIMEOUT_SEC` | positive integer | Wall-time bound for one reference or augmented open-source mapping arm. |
| `LFR_PROXY_CPU_COUNT`, `LFR_PROXY_MEMORY_MB` | positive integers | Site resource envelope for the license-free evaluator. These values bound scheduling; they do not change metric meaning. |
| `BOOL2CMOS_CMD` | nonempty argv text | Site command for candidate transistor generation; parsed as argv, never as a shell program. |
| `BOOL2CMOS_CWD` | plain directory | Working directory for that generator. |
| `CCFMAX_CONTAINER_RUNTIME` | executable plain file | Existing container runtime used only by the abstract-layout adapter. |
| `CCFMAX_CONTAINER_IMAGE` | one-line text | Installed image identity for that adapter. |
| `CCFMAX_CONTAINER_HOST_ROOT` | plain directory | Host root mounted for the Campaign. |
| `CCFMAX_CONTAINER_MOUNT_POINT`, `CCFMAX_LCLAYOUT_ACTIVATE` | one-line text | Container-side mount and activation paths. |
| `CCFMAX_CHARMODEL_HELPER_DIR` | one or more colon-separated plain directories | Helper path; exactly one `estimate_lib.py` and one `mock_char.py` must resolve. |
| `GENERATION_TIMEOUT_SEC`, `ABSTRACT_TIMEOUT_SEC`, `CHARACTERIZE_TIMEOUT_SEC` | positive integers | Site requests for generation, abstract layout and prediction. The Pack raises each effective bound to at least 3600 seconds. |
| `LC_TIMEOUT_SEC`, `SYNTH_TIMEOUT_SEC`, `PNR_TIMEOUT_SEC`, `VERIFY_TIMEOUT_SEC` | positive integers | Site requests for real EDA invocations. Effective minima are 3600, 7200, 14400 and 7200 seconds respectively; the 12-hour Campaign deadline remains the outer bound. |
| `MULTI_CPU` | positive integer | Common CPU count passed to both arms. |
| `DRC_LIMIT` | positive integer | Explicit uncapped verification limit; reaching the cap invalidates the result. |

## Pack-owned Framework paths and profiles

HimaGuide does not ask the engineer to choose Framework evidence paths or proxy profiles. After the
Site values above pass validation, `bind-inputs` materializes these Campaign-private defaults under
the existing workspace:

| Binding | Pack-owned value |
| --- | --- |
| `LFR_MAPPING_PROFILE` | `lfr-yosys-abc-deterministic/1` |
| `LFR_PROXY_STA_PROFILE` | `lfr-round-evaluation/3:proxy-sta` |
| `LFR_LOCAL_PORTFOLIO` | `flow/library-richness/local-portfolio.json` |
| `LFR_CANDIDATE_POOL` | `flow/library-richness/candidate-pool.json` |
| `LFR_CUMULATIVE_LIBRARY_MANIFEST` | `flow/library/cumulative-manifest.json` |

The files are produced and hash-bound by later Pack nodes. They are not required to exist during
Campaign Preparation, and a Site profile cannot redirect them outside the Campaign workspace.
Yosys/ABC and proxy STA provide layered function, local-graph, mapped-design and timing indicators
for grading structural changes. Their purpose is not to predict a portable commercial QoR gain or
to imitate DC/Innovus numerically. The matched commercial flow remains the design-specific Fmax
observation.

## Readiness rule

HimaGuide should discover values from the supplied constraints, PDK/library setup, Site documentation,
PATH, Yosys package metadata and existing flow configuration. It computes executable hashes, reuses
the Pack-tested proxy profile and resource defaults when the Site has no tighter limit, and asks the
engineer only when multiple valid choices remain or a required fact cannot be observed. A missing file,
ambiguous helper, invalid scalar, nonexistent tool entry, identity mismatch or disagreement with the
supplied design stops `bind-inputs`; no later node may infer a default. A different tool version may be
adapted inside the Campaign, but the tool name, build identity and retained evidence remain explicit.
