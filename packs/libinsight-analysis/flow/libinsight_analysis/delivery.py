"""The `hima-libinsight-analysis/1` delivery contract, shared by the Reader, admit-analysis and the
resident's own `check-delivery` self-check.

`problems(...)` returns a list of precise sentences; an empty list is the only acceptance. Every
sentence names the field and says what to change, because a Reader rejection is sent back to the
same resident task as its repair message.
"""
import os
import re

from . import common, insight_page

TOP_KEYS = ("schema", "id", "version", "question", "summary", "sources", "datasets", "plots", "code", "run",
            "assumptions", "limits")
SOURCE_KEYS = {"path", "kind", "sha256Before", "sha256After"}
COLUMN_KEYS = {"name", "type"}
COLUMN_OPTIONAL = {"unit", "nullMeans"}
OPTIONAL_INSIGHT = "insight"
PLOT_KINDS = ("table", "bar", "line", "scatter", "heatmap")
MAX_BYTES = 4 * 1024 * 1024
MAX_ROWS = 20000
MAX_DATASETS = 16
MAX_COLUMNS = 64
MAX_PLOTS = 32
MAX_CODE_FILES = 64
MAX_TEXT = 256 * 1024
DATASET_NAME = re.compile(r"^[A-Za-z0-9][A-Za-z0-9_.-]{0,63}$")

# Per plot kind: which encodings are required, which are optional, and which column types each takes.
PLOT_RULES = {
    "table": {"required": (), "optional": (), "types": {}},
    "bar": {"required": ("x", "y"), "optional": ("series",), "types": {"y": ("number",), "series": ("string",)}},
    "line": {"required": ("x", "y"), "optional": ("series",), "types": {"x": ("number",), "y": ("number",), "series": ("string",)}},
    "scatter": {"required": ("x", "y"), "optional": ("series",), "types": {"x": ("number",), "y": ("number",), "series": ("string",)}},
    "heatmap": {"required": ("x", "y", "value"), "optional": (), "types": {"value": ("number",)}},
}
ENCODINGS = ("x", "y", "series", "value")


def _text(value, low, high):
    return isinstance(value, str) and low <= len(value) <= high and (low == 0 or value.strip() != "")


def _string_list(name, value, out):
    if not isinstance(value, list) or len(value) > 50:
        out.append("%s must be a list of at most 50 strings" % name)
        return
    for index, item in enumerate(value):
        if not _text(item, 1, 1000):
            out.append("%s[%d] must be a non-empty string of at most 1000 characters" % (name, index))


def _sources(doc, prepared, current_sha, out):
    sources = doc.get("sources")
    if not isinstance(sources, list) or len(sources) > 64:
        out.append("sources must be a list of at most 64 {path, kind, sha256Before, sha256After[, libertySha256]} entries")
        return
    prepared_sources = dict((item["path"], item) for item in (prepared or {}).get("sources", []))
    builds = (prepared or {}).get("buildsOn", [])
    if not sources and not builds:
        out.append("sources is empty: name every Liberty or facts file the datasets were computed from, with sha256Before/sha256After")
    seen, covered, liberties = set(), set(), set()
    for index, source in enumerate(sources):
        at = "sources[%d]" % index
        before_problems = len(out)
        if not isinstance(source, dict):
            out.append("%s must be an object" % at)
            continue
        expected = set(SOURCE_KEYS)
        if source.get("kind") == "facts":
            expected.add("libertySha256")
        if set(source) != expected:
            out.append("%s fields: missing %s; unexpected %s; a %s source has exactly %s" % (
                at, sorted(expected - set(source)), sorted(set(source) - expected), source.get("kind"), sorted(expected)))
            continue
        path, kind = source["path"], source["kind"]
        if kind not in ("liberty", "facts"):
            out.append("%s.kind must be liberty or facts, not %r" % (at, kind))
            continue
        if not isinstance(path, str) or not os.path.isabs(path):
            out.append("%s.path must be an absolute Site path" % at)
            continue
        if path in seen:
            out.append("%s repeats source %s" % (at, path))
        seen.add(path)
        before, after = source["sha256Before"], source["sha256After"]
        if not (isinstance(before, str) and common.HEX64.match(before) and isinstance(after, str) and common.HEX64.match(after)):
            out.append("%s sha256Before/sha256After must be lowercase 64-hex SHA-256 digests" % at)
            continue
        if before != after:
            out.append("%s %s changed while the analysis ran (sha256Before %s != sha256After %s); rerun on an unchanging source" % (
                at, path, before, after))
            continue
        bound = prepared_sources.get(path)
        if bound is not None:
            if bound["kind"] != kind:
                out.append("%s %s is a %s source in the prepared request, not %s" % (at, path, bound["kind"], kind))
            if before != bound["sha256"]:
                out.append("%s %s sha256 %s differs from the prepared request sha256 %s; analyse the prepared bytes" % (
                    at, path, before, bound["sha256"]))
            if kind == "facts" and source["libertySha256"] != bound["liberty"]["sha256"]:
                out.append("%s libertySha256 %s differs from the facts file's embedded source.sha256 %s" % (
                    at, source["libertySha256"], bound["liberty"]["sha256"]))
        else:
            # An additional source the resident found itself is allowed only under the Site read roots the
            # prepared request recorded, with identical before/after hashes that still match the file now;
            # facts sources must also carry their embedded identity.
            roots = (prepared or {}).get("readRoots")
            if not isinstance(roots, list) or not roots or not common.inside(path, roots):
                out.append("%s additional source %s is outside the prepared read roots %s; use only files the Site "
                           "read roots cover" % (at, path, roots))
                continue
            if kind == "facts":
                try:
                    header = common.facts_header(path)
                except common.LiaError as error:
                    out.append("%s additional facts source is not usable: %s" % (at, error.detail))
                    continue
                if source["libertySha256"] != header["source"]["sha256"]:
                    out.append("%s libertySha256 %s differs from the facts file's embedded source.sha256 %s" % (
                        at, source["libertySha256"], header["source"]["sha256"]))
        try:
            now = current_sha(path)
        except (OSError, common.LiaError) as error:
            out.append("%s %s cannot be re-hashed by the Reader: %s" % (at, path, getattr(error, "detail", error)))
            continue
        if now != before:
            out.append("%s %s now hashes %s, not the delivered %s" % (at, path, now, before))
        if len(out) == before_problems:
            covered.add(path)
            if kind == "facts":
                liberties.add(source["libertySha256"])
    # Every prepared source must be answered: the same path, or for a prepared Liberty file a facts
    # record extracted from exactly those Liberty bytes.
    for bound in sorted(prepared_sources.values(), key=lambda item: item["path"]):
        if bound["path"] in covered:
            continue
        if bound["kind"] == "liberty" and bound["sha256"] in liberties:
            continue
        hint = (" or a facts file whose libertySha256 is %s" % bound["sha256"]) if bound["kind"] == "liberty" else ""
        out.append("prepared source %s is not covered by the delivery: list it in sources with sha256 %s%s" % (
            bound["path"], bound["sha256"], hint))


def _datasets(doc, out):
    datasets = doc.get("datasets")
    columns_of = {}
    rows_total = 0
    if not isinstance(datasets, dict) or not 1 <= len(datasets) <= MAX_DATASETS:
        out.append("datasets must be an object of 1..%d named datasets {columns, rows}" % MAX_DATASETS)
        return columns_of, rows_total
    for name in sorted(datasets):
        dataset = datasets[name]
        at = "datasets.%s" % name
        if not DATASET_NAME.match(name):
            out.append("%s: dataset names are 1..64 of letters, digits, '_', '.', '-' starting with a letter or digit" % at)
            continue
        if not isinstance(dataset, dict) or set(dataset) != {"columns", "rows"}:
            out.append("%s must be exactly {columns, rows}" % at)
            continue
        columns, rows = dataset["columns"], dataset["rows"]
        if not isinstance(columns, list) or not 1 <= len(columns) <= MAX_COLUMNS:
            out.append("%s.columns must be a list of 1..%d column declarations" % (at, MAX_COLUMNS))
            continue
        declared = []
        names = set()
        broken = False
        for index, column in enumerate(columns):
            where = "%s.columns[%d]" % (at, index)
            if not isinstance(column, dict) or not COLUMN_KEYS <= set(column) or set(column) - COLUMN_KEYS - COLUMN_OPTIONAL:
                out.append("%s must be {name, type[, unit][, nullMeans]}" % where)
                broken = True
                continue
            if not _text(column["name"], 1, 64) or column["name"] in names:
                out.append("%s.name must be a unique non-empty string of at most 64 characters" % where)
                broken = True
                continue
            names.add(column["name"])
            if column["type"] not in ("number", "string"):
                out.append("%s.type must be number or string, not %r" % (where, column["type"]))
                broken = True
            if "unit" in column and not _text(column["unit"], 1, 32):
                out.append("%s.unit must be a non-empty string of at most 32 characters" % where)
            if "nullMeans" in column and not _text(column["nullMeans"], 1, 200):
                out.append("%s.nullMeans must say in 1..200 characters why a value can be absent" % where)
            declared.append(column)
        if broken:
            continue
        columns_of[name] = dict((column["name"], column) for column in declared)
        if not isinstance(rows, list):
            out.append("%s.rows must be a list of rows" % at)
            continue
        if len(rows) > MAX_ROWS:
            out.append("%s has %d rows; a dataset holds at most %d rows, aggregate or split it" % (at, len(rows), MAX_ROWS))
            continue
        rows_total += len(rows)
        reported = 0
        for row_index, row in enumerate(rows):
            if reported >= 10:
                out.append("%s: further row problems omitted" % at)
                break
            where = "%s.rows[%d]" % (at, row_index)
            if not isinstance(row, list) or len(row) != len(declared):
                out.append("%s must be a list of exactly %d cells in column order" % (where, len(declared)))
                reported += 1
                continue
            for column, cell in zip(declared, row):
                if cell is None:
                    if "nullMeans" not in column:
                        out.append("%s column %s is null, but the column declares no nullMeans; declare why values can be "
                                   "missing, never write 0 for a missing value" % (where, column["name"]))
                        reported += 1
                elif column["type"] == "number":
                    if not common.finite_number(cell):
                        out.append("%s column %s must be a finite number (or null with nullMeans), not %r" % (
                            where, column["name"], cell))
                        reported += 1
                elif not isinstance(cell, str) or len(cell) > 1000:
                    out.append("%s column %s must be a string of at most 1000 characters" % (where, column["name"]))
                    reported += 1
    return columns_of, rows_total


def _plots(doc, columns_of, out):
    plots = doc.get("plots")
    if not isinstance(plots, list) or not 1 <= len(plots) <= MAX_PLOTS:
        out.append("plots must be a list of 1..%d plots; a delivery without a plot has nothing to show" % MAX_PLOTS)
        return 0
    ids = set()
    for index, plot in enumerate(plots):
        at = "plots[%d]" % index
        if not isinstance(plot, dict):
            out.append("%s must be an object" % at)
            continue
        kind = plot.get("kind")
        if kind not in PLOT_RULES:
            out.append("%s.kind must be one of %s, not %r" % (at, ", ".join(PLOT_KINDS), kind))
            continue
        rules = PLOT_RULES[kind]
        allowed = {"id", "title", "kind", "dataset"} | set(rules["required"]) | set(rules["optional"])
        missing = ({"id", "title", "kind", "dataset"} | set(rules["required"])) - set(plot)
        extra = set(plot) - allowed
        if missing or extra:
            out.append("%s (%s) fields: missing %s; unexpected %s; a %s plot takes %s" % (
                at, kind, sorted(missing), sorted(extra), kind, sorted(allowed)))
            continue
        if not isinstance(plot["id"], str) or not common.SLUG.match(plot["id"]) or plot["id"] in ids:
            out.append("%s.id must be a unique slug like mid-grid-delay" % at)
        ids.add(plot["id"])
        if not _text(plot["title"], 1, 200):
            out.append("%s.title must be a non-empty string of at most 200 characters" % at)
        dataset = plot["dataset"]
        if dataset not in columns_of:
            out.append("%s.dataset %r is not a valid dataset of this delivery" % (at, dataset))
            continue
        columns = columns_of[dataset]
        for encoding in ENCODINGS:
            if encoding not in plot:
                continue
            spec = plot[encoding]
            keys = {"column"} if encoding == "series" else {"column", "label"}
            if not isinstance(spec, dict) or "column" not in spec or set(spec) - keys:
                out.append("%s.%s must be {%s}" % (at, encoding, "column" if encoding == "series" else "column[, label]"))
                continue
            if "label" in spec and not _text(spec["label"], 1, 100):
                out.append("%s.%s.label must be a non-empty string of at most 100 characters" % (at, encoding))
            column = columns.get(spec["column"])
            if column is None:
                out.append("%s.%s.column %r is not a column of dataset %s (columns: %s)" % (
                    at, encoding, spec["column"], dataset, ", ".join(sorted(columns))))
                continue
            wanted = rules["types"].get(encoding)
            if wanted and column["type"] not in wanted:
                out.append("%s.%s.column %s is a %s column; a %s plot needs a %s column for %s" % (
                    at, encoding, spec["column"], column["type"], kind, "/".join(wanted), encoding))
    return len(plots)


def _code(doc, root, out):
    code = doc.get("code")
    if not isinstance(code, dict) or set(code) != {"main", "files"}:
        out.append("code must be exactly {main: {path, sha256, text}, files: [{path, sha256}]}")
        return
    main, files = code["main"], code["files"]
    prefix = common.ARTIFACT_PREFIX + "/"
    paths = set()

    def on_disk(where, path, digest):
        if not common.relative_path(path) or not path.startswith(prefix):
            out.append("%s.path %r must be a normalized relative path under %s (the Pack artifact prefix)" % (where, path, prefix))
            return
        if path in paths:
            out.append("%s.path %s is listed twice" % (where, path))
        paths.add(path)
        if not isinstance(digest, str) or not common.HEX64.match(digest):
            out.append("%s.sha256 must be a lowercase 64-hex digest" % where)
            return
        target = os.path.join(root, path)
        if os.path.islink(target) or not os.path.isfile(target):
            out.append("%s %s is not a delivered plain file; list it as a support artifact in the delivery candidate" % (where, path))
            return
        actual = common.sha256_file(target)
        if actual != digest:
            out.append("%s.sha256 %s differs from the delivered file %s (%s)" % (where, digest, path, actual))

    if not isinstance(main, dict) or set(main) != {"path", "sha256", "text"}:
        out.append("code.main must be exactly {path, sha256, text}")
    else:
        if not isinstance(main["text"], str) or not 1 <= len(main["text"]) <= MAX_TEXT:
            out.append("code.main.text must hold the main script's complete text (1..%d characters)" % MAX_TEXT)
        elif main["sha256"] != common.sha256_bytes(main["text"].encode("utf-8")):
            out.append("code.main.sha256 %s is not sha256(code.main.text) %s; the text must be the exact UTF-8 file bytes" % (
                main["sha256"], common.sha256_bytes(main["text"].encode("utf-8"))))
        on_disk("code.main", main["path"], main["sha256"])
    if not isinstance(files, list) or len(files) > MAX_CODE_FILES:
        out.append("code.files must be a list of at most %d {path, sha256} entries" % MAX_CODE_FILES)
        return
    for index, item in enumerate(files):
        where = "code.files[%d]" % index
        if not isinstance(item, dict) or set(item) != {"path", "sha256"}:
            out.append("%s must be exactly {path, sha256}" % where)
            continue
        on_disk(where, item["path"], item["sha256"])


def _run(doc, out):
    run = doc.get("run")
    if not isinstance(run, dict) or set(run) != {"command", "exitCode", "elapsedSeconds", "usedQualib"}:
        out.append("run must be exactly {command, exitCode, elapsedSeconds, usedQualib}")
        return
    if not _text(run["command"], 1, 2000):
        out.append("run.command must be the exact command line that produced the datasets (1..2000 characters)")
    if not isinstance(run["exitCode"], int) or isinstance(run["exitCode"], bool):
        out.append("run.exitCode must be an integer")
    elif run["exitCode"] != 0:
        out.append("run.exitCode is %d; deliver only datasets of a run that exited 0 (report a blocked run as a "
                   "successful status analysis whose datasets record the evidence, with candidate outcome blocked)" % run["exitCode"])
    if not common.finite_number(run["elapsedSeconds"]) or run["elapsedSeconds"] < 0:
        out.append("run.elapsedSeconds must be a finite non-negative number")
    if not isinstance(run["usedQualib"], bool):
        out.append("run.usedQualib must be true or false")


def problems(doc, root, prepared, byte_size, current_sha=common.sha256_file):
    """Every reason `doc` is not an admissible delivery. `root` resolves code paths (the Campaign
    workspace for the Reader, the private workspace for the resident's self-check)."""
    out = []
    if byte_size > MAX_BYTES:
        out.append("result is %d bytes; a delivery is at most %d bytes (4 MiB), aggregate or drop rows" % (byte_size, MAX_BYTES))
    if not isinstance(doc, dict):
        return out + ["result must be one JSON object"]
    keys = set(doc) - {OPTIONAL_INSIGHT}
    if keys != set(TOP_KEYS):
        out.append("result fields: missing %s; unexpected %s; expected exactly %s (plus an optional %s)" % (
            sorted(set(TOP_KEYS) - keys), sorted(keys - set(TOP_KEYS)), list(TOP_KEYS), OPTIONAL_INSIGHT))
        return out
    if doc["schema"] != common.ANALYSIS_SCHEMA:
        out.append("schema must be %s, not %r" % (common.ANALYSIS_SCHEMA, doc["schema"]))
    if not isinstance(doc["id"], str) or not common.SLUG.match(doc["id"]):
        out.append("id %r must match ^[a-z0-9][a-z0-9-]{1,62}$" % (doc["id"],))
    if not isinstance(doc["version"], int) or isinstance(doc["version"], bool) or doc["version"] < 1:
        out.append("version must be an integer >= 1")
    if not _text(doc["question"], 1, 4000):
        out.append("question must be a non-empty string of at most 4000 characters")
    if not _text(doc["summary"], 1, 2000):
        out.append("summary must be a non-empty string of at most 2000 characters")
    _sources(doc, prepared, current_sha, out)
    columns_of, _rows = _datasets(doc, out)
    _plots(doc, columns_of, out)
    _code(doc, root, out)
    _run(doc, out)
    _string_list("assumptions", doc["assumptions"], out)
    _string_list("limits", doc["limits"], out)
    if OPTIONAL_INSIGHT in doc:
        # The insight rule the Pack's fixed page template draws (knowledge/insight-rule-shape.md).
        out.extend("insight: %s" % line for line in insight_page.check_rule(doc[OPTIONAL_INSIGHT]))
    return out


def measures(doc):
    """Counts the Reader emits for an accepted delivery."""
    rows = sum(len(dataset["rows"]) for dataset in doc["datasets"].values())
    return {"plots": len(doc["plots"]), "rows": rows, "datasets": len(doc["datasets"])}


def load_result(path):
    """(document, bytes) of a delivered result file, raising LiaError with a precise reason."""
    common.plain_file(path, "analysis result")
    with open(path, "rb") as stream:
        data = stream.read()
    if len(data) > MAX_BYTES:
        raise common.LiaError("invalid-result", "result is %d bytes; a delivery is at most %d bytes (4 MiB)" % (len(data), MAX_BYTES))
    try:
        return common.loads_strict(data.decode("utf-8")), data
    except (UnicodeDecodeError, ValueError) as error:
        raise common.LiaError("invalid-result", "result is not strict UTF-8 JSON: %s" % error)
