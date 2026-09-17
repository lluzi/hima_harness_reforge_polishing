# Evidence gap matrix

| Gap | Why it matters | Cheapest falsifying test | Pass evidence | Owner after pass |
| --- | --- | --- | --- | --- |
| OpenDB import fidelity on retained AES place/post-route exports | Determines whether OpenDB can be the physical mirror | Import one paired bundle, save/reload, compare counts/connectivity/geometry and projection hashes | Explicit exclusion list, deterministic hashes, no silent loss of custom multi-output pins | DIG importer |
| Stable Hima identity and CrossPhaseMap | OpenDB/HAL IDs do not cross independent snapshots | Match known sensitive regions across the paired AES snapshots using name, topology and function evidence | One-to-one/one-to-many/many-to-one/ambiguous/absent cases round-trip | Annotation store |
| HAL compatibility with foundry and augmented libraries | Determines whether it saves CCEI implementation work | Load one AES hierarchy and selected custom cells; extract/rewrite one bounded window | Object counts reconcile; Boolean proof and provenance survive export | CCEI backend adapter |
| Multi-output local resynthesis in HAL | Required for the main custom-cell opportunity class | Match one two-output and one three-output cell in retained windows | Functionally equivalent netlist plus explicit old-to-new provenance | CCEI backend adapter |
| OpenSTA/OpenTimer proxy relevance | Input support does not prove ranking usefulness | Run the same LocalWindows and compare arcs, alternatives and ranks to Innovus facts | No unexplained critical-arc loss; disagreement is recorded rather than averaged away | Local proxy adapter |
| SQLite graph-query sufficiency | Avoids a premature new database dependency | Run k-hop, bbox, CrossPhaseMap, lineage and LocalWindow queries on AES | Meets bounded latency and keeps implementation understandable | DIG store |
| LadybugDB value over SQLite | Tests whether property-graph semantics justify adoption | Import identical corpus and benchmark identical queries/export/restore | Material code reduction or performance gain with deterministic recovery | Optional query index |
| OpenSTA license path | May constrain product packaging | Record actual process boundary and distribution form before product integration | Approved distribution/linking decision or OpenTimer replacement | Packaging/legal gate |
