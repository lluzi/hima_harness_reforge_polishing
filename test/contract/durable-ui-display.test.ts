// L1: durable facts supersede legacy display spellings and late network replies.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { taskStateForNode, taskCanRespond, runStatusSaid, runCanControl, runSnapshotOlder, runWaitingReason, sceneInputs } from '@hima/harness';
import type { RunView, RunHeadView } from '@hima/harness';

const run = (extra: Partial<RunHeadView> = {}): RunHeadView => ({ id: 'r1', campaignId: 'c1', siteId: 's1', createdAt: '2026-10-04T00:00:00Z', status: 'running', ...extra });
const view = (head: RunHeadView): RunView => ({ run: head, nodes: [], generations: [], jobs: [], code: [], knowledge: [], observations: [], verdicts: [], blockers: [], refusals: [], cancels: [], resumes: [], decision: null });

test('waiting attention describes the current task failure and never a superseded iteration or an ended Run', () => {
  const waiting = view(run({ status: 'waiting', engine: 'dbos/5.2.11' }));
  const task = (iteration: number, message: string) => ({ taskId: 'produce', current: true, sourceFactIds: [],
    iterations: [{ repeatId: 'loop', iteration }],
    projection: { state: 'failed' as const, reason: { code: 'command-failed', message, source: 'runtime' } } });
  const old = task(0, 'old failure'), current = task(1, 'Current command exited 1');
  const superseded = { ...task(2, 'superseded work'), current: false };
  const tasks = [old, superseded, current];
  assert.equal(runWaitingReason({ ...waiting, tasks }), 'Current command exited 1');
  assert.equal(runWaitingReason({ ...waiting, tasks: [...tasks].reverse() }), 'Current command exited 1');
  assert.equal(runWaitingReason({ ...waiting, tasks: [old, { ...current, projection: { state: 'succeeded' } }] }), undefined);
  assert.equal(runWaitingReason({ ...waiting, tasks: [{ ...current, projection: { state: 'waiting', reason: { code: 'human-response', message: 'Choose a result', source: 'runtime' } } }] }), 'Choose a result');
  assert.equal(runWaitingReason({ ...waiting, run: run({ status: 'ended-goal-not-met' }), tasks }), undefined);
});

test('explicit unknown Goal overrides legacy met and not-met spellings', () => {
  assert.equal(runStatusSaid(run({ status: 'ended-goal-met', goalState: 'unknown' }))?.said, 'ended · Goal unknown');
  assert.equal(runStatusSaid(run({ status: 'ended-goal-not-met', goalState: 'unknown' }))?.said, 'ended · Goal unknown');
  assert.equal(runStatusSaid(run({ status: 'ended-goal-not-met', goalState: 'met' }))?.said, 'ended · Goal met');
  assert.equal(runStatusSaid(run({ status: 'ended-goal-met' }))?.said, 'ended — goal met');
});

test('expired and physically closed work never offers resume controls', () => {
  assert.equal(runCanControl(run({ status: 'waiting', deadlineAt: '2000-01-01T00:00:00Z' })), false);
  assert.equal(runCanControl(run({ status: 'waiting', stopState: { state: 'closed', closed: true, unclosedResources: 0, effectsWithoutStopProof: 0 } })), false);
  assert.equal(runCanControl(run({ status: 'waiting', deadlineAt: '2100-01-01T00:00:00Z' })), true);
});

test('expired work retains Stop until original resources are confirmed closed', () => {
  for (const status of ['running', 'waiting'] as const) {
    const expired = run({ status, deadlineAt: '2000-01-01T00:00:00Z',
      stopState: { state: 'unknown', closed: false, unclosedResources: 1, effectsWithoutStopProof: 1 } });
    assert.equal(runCanControl(expired), false, 'expiry still prevents continuation');
    assert.equal(runCanControl(expired, 'cancel'), true, 'expiry must not prevent resource cleanup');
    assert.equal(runCanControl({ ...expired, stopState: { state: 'closed', closed: true, unclosedResources: 0, effectsWithoutStopProof: 0 } }, 'cancel'), false);
  }
});

test('PG source watermark rejects late replies and another Run identity', () => {
  const current = view(run({ sourceRevision: 20 }));
  assert.equal(runSnapshotOlder(view(run({ sourceRevision: 19 })), current), true);
  assert.equal(runSnapshotOlder(view(run({ sourceRevision: 21 })), current), false);
  assert.equal(runSnapshotOlder(view(run({ id: 'other', sourceRevision: 21 })), current), true);
});

test('all six authoritative task states overlay established graph glyphs', () => {
  const states = ['pending', 'running', 'waiting', 'succeeded', 'failed', 'cancelled'] as const;
  const base = view(run());
  const tasks = states.map((state, index) => ({ taskId: `t${index}`, sourceFactIds: [], projection: state === 'waiting' || state === 'failed' ? { state, reason: { code: 'reason', message: 'actual fact', source: 'runtime' } } : { state } }));
  const graph = { entry: 't0', nodes: states.map((_, index) => ({ id: `t${index}`, kind: 'act' as const })), edges: [] };
  const { facts } = sceneInputs(graph, { ...base, tasks });
  assert.deepEqual(Object.values(facts.states ?? {}), ['pending', 'running', 'waiting-for-slot', 'done', 'blocked', 'cancelled']);
  assert.equal(runStatusSaid(base.run)?.said, 'running');
});


test('a response editor requires the recorded human wait identity and contract', () => {
  const identity = { runId: 'r1', taskId: 'ask', effectId: 'e1', inputSha256: 'a'.repeat(64), packSha256: 'b'.repeat(64), irSha256: 'c'.repeat(64), applicationVersion: '1', adapterVersion: '1' };
  const contract = { input: { version: '1', schema: {} }, output: { version: '2', schema: {} } };
  const task = { taskId: 'ask', projection: { state: 'waiting' as const, reason: { code: 'human-response', message: 'Select an option', source: 'runtime' } }, sourceFactIds: ['f1'], identity, contract };
  assert.equal(taskCanRespond(task, run({ status: 'waiting' })), true);
  assert.equal(taskCanRespond({...task,current:false},run({status:'waiting'})),false);
  const held={...task,tool:'builtin/human-wait',projection:{state:'waiting' as const,reason:{code:'task-waiting',message:'paused',source:'runtime'}}};
  assert.equal(taskCanRespond(held,run({control:{mode:'agent',owner:'owner',epoch:0,revision:1,paused:['*'],executions:{},requests:{}}})),false);
  assert.equal(taskCanRespond(held,run()),true);
  assert.equal(taskCanRespond({ ...task, identity: undefined }, run()), false);
  assert.equal(taskCanRespond({ ...task, contract: undefined }, run()), false);
  assert.equal(taskCanRespond({ ...task, projection: { state: 'waiting', reason: { ...task.projection.reason, code: 'remote-running' } } }, run()), false);
});

test('a later control epoch or revision rejects an older action reply', () => {
  const control = { mode: 'agent' as const, owner: 'owner', epoch: 2, revision: 5, paused: [], executions: {}, requests: {} };
  const current = view(run({ control }));
  assert.equal(runSnapshotOlder(view(run({ control: { ...control, epoch: 1, revision: 100 } })), current), true);
  assert.equal(runSnapshotOlder(view(run({ control: { ...control, revision: 4 } })), current), true);
  assert.equal(runSnapshotOlder(view(run({ control: { ...control, revision: 6 } })), current), false);
});

test('superseded and completed loop history never masks current unfinished invocation',()=>{
  const tasks=[{taskId:'repeat',current:true,sourceFactIds:[],projection:{state:'running' as const}},
    {taskId:'repeat',current:true,sourceFactIds:[],projection:{state:'succeeded' as const}},
    {taskId:'repeat',current:false,sourceFactIds:[],projection:{state:'waiting' as const,reason:{code:'human-response',message:'old request',source:'old'}}}];
  assert.equal(taskStateForNode(tasks,'repeat'),'running');
  assert.equal(taskStateForNode([...tasks].reverse(),'repeat'),'running');
});

test('latest recorded loop iteration supersedes an older failure; diagnostic names do not overwrite root nodes',()=>{
  const tasks=[{taskId:'repeat',current:true,sourceFactIds:[],iterations:[{repeatId:'loop',iteration:1}],projection:{state:'succeeded' as const}},
    {taskId:'repeat',current:true,sourceFactIds:[],iterations:[{repeatId:'loop',iteration:0}],projection:{state:'failed' as const,reason:{code:'failed',message:'old iteration',source:'old'}}},
    {taskId:'repeat',current:true,rootFlow:false,sourceFactIds:[],projection:{state:'waiting' as const,reason:{code:'human-response',message:'diagnostic',source:'extension'}}}];
  assert.equal(taskStateForNode(tasks,'repeat'),'succeeded');
  assert.equal(taskStateForNode([...tasks].reverse(),'repeat'),'succeeded');
});
