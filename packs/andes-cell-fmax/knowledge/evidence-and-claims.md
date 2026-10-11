# Evidence and claims

## Tool results (the only numbers that count)

Every number in a round record comes from a tool's own output, produced by the Pack's steps or
re-asked by its Readers: the sapr summary at route (reg2reg worst slack, TNS, violating paths, the
path groups, density, power, the clock tree, custom-cell instances), the HimaTime load and its
high-value analysis and cell what-if, Qualib's library analysis, AndesCell's generation record,
HimaTime's cell-level check and the Qualib screen. The charts (`*.chart.json` under
`reports/<step>/r<k>/` and the Pack's generated `knowledge/charts/`) are tool results too: a Pack
step or the Reader that accepts a delivery writes each one from a tool's own output, and the agents
never type their numbers. Every delivery is drafted from a tool's output and checked against the
tool again: the Reader states the tools' numbers, never the agent's. The round record compares the
custom-cell build with the reference build **at the end of route, path group reg2reg**.

## Claims

What an agent writes (its summary and analysis, the AndesCell agent's reason) is a claim. It guides
the next step and is shown beside the result; it is never the result. A delivery whose numbers
disagree with the tools is refused.

## Never claimed

- Signoff timing, silicon, other corners, or a tape-out-ready cell.
- A gain from another clock, stage or design: the only comparison is the custom-cell build against
  the reference build of the same design at the same 0.500 ns clock, at the end of route.

## Claim boundary (verbatim in every round record and the summary)

> Every EDA result in this Pack is replayed by mock tools on a demo Site (mock EDA) from measured flow data; a custom-cell build's CTS and route timing follow the Site's stated basis (see the build's basis); not signoff, not silicon.

The round record also carries the build's `basis` as the Site states it. Both stay in the records.

## In the conversation with the person

The records above carry the claim boundary word for word. A report the App shows (`round-<k>.md`,
the charts) says it in plain words instead, and says that the timing is at the end of route. In
chat, say it once, in the final summary only, as: "These are results on the demo Site
eda_cluster_ctu_01, not signoff and not silicon." Say also, once, that the results are the timing at
the end of route (path group reg2reg). Do not repeat the sentence in status replies. Use exactly
that sentence and do not paraphrase it: in the conversation and in summaries, call the tools by
their names (Synthesis and APR, HimaTime, Qualib, AndesCell) and the Site "the demo Site
eda_cluster_ctu_01"; never call the tools or results "mock", and never call a result "modelled" or
"a model".
