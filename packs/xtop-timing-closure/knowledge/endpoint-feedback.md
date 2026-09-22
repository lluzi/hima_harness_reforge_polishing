# Endpoint feedback contract

The strategy owner reasons about the timing graph through stable endpoint keys:

`scenario | setup-or-hold | path-group | endpoint`

For consecutive refreshed PrimeTime states:

- **fixed**: previously negative, now absent from the negative set;
- **remaining**: negative before and after;
- **entrant**: newly negative after the ECO and physical refresh;
- **regressed**: remaining and worse by more than 1 ps;
- **improved but remaining**: remaining, not regressed, with less-negative slack.

The next plan must name the endpoint groups it targets and state why a setup-size, setup-buffer,
hold-size or hold-buffer action should help. A previously failed action may be retried only when new
evidence changes its hypothesis: a different endpoint family, altered RC, different opposing margin,
or a bounded effort change. The plan must also state which action it avoids and why.

Global WNS alone is insufficient. WNS can remain unchanged while many endpoints and TNS improve;
it can improve while new endpoints enter. Selection of the best database therefore uses complete
violation counts, negative slack mass and worst slack, while the report keeps the endpoint sets
separate. No scalar is treated as proof that one action caused every global change.

