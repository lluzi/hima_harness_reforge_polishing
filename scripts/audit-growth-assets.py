#!/usr/bin/env python3
"""Re-evaluate retained native evidence without another model call or changing its original status."""
import argparse
import hashlib
import json
from pathlib import Path


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--evidence', type=Path, required=True)
    parser.add_argument('--out', type=Path, required=True)
    args = parser.parse_args()
    raw = args.evidence.read_bytes()
    evidence = json.loads(raw)
    checks = {}
    required = [
        'baseline preparation did not invoke a model',
        'one live model owner completed the bounded actual-data Goal',
        'model created no additional Run or hidden research session',
        'actual algorithm has prior history-read provenance',
        'exactly one added branch returned with evidence',
        'analysis and complete Pack-local delivery exist',
        'reference and actual source input remain unchanged',
        'retained private home and evidence were scanned',
    ]
    checks['research-native'] = all(any(c['claim'] == name and c['passed'] is True for c in evidence['checks']) for name in required)
    target = evidence['observed']['runId']
    research = next(r for r in evidence['runs'] if r['run']['id'] == target)
    checks['research-ended'] = research['run']['status'] == 'ended-goal-met'
    deadline_message = evidence['userMessages'][-1]
    owner = deadline_message['session']
    calls = [c for c in evidence['toolSequence'] if c['at'] >= deadline_message['at'] and c['agent'] == owner]
    def payload(call):
        texts = [c['text'] for c in call['result'].get('content', []) if c['type'] == 'text']
        return json.loads(texts[0]) if texts else {}
    attempts = [c for c in calls if c['name'] == 'hima_execute' and c['args'].get('action') == 'analyze']
    checks['exactly-one-expired-write-refused'] = len(attempts) == 1 and payload(attempts[0]).get('kind') == 'refused'
    expired_id = attempts[0]['args']['run'] if attempts else ''
    expired = next((r for r in evidence['runs'] if r['run']['id'] == expired_id), None)
    checks['campaign-stopped-no-new-business-records'] = bool(expired and expired['run']['status'] == 'ended-budget-exhausted'
        and all(r['at'] < deadline_message['at'] or r['type'] in ('archive', 'experience') for r in expired['records'])
        and not any(r['type'] in ('analysis', 'code', 'research-write') for r in expired['records']))
    contexts = [payload(c) for c in calls if c['name'] == 'hima_context' and c['args'].get('run') == expired_id]
    checks['same-run-before-and-after'] = len(contexts) >= 2 and contexts[0].get('run') == contexts[-1].get('run')
    agent = next(a for a in evidence['agents'] if a['id'] == owner)
    turns = evidence['observed']['nativeTurns']
    checks['conversation-answered'] = bool(agent['said'] and expired_id in agent['said'][-1]
        and turns[-1]['session'] == owner and turns[-1]['reason']['kind'] == 'completed')
    report = {
        'status': 'passed' if all(checks.values()) else 'failed', 'checks': checks,
        'sourceSha256': hashlib.sha256(raw).hexdigest(), 'originalStatus': evidence['status'],
        'originalFailure': evidence.get('failure', '').split('\n')[0],
        'explanation': 'Original snapshot unchanged. Native tool tracing serializes content, not the in-process value field. This audit checks the retained wire response and independent Ledger/turn facts. Deterministic archive/experience completion is allowed after the Campaign deadline; new business writes are not.',
        'researchRun': target, 'expiredRun': expired_id, 'originalCosts': evidence['costs'],
        'additionalModelRequests': 0, 'additionalEdaJobs': 0,
    }
    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(json.dumps(report, indent=2) + '\n')
    print(json.dumps(report, indent=2))
    if report['status'] != 'passed': raise SystemExit(1)


if __name__ == '__main__': main()
