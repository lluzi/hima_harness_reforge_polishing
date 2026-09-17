# Retrieval protocol

## Inclusion

- Primary project repositories, official documentation, API references, licenses and release metadata.
- Features relevant to structural netlists, LEF/DEF, Liberty/SDC/SPEF, timing graphs, physical coordinates, custom properties, persistence, Python/C++/Tcl APIs and incremental updates.
- Projects with a plausible path to local/offline use inside a Pack or as a Site executable.

## Exclusion

- Marketing summaries without source/API evidence.
- FPGA-only databases unless they supply a uniquely relevant general mechanism.
- Hosted-only graph services requiring customer operations.
- Generic graph libraries presented as EDA parsers.
- Performance claims without a reproducible project source.

## Search lanes

1. OpenROAD/OpenDB/OpenSTA official docs and source.
2. iEDA iDB/iSTA official docs and source.
3. OpenTimer, HAL, Yosys/UHDM official docs and source.
4. Embedded persistence/graph options: Kuzu, SQLite, DuckDB/Parquet, igraph/NetworkX official docs.
5. Local Linglong inventory for already installed/built components.

## Stop rule

Stop each lane after ownership, input formats, API, persistence/annotation capability, license, current maintenance and one decisive limitation are established. Return only for a targeted gap that changes the recommendation.

## Queries actually used

- OpenDB/OpenROAD database API, dbProperty, binary persistence and Python bindings.
- HAL graph algorithms, placement metadata, project persistence, plugin and resynthesis APIs.
- OpenTimer standard formats, incremental timing and license.
- iEDA/iDB/iSTA physical/timing formats, database architecture and license.
- UHDM/Surelog and Yosys internal representations as logic-only alternatives.
- Kuzu/Ladybug, SQLite, DuckPGQ, igraph and service graph databases for annotation persistence and graph analytics.
- Linglong filesystem/container inventory for installed binaries and Python bindings.

## Lane stop reasons

- OpenDB: object/persistence/property capability and local availability established; AES fidelity is deferred to the POC.
- HAL: graph/netlist/resynthesis strengths and physical/timing/build limitations established.
- Timing engines: input/API/license roles established; numerical correlation is explicitly deferred.
- iEDA: integrated alternative established; insufficient evidence that adopting its full platform is cheaper than the recommended composition.
- Generic graph stores: Kuzu rejected as archived; Ladybug retained as optional benchmark; SQLite selected as the lowest-dependency baseline; server products stopped because they add operations and licensing burden without EDA parsing.
- HDL databases: stopped after confirming they do not solve post-route physical/timing state.

## Validation and protocol changelog

- 2026-09-16: added LadybugDB after evidence showed Kuzu is archived; retained it as an optional benchmark rather than assuming SQLite has no embedded property-graph rival.
- 2026-09-16: captured argument cards and an evidence-gap matrix; all 20 public links in the canonical report returned HTTP 200 during the final evidence check.
