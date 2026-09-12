# Step-1 acceptance run, 2026-09-08

Site: `linglong` (luzi@192.168.50.41, LAN). DeepSeek Harness 0.1.5-alpha.1. Host booted in-process from the hima profile with every entry active; commands executed against a real agent, no model involved.

## Steps

### setup summary

```
/hima observe linglong /data/eda/project/design_zoo/pr/opene902/foundation/RPT/postroute.summary.gz --reader innovus-timing-summary --judge setup-wns-all-nonnegative,setup-wns-reg2reg-nonnegative
```

Run `run-568438eb-b618-40d2-8506-097a91af1c23`; observation sha256 `30ad024ede3fd4ca94aec44a408488ac6a499bc100d42739bae49407626e2bb5` (583 bytes).

Typed values:

- setup_wns (setup, all): -0.073 ns
- setup_wns (setup, reg2reg): 0.002 ns
- setup_tns (setup, all): -0.18 ns
- setup_tns (setup, reg2reg): 0 ns
- placement_density: 44.345 percent
- clock_period: unknown — not stated in an Innovus optDesign summary

Verdicts:

- setup-wns-all-nonnegative@1: **FAIL**, cites run-568438eb-b618-40d2-8506-097a91af1c23#000001
- setup-wns-reg2reg-nonnegative@1: **PASS**, cites run-568438eb-b618-40d2-8506-097a91af1c23#000001

### hold summary

```
/hima observe linglong /data/eda/project/design_zoo/pr/opene902/foundation/RPT/postroute_hold.summary.gz --reader innovus-timing-summary --judge hold-wns-all-nonnegative
```

Run `run-d3408e0f-0437-41d0-a3e4-26a37bb8aae7`; observation sha256 `30d0eeed609a723260d9c0f5287a145ee4ad53ec94d575e448c1ac2237361420` (574 bytes).

Typed values:

- hold_wns (hold, all): 0.034 ns
- hold_wns (hold, reg2reg): 0.034 ns
- hold_tns (hold, all): 0 ns
- hold_tns (hold, reg2reg): 0 ns
- placement_density: 44.345 percent
- clock_period: unknown — not stated in an Innovus optDesign summary

Verdicts:

- hold-wns-all-nonnegative@1: **PASS**, cites run-d3408e0f-0437-41d0-a3e4-26a37bb8aae7#000001

### DRC report

```
/hima observe linglong /data/eda/project/design_zoo/pr/opene902/foundation/RPT/verify_drc.postroute.rpt --reader innovus-verify-drc
```

Run `run-f87c9904-9a37-4278-93b5-d88db878c76d`; observation sha256 `bfebfa55c283265edc811d4b11d190eabd4ae019f893ec9d1ed5e3054d2e06cc` (183422 bytes).

Typed values:

- drc_violation_count: 1778 count

## Comparison with the site handoff metrics

Handoff row for opene902: {"period_ns":2.18,"setup_wns_all_ns":-0.073,"setup_wns_r2r_ns":0.002,"setup_tns_ns":-0.18,"hold_wns_ns":0.034,"density_pct":44.345,"drc":1778}.

Every typed value that the handoff table records matches it exactly, and every verdict has its expected outcome and cites its observation.

## Restart

After disposing the host and booting it again on the same home, every run and record read back unchanged.

## Workbench (real web profile, Hima namespace)

- setup summary: run `run-02d21a68-722a-43ac-8ced-9c6e19833709`, observation sha256 `30ad024ede3fd4ca94aec44a408488ac6a499bc100d42739bae49407626e2bb5`: setup-wns-all-nonnegative@1 **FAIL** (cites run-02d21a68-722a-43ac-8ced-9c6e19833709#000001); setup-wns-reg2reg-nonnegative@1 **PASS** (cites run-02d21a68-722a-43ac-8ced-9c6e19833709#000001)
- hold summary: run `run-8cf40a8f-ca44-4cf8-baba-61ca7585c4f5`, observation sha256 `30d0eeed609a723260d9c0f5287a145ee4ad53ec94d575e448c1ac2237361420`: hold-wns-all-nonnegative@1 **PASS** (cites run-8cf40a8f-ca44-4cf8-baba-61ca7585c4f5#000001)
- DRC report: run `run-b12c503a-191c-4f17-83e3-2ac7a82aefec`, observation sha256 `bfebfa55c283265edc811d4b11d190eabd4ae019f893ec9d1ed5e3054d2e06cc`

Client module served at `/plugins/??@hima/harness/client.js&rev=daca550d6737a57f-51` with status 200, loader envelope present.

After stopping the web host and booting it again on the same home, every run view read back unchanged.

## Remote commands run on the site (all read-only)

- `'realpath' '-z' '-e' '--' '/data/eda/project/design_zoo/pr/opene902/foundation/RPT/postroute.summary.gz'`
- `'realpath' '-z' '-e' '--' '/data/eda/project'`
- `'cat' '--' '/data/eda/project/design_zoo/pr/opene902/foundation/RPT/postroute.summary.gz'`
- `'realpath' '-z' '-e' '--' '/data/eda/project/design_zoo/pr/opene902/foundation/RPT/postroute_hold.summary.gz'`
- `'realpath' '-z' '-e' '--' '/data/eda/project'`
- `'cat' '--' '/data/eda/project/design_zoo/pr/opene902/foundation/RPT/postroute_hold.summary.gz'`
- `'realpath' '-z' '-e' '--' '/data/eda/project/design_zoo/pr/opene902/foundation/RPT/verify_drc.postroute.rpt'`
- `'realpath' '-z' '-e' '--' '/data/eda/project'`
- `'cat' '--' '/data/eda/project/design_zoo/pr/opene902/foundation/RPT/verify_drc.postroute.rpt'`
