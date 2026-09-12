# PLS-19 admission checkpoint — incomplete task

Starting point: PLS-21 `ad84d2f`. This checkpoint adds actual conversational ownership, prepare without drive for explicitly owned Runs, and a durable, serialized node claim with request digest, owner epoch and control revision. Repetition returns the prior execution; changed contents, another owner and stale revisions are refused without a Job. Legacy drive/resume cannot act on an owned Run.

Red: the old start ignored the owner and completed automatic business work. Green: two real Host tests pass (14.182 s, two in-process Hosts, zero Electron/SSH/model/EDA). Build and typecheck pass. A final explicit unknown-action refusal was added after this run; the integrated suite will recheck it.

The Ledger format is now 20 so an old build cannot erase ownership by reading it. Backed-up version 19 import, production-default switchover, real node work/completion/control, restart reconciliation, UI and model checks are still under implementation. This checkpoint is not PLS-19 acceptance and does not close #22. All original tests remain; `agent-execution.host.test.ts` uses the existing real Host and public Hima service seam.
