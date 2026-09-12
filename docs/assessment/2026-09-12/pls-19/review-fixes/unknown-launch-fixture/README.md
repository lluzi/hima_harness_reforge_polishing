# Unknown-launch fixture stabilization

2026-09-12. Source base: 5c5e1289e63d46d1c5fa107b84ccf14a11d02b87. Test-only change; no product source, dependency or configuration changed.

The parent full-local run at 59f15f3 reported `failed` instead of `uncertain` after 2.985s. The retained excerpt alone identifies the symptom, not its cause. Inspection found this test used a **1500ms** Campaign box and asserted post-dispatch uncertainty before checking whether its fault injection was ever reached.

The exact-case real-Host reproduction adds a private 2s tmux name-probe delay and records a success marker only after the real tmux command succeeds. With the original 1500ms box it fails deterministically with no success marker and the actual service answer:

`Job was not dispatched: the Campaign time box expired before this Job was launched`

See `slow-probe-red.tap` (1 failed case, 9.987s, one real Host, zero SSH). This confirms the product's pre-dispatch veto is correct; the test had not reached the state it purported to assert. The exact case used Node 24 `--test --test-name-pattern=an unknown launch remains fenced` against `test/contract/agent-controls.host.test.ts`, a private home/tmux socket, and the existing no-SSH preload. No shared job or root-run resource was touched.

The fixture now stages the wrapper before creating the Run, uses an 8s bounded Campaign box while retaining the 2s adverse probe delay, waits for the actual tmux-success marker or a diagnostic rejection, and independently confirms the exact real session before asserting uncertainty. A private 60s Job keeps the session alive through the deadline; cleanup restores only this test's PATH and cancels that Job, so the test never waits 60s. The marker is no longer created merely by shell output redirection before tmux succeeds.

`controls-green.log`: 8/8, 32.217s, 10 real Host boots, zero Electron/SSH, including the same delayed probe, actual dispatch, lost acknowledgement, unreadable deadline stop, retained intent and retry refusal. The production budget, prelaunch checks and uncertain-intent behavior are unchanged. `test-types.log` is the test typecheck. No full suite, model, Electron or EDA was run for this correction.

The earlier review-fixes SHA256 manifest records its own delivered snapshot. This supplement hashes the changed test and its new evidence; it does not rewrite the earlier failure history.
