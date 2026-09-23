# HimaHarness ecosystem reuse research contract

Date: 2026-09-22. Source baseline: 47ce341a5a8b9891e8ca168ba3477cca1d0e154a.
Lead synthesizer: root. Audience: Hima product owner, EDA developers and Pack authors.
Decision: how to improve the six reviewed areas with the smallest maintainable investment, choosing existing internal, DSH-native, community and adjacent OSS components.
User value words: 深刻、广泛的洞察; 借用生态组件; 提升开发效率.
Scope: research and static interface/source/metadata checks. No dependency installation, architecture mutation, EDA jobs, native API debugging or resumption of paused trial30. Existing reference workspaces and user tmp remain untouched.
Artifact: one Chinese decision report plus component/evidence matrix, sources and validation record. Library Intelligence retains accepted three user analyses and one Workbench. Single Campaign owner and Fabric/Ledger/Permit authority remain.

## Living outline
1. Native DSH capabilities already installed but underused: subagents, roles, context, lifecycle, control.
2. HimaGuide: grounded product context, preparation, research, knowledge and first useful result.
3. Pack authoring: specification-to-artifact workflow, semantic checks, fixtures, feedback evaluation, release.
4. Human UI: shared selected object context, graph navigation, status and recovery; component seams.
5. Library Intelligence: typed reports, plots/tables, data query and native API boundary.
6. Ecosystem strategy: direct reuse vs adapter/extraction vs pattern-only vs defer, license/compatibility/maintenance.
7. Sequenced low-cost POCs with pass/fail criteria and customer/developer value measurements.
Outline changelog: initial seven questions carry all six requested upgrade areas; competitive positioning is evaluated as component leverage and retained differentiation, not repeated vendor marketing survey.

## Provisional theses, rivals and falsifiers
T1. Largest near-term leverage comes from already pinned DSH seams, not a second agent framework. Rival: native APIs cannot enforce lifecycle/permissions. Falsifier: actual source/API gaps that require a new controller for a bounded advisor task.
T2. Typed data projections and shared context solve more user friction than generative UI alone. Rival: free-form GenUI gives equivalent trustworthy output much faster. Falsifier: matched fixture test shows both semantic invariants and workflow/control survive unconstrained output.
T3. Guide/Pack quality is an integration and evaluation problem, not prompt length. Rival: richer prompts alone remove observed errors. Falsifier: frozen cross-stage cases pass reliably without structured recovery/context contracts.
T4. Selective community reuse accelerates delivery but full plugin installation may import wrong authority/permissions. Rival: configuration safely removes all such differences. Falsifier: verified defaults/schema/runtime contract make unmodified plugin compatible with Hima semantics and footprint.

## Retrieval protocol
Inspect current lockfile and actual installed code first, then official DSH repository/docs and community index. Review source/package/LICENSE at pinned commits for shortlisted community packages. Use official docs/source for adjacent libraries. Do not rely on stars, README slogans, semver ranges or automated checks as proof of product fitness. Record discovery candidates and rejection reasons; inspect actual source for consequential choices. Only fetch targeted files/bounded clones into .hima-tmp, never install executable packages.
Stop each lane when choice, interface seam, license basis, failure modes and smallest falsifying POC are defined. Delta-query only for a decision-changing gap. Native vendor API behavior remains unqualified until a separate authorized real check.

## Acceptance
A developer can identify what to reuse, exact pin/license, integration owner and boundary, what remains Hima-specific, and cheapest proof. Product owner can see how each choice reduces customer friction or validated engineering cost. No invented speedup, no unknown license presented as approved, no untested import presented as integrated capability.
