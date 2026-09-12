# PLS-19 control checkpoint — incomplete task

Three actual Host tests pass: prepare without business work, owned/versioned/idempotent node admission, and pause plus explicit handoff. Epoch changes fence the prior owner even for a previously accepted request. Goal and budget remain unchanged. Growth/revision explicitly return unsupported pending PLS-10/11. Act node admission counts one attempt; Job helpers will count physical launches separately.

Red control test failed because pause was unimplemented. Green: 3/3, no skip, 10.185 s, three in-process Hosts, no Electron/SSH/model/EDA. Build and typecheck pass. Real node work, completion, recovery/default switchover and integrated model/UI validation remain in progress.
