# V5.1.2 focused Site validation

These are retained outputs from bounded validation against the exact trial.5.1.1 failures. They are
not a complete Campaign or P&R result.

| Artifact | SHA-256 | Meaning |
| --- | --- | --- |
| `fixed-round-result.json` | `d190bacd823926b974f169905553814c61d695a50cd2228492133ad42765a5eb` | The original 30-candidate, eight-multi-output free-evaluation request completed with the fixed identity projection. Original request SHA-256: `bdfd9b31e8c931fcb72dfd57059651e294462d92c9725cdb0817c739229a2659`. |
| `fixed-init.log` | `4ae53dbe319b11c962187a3097066d71384c155240a894feb98d85b344212862` | The isolated original Innovus init with routing level `7`; exit 0, completion marker present, no `IMPTCM-4`, `IMPSYT-6692` or batch error. |
| `bad-layer-fast-fail.log` | `4c9008c6ba68508fba2052ad02d385c86a669b28fe236eddae7971a3de37c77f` | Controlled original init with invalid `M7` argument through the new wrapper; exit 1 after 20 seconds with the tool type error and `HIMA_BATCH_ERROR`, rather than the 7200-second timeout. |

Source Runs remain in their original Campaign workspaces:

- multi-output request: `run-0b3809d4-eda4-4100-bd45-b346a0e6efd0`;
- Innovus init: `run-5ccab7dc-f57f-40b2-8605-56906c034df7`.

The validation copied each workspace into `/tmp`, changed only the code/script under test, and left
the original Run evidence unchanged. The temporary copies were removed after these artifacts were
retained.
