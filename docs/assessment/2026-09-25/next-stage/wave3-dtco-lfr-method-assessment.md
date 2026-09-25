# Wave 3 Lane B — portable DTCO seal and LFR terminal assessment

Date: 2026-09-25. Authority:
[issue-closure-plan.md](issue-closure-plan.md), Wave 3 Lane B. Source baseline before this lane was
`5b4ef73b`; the exact delivery commit is recorded after synchronization.

This receipt owns only Issues #38 and #40. It does not change the shared Issue map, closure plan or
Wave 3 aggregate receipt. It preserves the distinction between method readiness and business value:

- #38 is **PASS** for the portable method and current sealed Pack;
- #40 is **TERMINAL_NEGATIVE** for the bounded residual-frontier study;
- #39 still owns the one held-out matched L5 value attempt. Nothing here claims a 5% Fmax gain.

## #38 portable method readiness — PASS

The released method is `custom-cell-fmax-dtco@5.2.16`, method digest
`7b4a59be2a412d0052601b3384e5a2be35d2664c0ea7094206699f6e020fcbff`.

### Portability and invariants

- `contract.yml` binds `designRoot`, `rtlGlob`, `designTop`, `constraints`, foundry Liberty, physical
  inputs, tool stack and workspace through the Site. It does not bind `aes_cipher_top`, a fixed
  process path, a customer flow or a Golden Flow input.
- The current contract test admits two independent design-top bindings,
  `held_out_control` and `held_out_datapath`, and rejects a missing production binding. A second test
  changes RTL bytes and top identity and proves that the probe identity changes with them.
- The Pack method may cite AES as retained calibration evidence and uses the authoring-format
  `Golden Flow` heading to point to its own executable reference. Neither is a customer invariant.
- The current Site contract includes separate text Liberty and compiled Design Compiler DB inputs,
  SHA-bound foundry CDL identity, current DCCK/PG/occupancy fields and discovered Yosys/ABC identities.
  Issue #44's Run `run-9bb8ec08-9014-41c4-a563-745c1ec19506` executed the same current digest through
  `compile -> read-compile -> foundry-synth -> read-foundry-synth`; LC and DC exited 0, the DC
  netlist was non-empty and the actual DC log had no `DB-1` error.

### Real model variation

The retained frozen-pool A/B used two native `deepseek-official/deepseek-flash` turns with no replay
and no tool schema. Its validator runner SHA-256
`5d9407503073dd8c10e3e1a8be48307b00474c88db832322aa7f730f8b3f0847` is exactly the current
`flow/ai_research_runner.py` byte identity sealed in `VERSION.yml`.

Both arms shared the same 77-proposal pool, budget and non-commercial sources. The without-feedback
and with-feedback programs each selected six proposals; five were added and five removed. This is
real model-produced executable algorithm variation accepted by the current Pack loader, validator
and isolated runner. It is deliberately recorded as one uncontrolled, non-causal sample: there was
no fixed seed, no A/A baseline, no EDA execution and no PPA claim.

The current terminal Pack test independently used a real `deepseek-flash` Campaign owner and wrote
CodeRecord `run-a148dd0c-2d2d-42b0-8c32-5179d40ad254#000119`, SHA-256
`bbfb58812c637e1b71bc079fc5ecb180758e8c35e16ebc571d3a24767e74cfc7`. The code read the current
candidate pool and produced one source-bound Cell Demand; no candidate id or proposal key was fixed
in Pack method bytes.

### Traceability

The current contract suite proves the complete identity chain at the lowest sufficient layer:

1. changed current RTL/netlist bytes change source-linked mined candidate identities;
2. the Workshop report binds source reports, current evidence, exact authored-code SHA and selected
   proposal key;
3. merge resolves the proposal back to an immutable generation request and `hima.cell-demand/1`;
4. generated/layout/characterized physical Cell identities remain distinct from demand and offer;
5. synthesis adoption is read from the mapped netlist and attributed non-additively to contributing
   methods;
6. final routed adoption is read from the restored final database, not inferred from synthesis;
7. comparison re-reads final timing and physical reports and rejects a stage record that contradicts
   retained report bytes.

The real trial.24 generation-7 chain remains supporting commercial evidence for the older 5.2.10
method: 374 synthesis-adopted instances reached a matched final-DB comparison. It is not reused as
the current release test and does not establish a positive result.

### Native test and release

Current Run `run-a148dd0c-2d2d-42b0-8c32-5179d40ad254` was a real Host/Fabric/Ledger Pack test on
the current digest and current Site/input identities. It completed the Site binding, real Yosys/ABC
baseline, six miners/readers, function-local evaluation, real-model Workshop, one five-drive Cell
family, layout, characterize, Readers and Judges. The deliberately strict `0.000001 ns` Cell Demand
produced 0/1 Demand coverage, `mock-liberty-calibration-accepted` FAIL and
`cell-demand-feedback-available` PASS. The Pack chooser returned to research and the declared
one-generation budget ended the Run `ended-budget-exhausted` by `generation-limit`.

All 27 Jobs exited 0. No compile, DC, Innovus, P&R, compare or commercial licence was launched in
this test. The negative guard result is a test of honest routing, not a PPA result.

The same native authoring session wrote `TEST.md` from that terminal Run, then
`hima_pack_release` generated `VERSION.yml`. The seal binds the method digest, TEST Run and every
method-file SHA. Evidence is retained in
[wave3-dtco-lfr-test/evidence.json](wave3-dtco-lfr-test/evidence.json).

## #40 residual-frontier assessment — TERMINAL_NEGATIVE

### Retained commercial observations

The bounded assessment starts from valid retained results rather than a new expensive EDA search:

| Evidence | Residual/frontier observation | Commercial result |
| --- | --- | --- |
| V5 first-principles E0 | 530/530 endpoints, frozen 5% frontier 128 -> 127; 321 improved, 187 worsened, 22 unchanged; 126 original frontier endpoints remain and one new endpoint entered | WNS -57 ps -> -57 ps, Fmax 0.000%; TNS +0.756 ns and area/wire/modelled-power improved |
| five-generation method review | Cell-delay and structure changed, but endpoint overlap was very small; clock/CQ/setup/path migration and boundary effects remained material. Gen1-3 reused one program, Gen4 read absent fields, Gen5 replay reduced to first-40 and did not consume commercial response | four valid comparisons had no positive Fmax; the fifth generation never reached commercial comparison |
| trial.24 generation 7 | original 42 Demands plateaued with three unmet; acceptance came from narrowing to 38/38 rather than solving the three residual Demands; generation 8 narrowed to 7/7 and did not complete P&R | matched, valid final comparison: 1773.05 MHz -> 1721.17 MHz, **-2.93%**, 374 adopted synthesis instances |

These facts reject three tempting but unsupported conclusions:

- more candidates or a fully covered smaller Demand set is not progress on the frozen frontier;
- endpoint count, local Cell delay or synthesis adoption alone does not predict final Fmax;
- program-text change or a cited feedback hash is not evidence that the algorithm used commercial
  response semantically.

### What the current method repaired

5.2.16 repairs the deterministically demonstrated mechanism gaps: typed Cell Demand, fail-closed
field access, executable feedback A/B, D1/D2/D4/D6/D8 physical families, current Site identity and
native release evidence. The current real-model A/B establishes executable selection variation, and
the terminal test proves the strict Demand negative branch. Those are method-readiness facts.

They do not overturn the retained commercial labels. The A/B is non-causal and contains no E0; the
current Pack test intentionally stops before commercial EDA; the only complete matched residual
Campaign results remain 0.000% and -2.93% against the 5% target. No retained endpoint/cell-delay/
Cell-Demand or cross-generation program difference identifies a new bounded Portfolio whose expected
value is independently supported strongly enough to authorize another commercial search inside
#40. Candidate count is therefore not used as a progress meter and no EDA rerun was necessary.

### Terminal decision and claim limits

#40's method study is **TERMINAL_NEGATIVE**:

- the Framework, Pack integration, current real-model seam, real Site test Campaign and release seal
  are complete;
- the bounded residual-frontier assessment did not establish a positive method result or a new
  evidence-backed commercial-search direction;
- the valid negative commercial observations and the current honest negative guard are retained;
- future optimization research requires a new Issue, budget and success criterion;
- #39 may still run its separately owned held-out L5 attempt using the sealed portable method. A
  positive or negative #39 result does not rewrite this method-study verdict.

## Verification and rollback

- TypeScript typecheck passed before the live test.
- Current Pack/LFR focused local suites and seal checks are recorded with the delivery commit.
- The real test used 27 Jobs, zero commercial EDA jobs, one real-model Workshop code record and one
  current Pack release operation.
- Source Liberty, physical-input profile and tool-stack hashes were unchanged before/after; final
  Site state was `selected=new old=inactive new=active` with no active XTop, QuaLib, DC, LC or
  Innovus process.
- Native release temporarily materialized source-Pack-local method history and Run assets. They were
  preserved, not deleted or committed, by moving them to
  `.hima-tmp/wave3-dtco-lfr-source-runtime/`. The archived `.hima-method-history` inventory has 161
  files / 2,200,173 bytes and sorted per-file SHA-list digest
  `69d4c1d5fe54d2eccf372ef6ef6458c416a6245c92422399d83e8e925691ddd5`; `run-assets` has 67 files /
  27,093,434 bytes and digest
  `efac88abcc9ded500aa9a00083a5d4f5349f7043d379923317f3e5e7e8a4655b`. The Run manifest,
  experience JSON and authored code SHA-256 values are respectively
  `6b5e0c7205704f7b58814f16b1eedcec24f219bee11e87c402364ad16e1b9679`,
  `f48b3781704784c87c8c8873ab933c8c26280b1bdf6bb19b94baa7efd81a03f0` and
  `bbfb58812c637e1b71bc079fc5ecb180758e8c35e16ebc571d3a24767e74cfc7`. Each inventory digest is
  SHA-256 over the lexically sorted lines produced by `sha256(file-bytes)  relative-path`.
- Rollback is the Lane B delivery commit. Reverting it removes the current TEST/seal, evidence,
  assessment and live-check helper; it does not delete retained Runs, Site workspaces, trial
  evidence, local `run-assets`, method history or user-owned `tmp/`.
