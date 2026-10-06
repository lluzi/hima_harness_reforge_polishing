# The admitted-analysis library

Every accepted delivery is admitted by the `admit-analysis` task into the Site's analysis library
(`library.path` in the prepared request, on linglong
`/data/eda/project/hima_harness/libinsight-runs/library`). You can read it; you never write it.

## Layout

```
<library>/<id>/v<version>/
  admission.json          hima-libinsight-admission/1
  analysis-result.json    the accepted hima-libinsight-analysis/1 result, byte for byte
  analysis/...            every code file the result named, at its delivered relative path
```

`admission.json` is `{schema, id, version, path, question, resultSha256, codeSha256s}` where
`codeSha256s` maps each `analysis/...` path to its SHA-256. All files are read-only. An admitted
`<id>/v<version>` never changes: admitting identical bytes again is a no-op, and different bytes
under the same id and version are refused ("deliver a new version instead of replacing an admitted
one").

## The catalog in your prepared request

`prepared-request.json` carries:

- `library.analyses`: every admitted analysis as `{id, version, question, path, resultSha256}`,
  sorted by id and version; `library.invalid` lists folders whose admission did not verify.
- `buildsOn`: the analyses the user asked you to continue, each `{ref: "id@version", id, version,
  path, resultSha256}`. A request naming an analysis that is not admitted is refused before you start.

## Building on an admitted analysis

1. Read `<path>/analysis-result.json` and `<path>/analysis/...`; check `sha256(analysis-result.json)`
   against `resultSha256` before you trust it.
2. Copy what you reuse into your private workspace under `analysis/` (for example
   `analysis/base/inv_drive_delay.py`) and list every copied file in `code.files`; never import code
   from the library path directly, so the delivery stays self-contained.
3. Choose the identity:
   - **same analysis, improved or extended** (more corners, a fixed bug, a new plot): keep the `id`
     and use `version` = the highest admitted version of that id + 1;
   - **a different question** that reuses the method: a new `id`, `version: 1`.
   Never reuse an admitted `id@version`.
4. Re-run on the current sources and hash them; do not copy datasets from the earlier result unless
   the question is purely about that result. If you do reuse earlier datasets, say so in
   `assumptions` and name the earlier `id@version`.
5. A request may have an empty `sources` list only when it builds on admitted analyses; the Reader
   accepts an empty `sources` then.

Example: the library holds `saed14-inv-drive-delay@1`. The user asks "same, but for the SS corner
too". Deliver `saed14-inv-drive-delay` version 2 with both facts files as sources and the version-1
script copied to `analysis/base/` if you build from it.
