# PLS-21 / 22 / 13 integration checkpoint

PLS-21 `ad84d2f`, PLS-22 `e0990e4`, PLS-13 `d958a0d` integrated with the initial PLS-19 admission checkpoint `fa742d6`.

Two conflict hunks in fabric.ts combine imports and Run creation: validate the Goal, retain the exact accepted method, then create the Run with both method digest and actual conversational owner. Agent execution context also resolves that retained method. No whole-side conflict replacement.

Frozen-lockfile install, build and typecheck pass. Actual integrated Host tests: 19/19, no skips, 24.287 s, 17 in-process Hosts, zero Electron/SSH/model/EDA. Files: agent-execution.host, pack-method-assets, skills. Logs in this directory. This is a narrow integration check, not the final full local suite or completion of PLS-19/22 L4.

Controls/Workshop integration preserves both read data receipts and stop receipts. Read/knowledge inspection stays outside business stop fences; initial Workshop provisioning and code writes still refuse after stop. Initial combined run: 22/23 passed (72.636 s,30 Host boots); one test incorrectly equated the earlier cancelled Run write with the later request-receipt publication. It now waits for both actual facts and retains every assertion. Corrected controls + Workshop:9/9 passed (26.213 s,11 Host boots). Existing graph/recovery cases passed in the combined run. No model/Electron/SSH/EDA. The Workshop value assertion now checks the actual scaled_sum value42 and unit count, not incidental JSON text.
