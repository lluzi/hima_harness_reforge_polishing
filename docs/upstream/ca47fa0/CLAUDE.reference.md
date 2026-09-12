# hima_harness_reforge_claude

## Project context

Read before any product or engineering work: [docs/product-idea.md](docs/product-idea.md) for what HimaHarness is and the three-month cut; [docs/product-decisions.md](docs/product-decisions.md) for every decision with its reason, reopened only on new evidence; [CONTEXT.md](CONTEXT.md) for the vocabulary, used in every record and title; [docs/adr/](docs/adr/) for engineering decisions; and the engineering constitution at `/Users/lluzi/code/hima_harness_reforge_codex/docs/engineering-constitution.md` for the working rules: smallest reversible verified change, root cause first, stop when unclear.

Prior attempts under `/Users/lluzi/code/` (`himaharness`, `hima_reforge`, `hima_harness_reforge_codex`) are studied, never imported or quoted. The reference archive of legacy runs is `hima-reference-2026-09-08.tar` under `/data/eda/project/hima_harness/archive/` on the site and under `/Users/lluzi/code/hima-reference-archive-2026-09-08/` on this Mac; its README's first line applies to every use of it.

The EDA site is `linglong`, reached as `luzi@192.168.50.41` on the LAN; the Tailscale address times out from this Mac. Its operating rules are `/Users/lluzi/Documents/EDA_SERVER_AND_DESIGN_ZOO_AGENT_GUIDE.md`: probe read-only first, one large DC or Innovus job at a time, preserve run directories. Credentials and API keys come from the owner's environment, never from a file the agent writes.

## Agent skills

### Issue tracker

Issues are tracked as GitHub Issues on `lluzi/hima_harness_reforge_claude` via the `gh` CLI. See `docs/agents/issue-tracker.md`.

### Triage labels

The five canonical triage roles map 1:1 to labels of the same name. See `docs/agents/triage-labels.md`.

### Domain docs

Single-context: one `CONTEXT.md` and `docs/adr/` at the repo root. See `docs/agents/domain.md`.
