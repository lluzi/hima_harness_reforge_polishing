# Argument cards

## A1 — OpenDB plus SQLite is the Phase-1 persistent substrate

- **Judgment:** Use OpenDB for immutable physical/netlist snapshots and SQLite for Hima IDs, annotations, lineage, CrossPhaseMap and LocalWindow manifests.
- **Mechanism:** OpenDB supplies an EDA-native LEF/DEF object model and binary checkpoint; SQLite supplies append-only relational records, JSON, spatial indexing and transactions without a service.
- **Supporting cases:** OpenDB exposes physical objects and scalar properties; the current Site already contains Python-enabled OpenDB. SQLite 3.51.0 with JSON and RTree is already available locally.
- **Strongest rival:** A single embedded property-graph store such as LadybugDB.
- **Boundary:** This judgment fails if retained AES exports cannot be imported deterministically, or if the dual projection causes more identity code than a graph-native store removes.
- **Decision effect:** Approve POC-1 and POC-2 before building a larger DIG service.

## A2 — HAL is a CCEI/logic-analysis backend, not the design database

- **Judgment:** Evaluate HAL behind the existing resynthesis contract for parsing, Boolean subgraphs, traversal and selected-subgraph resynthesis.
- **Mechanism:** HAL already has gate/net/module objects, structural Verilog and Liberty import, Python bindings, igraph projection and Yosys-backed resynthesis.
- **Supporting cases:** Its documented NetlistGraph maps vertices back to gates, and its resynthesis plugin operates on selected subgraphs.
- **Strongest rival:** Continue expanding the repository's custom parser and graph engine.
- **Boundary:** HAL lacks complete DEF/SPEF/SDC/STA ownership; its multi-output custom-cell behavior and current foundry Liberty compatibility are unproved.
- **Decision effect:** Run a bounded adapter POC without changing the public CCEI request/result schema.

## A3 — Timing is a replaceable annotation producer

- **Judgment:** Use the installed OpenSTA for the first LocalWindow POC and benchmark MIT-licensed OpenTimer; keep Innovus as commercial-label authority.
- **Mechanism:** Both engines consume standard timing artifacts and can annotate the same graph projection, while neither owns physical truth or cross-phase identity.
- **Supporting cases:** OpenSTA is installed with OpenROAD and has a network-adapter model; OpenTimer exposes incremental C++ timing APIs under MIT.
- **Strongest rival:** Treat OpenSTA's timing graph as the entire DIG.
- **Boundary:** Proxy ranking and critical-arc semantics must be measured on retained AES windows; input-format support alone is not correlation evidence.
- **Decision effect:** Prevent timing-engine objects from becoming persistent Hima IDs.

## A4 — Property-graph databases remain rebuildable query views

- **Judgment:** Benchmark LadybugDB, but do not make it authoritative in Phase 1.
- **Mechanism:** Cypher and CSR adjacency may reduce traversal and lineage-query code, while a rebuildable projection contains the maturity and migration risk.
- **Supporting cases:** LadybugDB is embedded, MIT-licensed and actively released; archived Kuzu and server products are weaker product dependencies.
- **Strongest rival:** Use LadybugDB as the sole DIG store immediately.
- **Boundary:** Promotion requires deterministic export/restore, schema migration, macOS/Linux packaging and a material code or performance advantage on the AES corpus.
- **Decision effect:** POC-5 compares it with SQLite using identical IDs and queries.
