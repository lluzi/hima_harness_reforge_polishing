# LibInsight resident custom analysis 0.1

## Business

A library user asks Data Insight a question that no fixed LibInsight page answers ("how does
inverter delay scale with drive strength at a fixed load?"). One durable Run hands the question to
the task-local resident engineering agent on linglong (ADR-0017, ADR-0020). It writes and runs
analysis code there, in facts mode over QuaLib-extracted `lib-insight-facts/1` files or in live
mode with the QuaLib 2026 Liberty API, and delivers a typed analysis package: datasets, plots,
hashed sources, the exact code and how it ran. The Pack Reader decides whether the package is
admissible; only an accepted package enters the Site's analysis library, where later questions
build on it.

## Golden Flow

One sequence runs prepare-request → custom-analysis → admit-analysis → deliver. prepare-request
binds the Host-written request to actual source bytes, facts identities, the facts corpus, the
library catalog and the licence mode. custom-analysis is the outsourced resident engineering task;
its Reader `libinsight-analysis` fails closed and returns precise problems to the same task.
admit-analysis re-checks the accepted package and places it immutably at
`<library>/<id>/v<version>/`. deliver writes the report with an explicit goalMet (admitted).

## Answers

The answer is the delivered datasets and plots, traceable to source SHA-256s and to the code text
that produced them. The summary is the resident's reading of those datasets and is shown beside
them, not instead of them. A blocked delivery (for example the QuaLib licence is in XTop mode) is
shown honestly and is not admitted.

## Ambiguities resolved

- Facts mode is the default; live QuaLib is needed only for a `.lib` without a facts file, and is
  refused before the resident starts while linglong's Empyrean licence mode is not `new`.
- An analysis id/version is immutable once admitted; a change is a new version.
- Additional sources found by the resident are allowed only with identical before/after hashes that
  the Reader re-hashes on the Site.
- The Goal is fixed at one admitted analysis (`admitted_analyses` = 1): the Run's goalMet means
  "an accepted analysis was admitted".

## Knowledge applied

`qualib-api-playbook.md` (runtime, licence, API, verified commands), `facts-schema.md`,
`custom-analysis-contract.md`, `analysis-library.md` and `example-custom-analysis.md` (a verified
SAED14 run). Grounded in the 2026-09-24 QuaLib qualification, the library-intelligence worker and
LibInsight's extractor.
