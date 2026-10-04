# ATCS durable resident dry route

This fixture supplies initial declared synthetic design files, retained native timing data,
Site library/scenario configuration and an ACP v1 engineer. It never seeds Campaign readiness,
baseline, native context or common R1. The unchanged Pack's five Tasks own those outputs.

`native.py` runs the emitted production Tcl through the existing `OwnerTimingLeadChecks`
vendor stub without its state-seeding `setUp`. Common AutoFix changes U1 BUFX1 to BUFX2,
keeps setup -0.02 / hold -0.07, and saves actual serialized cell state. The engineer reopens
that saved workspace with Tcl and checks the captured cell-state digest against common R1.
Its two-state synthetic model derives raw timing reports from the actual selected checkpoint:
U9 DFFX2 has zero setup/hold violations; unchanged U9 DFFX1 retains negative setup/hold.
These values test report/Goal integration; they are not evidence of real timing improvement.

The engineer emits actual checkpoint, script, native trace, ECO exports and hashed raw reports.
The production wrapper signs its candidate, the Host materializes it, and the Pack Reader
recomputes the measurements. Empty model remaining/regressed lists deliberately cannot hide
negative raw timing. Missing broader collateral evidence must remain UNKNOWN.

An initial-prompt gate delays return after evidence creation. The public `hima_execute`
business message queues on that same native task; release permits the original prompt then
one ACK-only message. No message creates another engineering result or launch.

Cheap proof: `python3 -m unittest discover -s test/fixtures/atcs-resident-dry -p test_fixture.py`.
Host proof (after one fresh shared build): Node 24 with `HIMA_POSTGRES_RUNTIME` set, run
`node --test test/contract/atcs-resident-durable.host.test.ts`. Each case owns one process,
one temporary Home and one private PostgreSQL cluster. No GUI, SSH, product model API or
commercial EDA calls. Canonical output, final report, engineering package, Reader count,
public message identity and honest Goal are asserted through existing interfaces. Public
inspection and HTTP downloads are checked before the separate automatic archive assertion;
the downloaded package is extracted and checkpoint/script/ECO/raw-report bytes are compared
with the actual canonical outputs. The cheap proof uses the production wrapper collection/signing
seam and production Reader after materializing its verified retained files; it starts no Host.

Unchanged Reader forgery/scenario/checkpoint negatives remain in the Pack's cheaper Python
suite. Generic interrupted archive publication/restart is covered by durable-views Host tests;
this ATCS test does not claim process-crash recovery or live engineering qualification.
