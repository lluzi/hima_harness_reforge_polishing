# Custom-analysis delivery contract (`hima-libinsight-analysis/1`)

Your task ends with one result file and one delivery candidate in your private workspace. The
Host copies them back, the Pack Reader `libinsight-analysis` checks the result, and only an
accepted result is admitted into the analysis library and shown to the user. Your own words are
not a result: the datasets are.

## Files you deliver

| File (private workspace) | Candidate `kind` | Lands in the Campaign at |
| --- | --- | --- |
| `analysis-result.json` | `result` (exactly one) | `state/analysis-result.json` |
| `analysis/<your scripts and helpers>` | `support` | `analysis/...` (same path) |
| `resident-delivery.json` | — (the candidate itself) | — |

Every code file the result names must be listed in the candidate as `support` and must live under
`analysis/`. Delivered support files are **immutable**: if a repair changes a script, give the new
bytes a fresh path (for example `analysis/r2/inv_drive_delay.py`) and point `code.main.path` at it;
re-delivering unchanged files at the same path is fine.

Candidate (`resident-delivery.json`):

```json
{"schema": "hima-resident-engineering-candidate/1", "outcome": "completed",
 "summary": "one or two sentences", "stopReason": "analysis complete",
 "artifacts": [{"path": "analysis-result.json", "sha256": "<sha256>", "kind": "result"},
               {"path": "analysis/inv_drive_delay.py", "sha256": "<sha256>", "kind": "support"}]}
```

`outcome` is `completed`, `best-effort` (an honest partial answer; still admitted), `blocked` or
`cancelled` (shown, never admitted).

## The result, field by field

The object has **exactly** these keys:

| Key | Rule |
| --- | --- |
| `schema` | `"hima-libinsight-analysis/1"` |
| `id` | slug `^[a-z0-9][a-z0-9-]{1,62}$`, stable across versions of the same analysis |
| `version` | integer ≥ 1; a new version for any change to an admitted analysis |
| `question` | 1..4000 characters: the user's question (you may append the precise definition you used) |
| `summary` | 1..2000 characters: the answer, with the key numbers, computed from the datasets |
| `sources` | list of `{path, kind, sha256Before, sha256After}`; `kind` is `liberty` or `facts`; a `facts` entry also has `libertySha256` (its embedded `source.sha256`) |
| `datasets` | object of 1..16 named datasets `{columns, rows}` (name: letters, digits, `_ . -`) |
| `plots` | list of 1..32 plots over those datasets |
| `code` | `{main: {path, sha256, text}, files: [{path, sha256}]}` |
| `run` | `{command, exitCode, elapsedSeconds, usedQualib}` |
| `assumptions` | list of ≤ 50 non-empty strings |
| `limits` | list of ≤ 50 non-empty strings |

Columns: `{name, type: "number"|"string", unit?, nullMeans?}`; names unique. Each row is a list
in column order. A number cell is a finite JSON number. A cell may be `null` **only** if its column
declares `nullMeans` (why the value can be absent). Never write 0 for a missing value.

Plots: `{id, title, kind, dataset, ...encodings}`; `id` is a unique slug. Encodings are
`{column, label?}` (`series` is `{column}`):

| kind | required | optional | column types |
| --- | --- | --- | --- |
| `table` | — | — | the whole dataset is shown |
| `bar` | `x`, `y` | `series` | `y` number, `series` string |
| `line` | `x`, `y` | `series` | `x` and `y` number, `series` string |
| `scatter` | `x`, `y` | `series` | `x` and `y` number, `series` string |
| `heatmap` | `x`, `y`, `value` | — | `value` number |

`code.main.text` is the complete main script text; `code.main.sha256` is the SHA-256 of its UTF-8
bytes, which must equal the delivered file at `code.main.path`. `code.files` lists every other
file (helpers, intermediate JSON you want kept) with its SHA-256.

`run.command` is the exact command line that produced the datasets; `run.exitCode` must be 0;
`run.usedQualib` says whether the vendor Liberty API ran.

Limits: ≤ 20000 rows per dataset; the result file ≤ 4 MiB. Aggregate instead of dumping tables.

## Sources

- A path from the prepared request must carry exactly its prepared kind and sha256, with
  `sha256Before == sha256After`; a `facts` source's `libertySha256` must equal the prepared
  `liberty.sha256`.
- An additional path you found yourself (for example the facts file of a requested `.lib`) is
  allowed when `sha256Before == sha256After` and the Reader's own re-hash of the file on the Site
  gives the same digest; a facts file must also be a readable `lib-insight-facts/1` whose embedded
  `source.sha256` equals your `libertySha256`.
- `sources` may be empty only when the request builds on admitted analyses (`buildsOn`).

## What the Reader rejects (each line is sent back to you verbatim)

- wrong `schema`, missing or unexpected keys at any level, bad `id`/`version`;
- a non-finite number (`NaN`, `Infinity`, an overflowing literal), or a non-number in a number column;
- `null` in a column without `nullMeans`;
- a source whose `sha256Before != sha256After`, that differs from the prepared request, that now
  hashes differently on the Site, or whose `libertySha256` differs from the facts identity;
- `code.main.sha256 != sha256(code.main.text)`, a code file missing from the delivered tree or
  hashing differently, a code path outside `analysis/`;
- more than 20000 rows in a dataset, or a result over 4 MiB;
- a plot of a missing dataset or column, a wrong column type for an encoding, a missing required
  encoding, an encoding the kind does not take, no plots at all;
- `run.exitCode` other than 0.

## Self-check, then repair

Before writing the candidate, from your private workspace:

```sh
python3 <campaignWorkspace>/flow/libinsight_cli.py check-delivery . analysis-result.json
```

It runs the Reader's own code (minus the Site re-hash of additional sources) and prints `accepted …`
or one problem per line. If the Host's Reader still rejects a delivery, you receive a message in
this same task: "The Reader rejected this exact signed delivery (…)". Read the precise problems in
`<campaignWorkspace>/state/analysis-result.problems.txt` (first line `REJECTED delivery <sha256>`),
fix only what they name, keep your completed work, and write a corrected candidate. Do not restart
from scratch and do not claim success without a passing check.

## Shape of a valid result (abridged; the complete accepted delivery is in `example-custom-analysis.md`)

```json
{
  "schema": "hima-libinsight-analysis/1",
  "id": "saed14-inv-drive-delay",
  "version": 1,
  "question": "For SAED14 RVT TT 0.8V 25C, how does mid-grid cell_rise and cell_fall delay of the INV and INV_S inverters scale with drive strength, and what does each drive step cost in area?",
  "summary": "29 SAED14 RVT inverters (13 INV, 16 INV_S). The cell_rise tables are drive-scaled ... At one fixed 4.084 fF load and 0.02922 ns input slew, INV cell_rise falls from 0.03414 ns at drive 0.5 to 0.005939 ns at drive 20 (5.7x faster, log-log slope -0.48) while area grows from 0.1776 to 1.021.",
  "sources": [{"path": "/data/eda/project/hima_harness/library-intelligence-prototypes/claude-libint-20260923-01/canonical/saed14/saed14rvt_tt0p8v25c.json.gz",
               "kind": "facts",
               "sha256Before": "ca4a9e38f4be48240938806c1737a29fea38eb34adcc645420b06e207a7236d0",
               "sha256After": "ca4a9e38f4be48240938806c1737a29fea38eb34adcc645420b06e207a7236d0",
               "libertySha256": "49962e1b61d08eae063633ba32ab76fc002c405d40e391e181e92ff445442571"}],
  "datasets": {
    "inv_drive": {
      "columns": [{"name": "cell", "type": "string"}, {"name": "family", "type": "string"},
                  {"name": "drive", "type": "number", "unit": "x"},
                  {"name": "leakage_pW", "type": "number", "unit": "pW", "nullMeans": "the cell declares no numeric cell_leakage_power"},
                  {"name": "fixed_load_rise_ns", "type": "number", "unit": "ns", "nullMeans": "the fixed load lies outside this cell's table; not extrapolated"}],
      "rows": [["SAEDRVT14_INV_0P5", "INV", 0.5, 50.51, 0.03414],
               ["SAEDRVT14_INV_20", "INV", 20.0, 2020.0, 0.005939]]}},
  "plots": [
    {"id": "fixed-load-rise-vs-drive", "title": "cell_rise at 4.084 fF versus drive strength", "kind": "scatter",
     "dataset": "inv_drive", "x": {"column": "drive", "label": "drive (x)"},
     "y": {"column": "fixed_load_rise_ns", "label": "cell_rise (ns)"}, "series": {"column": "family"}},
    {"id": "inv-table", "title": "Inverter drive facts", "kind": "table", "dataset": "inv_drive"}],
  "code": {"main": {"path": "analysis/inv_drive_delay.py", "sha256": "<sha256 of text>", "text": "<the whole script>"},
           "files": []},
  "run": {"command": "/usr/bin/python3 analysis/inv_drive_delay.py --prepared ... --facts ... --out analysis-result.json",
          "exitCode": 0, "elapsedSeconds": 1.463, "usedQualib": false},
  "assumptions": ["Inverter cells are SAEDRVT14_INV_<drive> and SAEDRVT14_INV_S_<drive>; ECO/PECO variants are excluded."],
  "limits": ["One TT 0.8 V 25 C corner only; no other PVT corner is compared."]
}
```

The full accepted delivery and its script are in `example-custom-analysis.md`.
