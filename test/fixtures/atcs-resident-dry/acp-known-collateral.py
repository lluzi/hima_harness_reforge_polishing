#!/usr/bin/env python3
"""ACP v1 synthetic engineer of `acp.py`, with known (not UNKNOWN) collateral evidence.

Runs the unchanged `acp.py` engineer; only its collateral block is replaced by hashed XTop
fail-reason tables for the actual common R1 state (before) and selected state (after), in the
native context's declared scenarios. Before: one finding per check. After: two transition
findings, one for each other check. The Pack Reader therefore derives a known transition
regression from raw tables. Synthetic data; not physical collateral evidence.
"""
from pathlib import Path

ORIGINAL = Path(__file__).with_name('acp.py')
UNKNOWN = ("'collateral':{phase:{check:{'unknown':'synthetic fixture has no physical collateral evidence'} "
           "for check in ('transition','capacitance','fanout','legality')} for phase in ('before','after')},")
KNOWN = "'collateral':known_collateral(helper,common['stateId'],'synthetic-selected-'+mode,context['requiredScenarios']),"
REASONS = {'transition': 'break_max_transition', 'capacitance': 'break_max_capacitance',
           'fanout': 'break_max_fanout', 'legality': 'legal_fail_no_space_on_row'}


def known_collateral(helper, before_state, after_state, scenarios):
    counts = {'before': {check: 1 for check in REASONS}, 'after': {**{check: 1 for check in REASONS}, 'transition': 2}}
    states = {'before': before_state, 'after': after_state}
    collateral = {}
    for phase in ('before', 'after'):
        collateral[phase] = {}
        for check, reason in REASONS.items():
            rows = ''.join(f'-0.01 {scenarios[0]} U{i}/D {reason}:100%\n' for i in range(counts[phase][check]))
            raw = '### setup top 20 endpoints ###\nSlack Scenario Name Fail Reason\n--------------------------------\n' + rows
            collateral[phase][check] = {'scope': 'timing-fix-fail-reasons', 'stateId': states[phase],
                                        'requiredScenarios': list(scenarios),
                                        'source': {**helper._file(f'raw/../engineering/collateral-{phase}-{check}.rpt', raw),
                                                   'tool': 'XTop', 'version': 'fixture',
                                                   'command': 'summarize_gba_violations -with_fail_reason'}}
    return collateral


source = ORIGINAL.read_text()
if source.count(UNKNOWN) != 1:
    raise SystemExit('acp.py collateral block changed; update acp-known-collateral.py')
exec(compile(source.replace(UNKNOWN, KNOWN), str(ORIGINAL), 'exec'),
     {'__file__': str(ORIGINAL), '__name__': '__main__', 'known_collateral': known_collateral})
