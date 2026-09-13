# PLS-16 knowledge reuse core evidence

Status: worker implementation complete for focused L0-L2 validation; integration and product
acceptance remain with the batch owner.

Baseline: `f06c3af71c58038dd27c4f4c6c8b331f32f340bb` on
`codex/pls16-knowledge`. Validation timestamp: 2026-09-13 UTC.

The implementation uses the existing Experience, Workshop, Fabric, Ledger and `hima_execute`
interfaces. It adds no service, index, model call, graph controller or method mutation. Historical
selection is bounded to eight candidates from at most sixteen recent ended Runs and requires the
same installed Pack, Site, exact method digest and Goal parameter keys. Every candidate is read
through a Ledger-confirmed complete archive and its manifest/material hashes. Missing or corrupted
archives return explicit no-context results.

`recommend` captures only declared Workshop reads under the Site permit. Host-only captures record
zero returned bytes; actual reads record the exact returned prefix and keep the full source identity
separately. Matching historical input bytes permit proactive delivery, while known input mismatch
or test-purpose sources prevent it. Unrecorded tool/OS identity keeps all current candidates at
`limited-background` and the returned text states that same Site or design names are not environment
or content identity.

The real-Host fixture produced two Campaign archives and one Pack-author test archive with actual
Workshop Jobs. The next Run received the matching measured negative before it wrote code. Its
source-linked next-experiment reason and source identity were visible, while a corrupted source,
wrong Pack/Site rows, an arbitrary material path and changed input bytes yielded no delivered
history record. A manual archived Pack material containing instructions to change the Goal and ask
for unrestricted shell access was returned as untrusted history; the Run Goal, method digest and
reference graph stayed unchanged. The current Run then archived and reread the exact derivative it
had received.

Validation used `gpt-6-astra` at high effort with no delegated agent. The tested product made zero
model calls, launched zero Electron windows and contacted no remote Site or EDA tool. Four
in-process Hosts and their actual local Workshop Jobs ran in the final selected set.

Final checks:

- Node 24 requirement, seam guard and Package/domain boundary guard: pass.
- Full workspace build: pass.
- Full workspace and test TypeScript checks: pass.
- Selected local tests: 12/12 pass in 19.442 seconds; 3 selected files, 60 local files unselected.
- `git diff --check`: pass.

Not run here: the full local suite, L3 Desktop, DeepSeek V4 Flash/L4, EDA/Site L4, complete DTCO
pilot/L5 and independent final review. These belong to the integrating batch owner and must not be
inferred from the focused result.

Raw final command output is in [final-focused.log](final-focused.log).
