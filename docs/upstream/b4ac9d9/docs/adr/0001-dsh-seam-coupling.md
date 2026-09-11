---
status: accepted
date: 2026-09-08
---

# Use DeepSeek Harness directly on its stable seams, wrap only the seams that move

HimaHarness ships as a DeepSeek Harness bundle and wants dsh's infrastructure, not independence from it, while dsh is a developer preview that promises breaking changes and states no versioning or deprecation policy. We decided to use dsh directly wherever a seam is documented-public and its type declarations were unchanged between the tracked versions (0.1.2-rc.1 to 0.1.5-alpha.1): bundle and profile composition, tools and guards, approvals and permission presets, skills, agent presets, storage domains, shell and sandbox and subprocess, MCP rows, and commands. Seams that changed in that window are reached only through one Hima-owned interface each: agent creation and driving, system prompt, session-log access, commands attachments, the browser remote API, telemetry rows, and jobs. Every seam has a contract test that runs on a booted Host, and the suite runs on each version bump before the bump lands. Experimental, POC, util, and test-support packages are never depended on.

## Considered options

- **Host-independent core with a thin dsh adapter.** Rejected by the owner: it forfeits the ecosystem, which is the reason for choosing dsh, and it repeats the reforge's pattern of modelling the host from documents instead of using it.
- **Use everything directly and absorb breakage as it comes.** Rejected: one week of releases changed the agent, session-log, system-prompt, and commands APIs; unbounded exposure would make every upgrade a rewrite risk.

## Consequences

- A dsh upgrade has a known blast radius: the wrapped seams first, the direct seams historically stable. The evidence for the boundary is `docs/research/2026-09-08-dsh-architecture-and-integration.md`, section 8 for the delta and section 10.4 for the per-seam contract tests.
- The boundary is re-measured, not assumed: if a "stable" seam changes at a later bump, it moves to the wrapped list in this ADR's successor.
- Approval memory, the permit file, and durable job identity are Hima-owned by construction, since dsh's approval is one-shot with no grant store and its jobs are process-local.
