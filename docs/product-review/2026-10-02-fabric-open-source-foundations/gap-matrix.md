# Evidence gaps and decision boundaries

| Question | Support | Counter-evidence | Confidence | Missing / next action |
|---|---|---|---|---|
| Preserve business semantics | Current Hima fixed-SHA code; engine outputs do not encode Goal/Reader | Full graph interpreter might delete more legacy code | High distinction; adoption ranking conditional | Compare one identical workload after user selects scope |
| DBOS first durability candidate | TS library, Postgres, persisted result replay, source owner fencing | zombie external effects; sequential identity; Conductor HA optional/proprietary | High mechanism, unknown net cost | No claim of measured improvement; pin runtime engines for actual spike |
| LangGraph graph candidate | explicit edges/result updates, sync checkpoints, pure nodes | latest-graph resume; interrupt whole-node replay; duplicate Ledger/checkpointer truth | High mechanism, unknown integration | Single commit authority design before adoption |
| External effects exactly-once | DBOS concurrent docs, Temporal idempotency, Restate database duplicate example | Can close window if target accepts transactional idempotency or query/reconcile | High limitation | Actual Site/EDA adapter support untested |
| Service acceptance | Temporal/Restate deployment docs | Local/offline simplicity requirement may dominate | User preference unknown | Optional question pending; retain conditional choices |
| Durability vs maturity | Current releases/licences fixed | Recent conflict/resume/state bugs, Effect unstable APIs | High current status; reliability not measured | No production/SLA claim |
