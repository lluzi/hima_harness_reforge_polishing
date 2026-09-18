# Trial 0.3.0-trial.5 failure review

Date: 2026-09-17

Run under review: `run-84e5e64b-3fa4-478c-bf96-e97481fa509c`

Verdict: `FAIL` for the Campaign business exit. The trial proved parallel licence-free branches,
Workshop recovery and a real Library Compiler invocation, but it did not reach E0 or a matched
post-route Fmax result.

## First blocking defect

The Site supplies two different views of the baseline library:

- Liberty text is consumed by mining, characterization scaffolding and physical implementation;
- the compiled `.db` is consumed by Design Compiler.

Pack 5.1.0 derived `FOUNDRY_DB` from the same `foundryLibrary` input used for the Liberty view. The
trial therefore passed a `.lib` file to Design Compiler, which stopped with `DB-1: File is not a DB
file`. The Site's matching compiled DB existed and the trial Agent demonstrated in an isolated
scratch workspace that DC completed when that file was used. This excludes the DC wrapper and
licence as the first cause.

## Candidate-fix review

The trial left an uncommitted candidate change to `flow/bind-inputs.py`. Its direction was correct,
but it could not be merged as written:

1. It put `FOUNDRY_DB_FILE` in the mandatory-file list, making its documented legacy fallback
   unreachable.
2. It changed only `flow/bind-inputs.py`; the Pack executes and seals both the `flow/` and `tools/`
   copies.
3. The sealed 5.1.0 identity still described the old bytes.

Version 5.1.1 keeps the existing Site-profile seam. `FOUNDRY_DB_FILE`, when present, is validated
and becomes `FOUNDRY_DB`; when absent, the existing single-file `foundryLibrary` behavior remains.
Both Pack copies are byte-identical and the Site-profile knowledge names the distinction.

## Verification

- Regression command: `node scripts/run-contract-tests.mjs local --files
  test/contract/custom-cell-fmax-pack.test.ts` under Node 24.
- Before the correction, the compatibility case failed because `FOUNDRY_DB_FILE` was treated as
  mandatory.
- After the correction, all 26 selected Pack contract tests passed. The binding test checks both a
  split `.lib/.db` Site and the legacy single-file fallback.
- A read/bind-only check on the real AES Site produced `DESIGN_TOP=aes_cipher_top`, a `.lib`
  `FOUNDRY_LIB`, a distinct `.db` `FOUNDRY_DB`, and launched no new P&R.
- The retained trial scratch DC log ends in `CUSTOM_CELL_FMAX SYNTHESIS_COMPLETE base`, with a normal
  tool exit. It is reused evidence; no commercial synthesis or P&R was rerun for this maintenance
  release.

The trial's Pack-install disabled-button finding remains a separate UI usability issue. It did not
cause this Run's commercial failure and is not folded into the Pack maintenance fix.
