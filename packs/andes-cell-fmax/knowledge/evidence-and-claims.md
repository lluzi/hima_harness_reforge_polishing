# Evidence and claims

## Tool results (the only numbers that count)

Every number in a round record comes from a tool report the Pack's own steps produced: the sapr
post-route summary (Fmax, worst slack, TNS, area, instances, route DRC, new-cell instances), the
HimaTime load and verification, the Qualib screen and AndesCell's generation record. The Readers
read those files; the round record compares the new-library build with the reference build.

## Claims

What an agent writes (its analysis, its expected gain, a `himatime estimate` it ran) is a claim.
It guides AndesCell's choice and is shown beside the result; it is never the result.

## Never claimed

- Signoff timing, silicon, other corners, power, or a tape-out-ready cell.
- A gain from another clock or another design: the only comparison is the new-library build
  against the reference build of the same design at the same 1.000 ns clock.

## Claim boundary (verbatim in every round record and the summary)

> Every EDA result in this Pack comes from mock tools on a demo Site (mock EDA); not signoff, not silicon.
