# Information Graph database research outline

Audience: HimaPack/LFR developers and methodology owner.
Decision: choose the fastest credible substrate for immutable place/post-route DIG snapshots, graph-native local proxy annotations and cross-phase mapping without introducing a second P&R chain or customer-operated service.
Scope: open-source components usable from macOS development and Linux/Rocky-class EDA Sites; primary-source facts current on 2026-09-16.

## Questions

1. Which EDA-native database can ingest Innovus-exported Verilog/LEF/DEF/SDC/SPEF while preserving stable physical/netlist identities?
2. Which existing timing/netlist engine exposes the graph and incremental queries needed by LocalWindow proxies?
3. Which component can persist versioned custom annotations and cross-phase correspondence without corrupting base facts?
4. What are the integration, licensing, deployment and maintenance costs of each serious option?
5. Should Hima adopt one database or compose an EDA object model with a separate annotation/index layer?
6. What bounded POC can falsify the preferred architecture on the retained AES evidence?

## Provisional theses

- T1: OpenDB is the strongest ready-made physical/netlist object model, but it is not by itself the complete DIG/annotation database.
- T2: OpenSTA, OpenTimer and iSTA are timing engines/views rather than the authoritative persistent digital-twin store.
- T3: HAL is unusually close to graph-native logical analysis but lacks the physical/STA coverage required as the sole substrate.
- T4: An external graph service is unnecessary for Phase 1; immutable EDA snapshots plus an embedded annotation/index store and in-memory graph algorithms are likely cheaper and safer.

## Rival explanations / defeat evidence

- R1: iDB+iSTA may be more turnkey than OpenDB+optional STA; defeat T1 if its formats, API, maturity and license are clearly better for our exported commercial data.
- R2: Kuzu or another embedded property graph may simplify persistence and traversal enough to justify becoming the canonical DIG store; defeat T4 if EDA object ingestion and versioned annotation are materially simpler without operational burden.
- R3: OpenDB custom properties may already satisfy all annotation/versioning needs; defeat the separate annotation layer if properties are stable, serializable, queryable and provenance-friendly.
- R4: HAL may ingest our exact gate netlist and support physical metadata/plugins sufficiently to replace a custom DIG builder; defeat T3 with primary evidence.

## Reader-value test

After reading the report, the owner can choose a Phase-1 stack, name what each component owns, reject unsuitable alternatives for explicit reasons, and approve a POC with measurable continue/stop gates.

## Outline changelog

- 2026-09-16: initial six-question scope; added iEDA and embedded property-graph rivals so OpenROAD is not assumed in advance.

- 2026-09-16: evidence showed Kuzu is archived and LadybugDB is its active MIT successor; added Ladybug as the embedded property-graph benchmark.
