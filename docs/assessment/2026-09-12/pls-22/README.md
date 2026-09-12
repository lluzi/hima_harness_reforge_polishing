# PLS-22 — installed Pack authoring

Baseline `4d8bc8c9b1e1f1205eb7725ac14ee89386cdd3f2`, work branch `codex/pls22-installed-authoring`. Node 24.20.0, dsh 0.1.5-alpha.1. The implementation commit is the commit that first adds this evidence folder; source and fixture hashes are in `source-identity.json`. No source checkout outside polishing was written or run.

## Delivered behavior

`hima_author({pack,create?})` creates or selects a plain Pack folder, then returns a native author session. In the desktop it uses `workspaceRegistry.create` and `sessionController.create({workspaceId})`, so the Pack workspace, ordinary default preset/model, Files and composer all work. Headless Host uses the existing agent factory. No model turn or Site Job is started by this operation. The tool card opens that native session; its existing Live Run action opens the session's own dock. The original Coding conversation keeps its cwd and authorized file/shell behavior.

Authoring write/edit and shell restrictions are enforced at the existing monotonic tool guard. Cross-Pack create/select and release are also refused before writes. Existing symlink/dot-segment/Golden Flow tests remain intact. Refused calls leave no files at their targets.

Fabric instructions now compile Workshop declarations and real graph bindings, reader/semantics, declared wrappers and scalar bindings. The anatomy reference includes a Workshop shape and fixes its reader shell argument positions and design binding. The installed mode of `prepareHimaHome` copies the published bundle assets (including all five Skills, knowledge, presets and semantics) rather than linking the Hima source checkout. A supplied `sources` object supports an installation's own asset locations. **This is asset relocation, not a standalone application installer:** npm/dsh runtime dependencies are supplied separately by the dependency installation and remain links in this test environment.

`live-check-pipeline.ts` now uses installed assets, starts from `hima_author`, restricts model read tools to declared roots and records refusals. Its grill stage must write its own INTENT after bounded supplied author answers; the driver no longer writes a committed INTENT in place of model work. The script was syntax checked only, not run against a model here.

## Evidence and limits

| Check | Result |
| --- | --- |
| Build, TypeScript, seam check, diff whitespace | pass, relevant logs retained |
| Final Skills/authoring Host subset | 9 pass, 0 fail/skip; 38.744 s, 14 in-process Host boots, zero SSH/Electron |
| Existing pipeline + authoring subset | 12 pass, 0 fail/skip; 45.831 s, 37 in-process Host boots, zero SSH/Electron |
| Related Skills/view regression | 20 pass, 0 fail/skip; 117.987 s, 11 Host processes + 14 in-process boots, zero SSH/Electron |
| Native authoring window | 1 pass, 0 fail/skip; 27.831 s; see `window-workspace.log` and screenshots |
| Real model / remote EDA | not run; zero API calls and zero remote Site Jobs |
| Full local / independent code review | root integration responsibility; not claimed here |

The handwritten replay authoring fixture writes a real contract/graph/reader/knowledge through dsh, then the existing Workshop mechanism writes an actual script. Its local Job reads `3,7,11` and scales their sum by 2, producing 42; its reader emits that value and the Judge passes. `installed-identities.log` carries the Run, code, input, output and local Job identities. The input source remains unchanged. Missing-reader and undeclared-wrapper variants fail at Pack check, with no TEST or VERSION fabricated. Whitespace/graph-unbound Workshop, output escape and Goal contradiction admission belongs to coordinated PLS-21 (`ad84d2f`), to be checked again on integration.

The five-stage replay fixtures and existing test/release record checks remain in place. They demonstrate mechanisms, not that a real model can author or research. PLS-19 changes `hima_run` to preparation with explicit Agent execution; root must adapt `hima-test` and live-pipeline choreography and run the bounded installed V4 Flash check on the integrated code. This task does not implement that protocol.

## Failed checks retained

The first red test failed because `hima_author` did not exist. Implementation diagnostics caught the required `ctx.get` service access. Test harness fixes corrected missing bash `description`, path canonicalization, replay title consumption and the anatomy sample's Site design binding.

Eight Electron launches were used, including the final pass. Early inspection predicates returned a DOM node or considered the temporary absent dock ready; the native tool summary also had to settle and be expanded before clicking its action. Product inspection then found that synchronous dock opening targets the previously mounted session and a bare-cwd session lacks workspace membership and a composer. The final implementation uses native workspace registration and explicit new-session Live Run navigation. Final screenshots show the real selected Pack workspace and composer; no internal store was patched.

## Reproduce / rollback

Use the repository's Node 24 setup, build once, then run the selected local files in the logs. The native window case is `node --test --test-name-pattern='ordinary conversation opens' test/contract/unified-workbench.test.ts` with `HIMA_UI_ARTIFACTS` set to a chosen evidence folder. All model responses in these checks are replay fixtures.

Revert the implementation commit to remove the author tool/card and installed copy option. Keep authored Pack files and all Run/test/release records; rollback does not fabricate a tested/released state. No database migration or new service was introduced.
