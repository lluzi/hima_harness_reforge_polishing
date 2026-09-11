# Step-1 acceptance run, 2026-09-09

Site: `linglong` (luzi@192.168.50.41, LAN). DeepSeek Harness 0.1.5-alpha.1. Host booted in-process from the hima profile with every entry active; commands executed against a real agent, no model involved.

## Steps

### setup summary

```
/hima observe linglong /data/eda/project/design_zoo/pr/opene902/foundation/RPT/postroute.summary.gz --reader innovus-timing-summary
```

Run `run-85f9d36d-d925-4ebe-a520-81bc84176aef`; observation `run-85f9d36d-d925-4ebe-a520-81bc84176aef#000001`, sha256 `30ad024ede3fd4ca94aec44a408488ac6a499bc100d42739bae49407626e2bb5` (583 bytes).

Typed values:

- setup_wns (setup, all): -0.073 ns
- setup_wns (setup, reg2reg): 0.002 ns
- setup_tns (setup, all): -0.18 ns
- setup_tns (setup, reg2reg): 0 ns
- placement_density: 44.345 percent
- clock_period: unknown — not stated in an Innovus optDesign summary

### hold summary

```
/hima observe linglong /data/eda/project/design_zoo/pr/opene902/foundation/RPT/postroute_hold.summary.gz --reader innovus-timing-summary --run run-85f9d36d-d925-4ebe-a520-81bc84176aef
```

Run `run-85f9d36d-d925-4ebe-a520-81bc84176aef`; observation `run-85f9d36d-d925-4ebe-a520-81bc84176aef#000002`, sha256 `30d0eeed609a723260d9c0f5287a145ee4ad53ec94d575e448c1ac2237361420` (574 bytes).

Typed values:

- hold_wns (hold, all): 0.034 ns
- hold_wns (hold, reg2reg): 0.034 ns
- hold_tns (hold, all): 0 ns
- hold_tns (hold, reg2reg): 0 ns
- placement_density: 44.345 percent
- clock_period: unknown — not stated in an Innovus optDesign summary

### DRC report

```
/hima observe linglong /data/eda/project/design_zoo/pr/opene902/foundation/RPT/verify_drc.postroute.rpt --reader innovus-verify-drc
```

Run `run-96e8b3ad-7d3a-4900-a93a-3f36c2f9807b`; observation `run-96e8b3ad-7d3a-4900-a93a-3f36c2f9807b#000001`, sha256 `bfebfa55c283265edc811d4b11d190eabd4ae019f893ec9d1ed5e3054d2e06cc` (183422 bytes).

Typed values:

- drc_violation_count: 1778 count

## Judgement over the one run holding both timing summaries

The setup summary opened the run; the hold summary was appended to it with `--run`, so all three shipped rules are judged against one run, each verdict citing whichever observation carried the value it needed.

```
/hima judge run-85f9d36d-d925-4ebe-a520-81bc84176aef --rules setup-wns-all-nonnegative,setup-wns-reg2reg-nonnegative,hold-wns-all-nonnegative
```

- setup-wns-all-nonnegative@1: **FAIL**, cites run-85f9d36d-d925-4ebe-a520-81bc84176aef#000001
- setup-wns-reg2reg-nonnegative@1: **PASS**, cites run-85f9d36d-d925-4ebe-a520-81bc84176aef#000001
- hold-wns-all-nonnegative@1: **PASS**, cites run-85f9d36d-d925-4ebe-a520-81bc84176aef#000002

## Comparison with the site handoff metrics

Handoff row for opene902: {"period_ns":2.18,"setup_wns_all_ns":-0.073,"setup_wns_r2r_ns":0.002,"setup_tns_ns":-0.18,"hold_wns_ns":0.034,"density_pct":44.345,"drc":1778}.

Every typed value that the handoff table records matches it exactly, and every verdict has its expected outcome and cites its observation.

## Restart

After disposing the host and booting it again on the same home, every run and record read back unchanged.

## Workbench (real web profile, Hima namespace)

- setup summary: run `run-bb02ab1c-3d5a-463e-8687-7dba536712f8`, observation sha256 `30ad024ede3fd4ca94aec44a408488ac6a499bc100d42739bae49407626e2bb5`: setup-wns-all-nonnegative@1 **FAIL** (cites run-bb02ab1c-3d5a-463e-8687-7dba536712f8#000001); setup-wns-reg2reg-nonnegative@1 **PASS** (cites run-bb02ab1c-3d5a-463e-8687-7dba536712f8#000001)
- hold summary: run `run-5af74972-f996-4474-b6a5-951b04412dee`, observation sha256 `30d0eeed609a723260d9c0f5287a145ee4ad53ec94d575e448c1ac2237361420`: hold-wns-all-nonnegative@1 **PASS** (cites run-5af74972-f996-4474-b6a5-951b04412dee#000001)
- DRC report: run `run-0904694c-77e0-4588-abb4-fec41ab0aef2`, observation sha256 `bfebfa55c283265edc811d4b11d190eabd4ae019f893ec9d1ed5e3054d2e06cc`

Client module served at `/plugins/??@hima/harness/client.js&rev=078fb36286cc2c71-51` with status 200, loader envelope present.

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
