# Current lead L4: native R1 recovery timezone mismatch

v24/source3f00fd86 reached fresh common native R1, then both worker and reservedlead startup failed
at open_workspace with libraries reported modified. Current FL retained library-identity.json shows
21/21 saved timestamps match batch America/Los_Angeles and0/21 UTC. Library hashes, stat/mount
identity and qualified image are unchanged. Two private-copy native probes: defaultUTC open_rc1;
America/Los_Angeles open_rc0. This is Site-wrapper ownership, not a Harness or flow defect.

v25/Pack0.2.4 pins the interactive container TZ to America/Los_Angeles, changes only wrapper/Permit/
version identity and retains the flow unchanged. No unchecked open flags or changed source libraries.
The existing graph/contract cheap check now compares that runtime timezone with the retained real
tech LEF mtime1736302054 saved as2025-01-07T18:07:34 (UTC would be2025-01-08T02:07:34).

Report: .hima-tmp/hltbf/issue66-v24l4-3f00fd86/LEAD-L4-REPORT.md. UTC/native probe took19s; changed-TZ
probe took19s, both serial with old license. Clock-format diagnostic in the LA probe exposed absent
vendor Tcl tzdata, while open_rc0 was observed; the qualified toolkit uses no clock-format command.
No additional fix is claimed for that diagnostic or the failed-startup REPL observation.

FL teardown evidence independently compared:196 before/after exact same PID/start identities,0 new;
zero live owned EDA/container/App. Product model was not called. Same fresh Opus5.5/High FL may continue
from the retained fresh R1 after this pushed successor's pins are installed. Model lead/replay/own ECO/
Innovus input and current production binding remain unverified until that continuation completes.
