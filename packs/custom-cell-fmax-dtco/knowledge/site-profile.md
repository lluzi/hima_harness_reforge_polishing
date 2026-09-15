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
| `CCFMAX_TAP_CELL`, `CCFMAX_FILLER_CELLS` | one-line text | Site-valid tap and filler/decap masters shared by both arms. |
| `CCFMAX_TAP_INTERVAL` | positive integer | Site method's tap interval. |
| `CCFMAX_PROCESS_NODE` | positive number | Innovus process setting used by both arms. |
| `CCFMAX_MAX_ROUTE_LAYER` | one-line text | Common maximum routing layer. |
| `CCFMAX_RC_TEMPERATURE` | finite number above absolute zero | Common extraction temperature. |
| `CCFMAX_SWITCHING_ACTIVITY` | number in `[0,1]` | Common activity used for the retained power report. |
| `CCFMAX_POWER_TEMPLATE_BASE_CELL` | one-line text | Baseline cell used by the prediction adapter. |
| `GENERATED_LIBRARY_NAME`, `GENERATED_LIB_CELL_PATTERN` | one-line text | Generated library identity and exact master pattern used for visibility/adoption checks. |
| `MAX_CELLS` | integer `1..32` | Cheap generation breadth before one pressured DC adoption screen. |
| `MAX_ROUTE_CANDIDATES` | integer `1..40` | Per-route evidence-pool bound before AI cross-route research. |

## Tool and adapter inputs

| Field | Type | Meaning and discovery source |
| --- | --- | --- |
| `EDA_WRAPPER` | executable plain file | Existing Site wrapper that dispatches `dc_shell`, `lc_shell` and `innovus`; discover from Site documentation/PATH. |
| `BOOL2CMOS_CMD` | nonempty argv text | Site command for candidate transistor generation; parsed as argv, never as a shell program. |
| `BOOL2CMOS_CWD` | plain directory | Working directory for that generator. |
| `CCFMAX_CONTAINER_RUNTIME` | executable plain file | Existing container runtime used only by the abstract-layout adapter. |
| `CCFMAX_CONTAINER_IMAGE` | one-line text | Installed image identity for that adapter. |
| `CCFMAX_CONTAINER_HOST_ROOT` | plain directory | Host root mounted for the Campaign. |
| `CCFMAX_CONTAINER_MOUNT_POINT`, `CCFMAX_LCLAYOUT_ACTIVATE` | one-line text | Container-side mount and activation paths. |
| `CCFMAX_CHARMODEL_HELPER_DIR` | one or more colon-separated plain directories | Helper path; exactly one `estimate_lib.py` and one `mock_char.py` must resolve. |
| `GENERATION_TIMEOUT_SEC`, `ABSTRACT_TIMEOUT_SEC`, `CHARACTERIZE_TIMEOUT_SEC` | positive integers | Bounds for generation, abstract layout and prediction. |
| `LC_TIMEOUT_SEC`, `SYNTH_TIMEOUT_SEC`, `PNR_TIMEOUT_SEC`, `VERIFY_TIMEOUT_SEC` | positive integers | Bounds for real EDA invocations. |
| `MULTI_CPU` | positive integer | Common CPU count passed to both arms. |
| `DRC_LIMIT` | positive integer | Explicit uncapped verification limit; reaching the cap invalidates the result. |

## Readiness rule

HimaGuide should discover values from the supplied constraints, PDK/library setup, Site documentation,
PATH and existing flow configuration. It asks the engineer only when multiple valid choices remain or
a required fact cannot be observed. A missing file, ambiguous helper, invalid scalar, nonexistent tool
entry, or disagreement with the supplied design stops `bind-inputs`; no later node may infer a default.
A different tool version may be adapted inside the Campaign, but the tool name and retained evidence
must remain explicit.
