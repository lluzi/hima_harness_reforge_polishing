# Intent

A person asks HimaHarness for a faster aes on open-source SKY130. One Campaign runs a stock ORFS
baseline, then a resident OpenCode engineer studies the result, proposes and builds new standard cells
(single-output and multi-output), and each round HimaHarness measures them independently: two
matched ORFS arms, same recipe and library, custom cells allowed in one and forbidden in the other.
Measured lessons feed the next round. The Campaign stops at the Goal (default: 5 % matched Fmax gain
over the stock control at the same clock), after two rounds without improvement, or at four rounds.

Safety and honesty boundary:

- The ORFS checkout, celluzi and bool2cmos are read-only; every output is under the Campaign workspace.
- Custom-cell timing is modelled from foundry tables, never characterized; the summary says so.
- Every number shown as a result comes from ORFS files through a Pack Reader; the engineer's own
  trial numbers are shown next to it as a claim.
- No licence, no commercial tool, no signoff or silicon claim.

Demo-only Pack on branch `customer-demo`; not a release candidate.
