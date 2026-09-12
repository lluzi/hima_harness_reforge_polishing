# Candidate regression corrections

Product candidate: `40f5afa3fe792622f52eff21bad3e85809b32780`. These corrections change tests and README only; no product validation is relaxed.

The complete local run was **348/352 pass**, 4 fail, 0 skip, 1295.127 seconds, 47 subprocess Hosts + 327 in-process Hosts, 0 Electron, 0 SSH. It is retained as a failed candidate, not acceptance.

| Failed test | Established cause | Preserved assertion |
| --- | --- | --- |
| absent act Goal in `fabric.test.ts` | PLS-21 refuses the missing binding before a Run exists | exact missing name, unchanged Runs, no tmux |
| readonly chooser in `node-jobs.host.test.ts` | manually opened fixture had no generation; current-generation Judge/evidence lookup correctly refused it | explicitly enter generation 1 before fixture observations; real Judge and advice leave no decision/history changes |
| failed resume queue in `run-controls.test.ts` | original-method recovery now returns `unresumable` instead of throwing | missing Site gives actual I/O rejection before history, restored Site permits one resume |
| native module in `view.test.ts` | PLS-19 now injects real native conversation service | served bundle registration, injection and boot graph |

Affected four files: **33/33 pass**, 0 fail/skip, 163.138 seconds; 8 subprocess Hosts + 30 in-process Hosts, 0 Electron, 0 SSH. Command: `pnpm --config.verifyDepsBeforeRun=false run test:local --files test/contract/fabric.test.ts test/contract/node-jobs.host.test.ts test/contract/run-controls.test.ts test/contract/view.test.ts`, Node24 PATH, existing candidate build. Full local must run again after independently reviewed product fixes are integrated.

Real-model attempts on this candidate are retained separately. Workshop1 passed its 12 mechanism checks but ended `ended-goal-not-met` because its graph omitted an explicit Explore decision. Authoring1 reached compiled Pack with a real Workshop then hit its 600-second checker bound before completing the test stage; it failed. Neither is substituted for complete feedback/authoring acceptance.
