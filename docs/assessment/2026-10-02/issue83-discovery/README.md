# Issue83: reviewed wrapper list blocked Site Rediscover

The independent FL reached normal Campaign configuration with ATCS 0.3.1 installed, but Rediscover
returned `"hints.allowedWrappers" too big: expected array to have <=16 items`. Readiness therefore
kept start disabled. No Campaign, Run, model or EDA work had started. The original GUI evidence and
failed candidate remain retained; this correction does not change their verdict.

The saved administrator Permit has 33 wrappers. `index.ts:discoverSite` reuses those exact values
and merges the selected Pack's hints, then validates through `siteDiscoveryRequestSchema` before
any discovery probe. The transport's old 16-item limit rejected a legitimate existing profile.

Only the existing schema's wrapper count limit changes, to an explicit finite 64. Element validation,
closed discovery probes, reviewed save identity, session ownership, actual Permit enforcement and
exact saved policy bytes are unchanged. There is no ATCS-specific branch and no wrapper truncation.

## Verification

Development: user-selected GPT-6 Astra/High; one scoped independent GPT-6.1 Sol/High review. Product
DeepSeek4.1Flash and field Opus5.5/High remain unchanged. No development model token/cost attribution
is available; zero product-model/SSH/EDA/window calls in local regression.

The tests were edited before the implementation. Against the old build, the two relevant cases
failed, including the same public Host 400 error (18 pass / 2 fail). After a fresh build:

- `node scripts/run-contract-tests.mjs local --files test/contract/site-discovery.test.ts test/contract/site-surface.host.test.ts`: 20 pass / 0 fail / 0 skip, 40.573 seconds; 6 Host processes, 4 in-process Hosts, 0 Electron, 0 SSH attempts.
- Direct discovery accepts and exactly preserves 33 and 64 wrapper entries. 65 entries and an empty
  wrapper are rejected before Channel creation.
- Public Host rediscovery reuses a saved 33-wrapper Permit, deduplicates the selected Pack's existing
  wrapper, previews then saves held facts, and preserves exact Permit bytes before and after save.
  Nearby session/review replay/stale identity and Site policy tests pass.
- Source build and both package typechecks pass. The repository test-project typecheck still reports
  the 16 inherited diagnostics (9 TS1294 parameter-property errors and 7 trial-package declaration/
  implicit-type errors), with the same locations/codes as `issue82-baseline-typecheck.log`; no new diagnostic.

Evidence: `.hima-tmp/issue83-discovery-fix/{red,green,build,typecheck}.log` and `review.md` in the actual
source worktree. The first pnpm run attempted automatic dependency verification and stopped before
running tests; using the existing Node test runner avoided dependency mutation. This setup refusal
is not counted as the failing behavior regression.

## Operator continuation and recovery

FL quit the original App normally and verified owned quiescence before replacement packaging.
Build a distinct App candidate; retain the original candidate bytes and reuse the supported explicit
`HIMA_USER_DATA`, `DSH_HOME`, `DSH_AGENTS_HOME`, `HIMA_WORKSPACE` launch path for the existing Home and
Campaign draft. Do not reinstall the unchanged Pack or precreate a discovery cache/Run. FL resumes
at Rediscover, reviews/saves actual facts through the normal GUI, then proceeds with quality-only
Fix Timing acceptance. Package smoke is not GUI business acceptance. Final candidate identities,
packaging checks and field outcome belong in the project checkpoint/candidate manifest.

Rollback source is `93660a8b01b21d50ae42ce246e82954cb69222e4`; original App and all field evidence
remain available. Pack0.3.1, Site/Permit and remote input/wrapper bytes do not change. Any actual
future Run is reconciled and stopped normally before switching App bytes.
