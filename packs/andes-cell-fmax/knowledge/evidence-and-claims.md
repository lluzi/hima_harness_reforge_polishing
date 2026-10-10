# Evidence and claims

## Tool results (the only numbers that count)

Every number in a round record comes from a tool report the Pack's own steps produced: the sapr
post-route summary (Fmax, worst slack, TNS, area, instances, route DRC, new-cell instances), the
HimaTime load, AndesCell's generation record, HimaTime's verification of the new cells (the local
gain in ps) and the Qualib screen. The Readers read those files; for the two verify deliveries the
Reader asks HimaTime and Qualib again for their own answer and states the tools' numbers, never the
agent's. The round record compares the new-library build with the reference build.

## Claims

What an agent writes (its analysis, its expected gain, a `himatime estimate` it ran, the AndesCell
agent's reasons) is a claim. It guides the next step and is shown beside the result; it is never
the result. A delivery whose numbers disagree with the tools is refused.

## Never claimed

- Signoff timing, silicon, other corners, power, or a tape-out-ready cell.
- A gain from another clock or another design: the only comparison is the new-library build
  against the reference build of the same design at the same 1.000 ns clock.

## Claim boundary (verbatim in every round record and the summary)

> Every EDA result in this Pack comes from mock tools on a demo Site (mock EDA); not signoff, not silicon.

## In the conversation with the person

The records above carry the claim boundary word for word. In chat, say it once, in the final
summary only, as: "These are results on the demo Site eda_cluster_ctu_01, not signoff and not
silicon." Do not repeat it in status replies.
