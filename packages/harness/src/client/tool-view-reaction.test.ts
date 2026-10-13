import assert from 'node:assert/strict';
import test from 'node:test';
const mod: typeof import('./tool-view-reaction.js') = await import(`./tool-view-reaction.${'ts'}`);
const { toolViewReaction } = mod;

// The Tool pane's whole reaction to a fresh forward status lives here, so both the safety reset
// (control returns to view-only whenever the forward leaves `ready`) and the self-healing poll
// (reopen a dropped forward, keep watching, but never auto-restart a failed one) are tested without
// an Electron window. A break in either shows up as a failing case below, not as a silent survivor.

test('a forward that drops to stopped hands control back and asks the pane to reopen it', () => {
  assert.deepEqual(toolViewReaction('controlling', 'stopped'), { control: 'viewing', open: true, poll: true });
  assert.deepEqual(toolViewReaction('viewing', 'stopped'), { control: 'viewing', open: true, poll: true });
});

test('a restart seen as starting keeps watching but does not open a second forward', () => {
  assert.deepEqual(toolViewReaction('controlling', 'starting'), { control: 'viewing', open: false, poll: true });
});

test('while ready the control state is kept — a new url (a reload) does not drop a driver to view-only', () => {
  // ready(url A) → ready(url B): the state is still `ready`, so whoever was in control stays in control.
  assert.deepEqual(toolViewReaction('controlling', 'ready'), { control: 'controlling', open: false, poll: true });
  assert.deepEqual(toolViewReaction('viewing', 'ready'), { control: 'viewing', open: false, poll: true });
});

test('a failed forward resets control and is never auto-reopened — only Retry opens it', () => {
  assert.deepEqual(toolViewReaction('controlling', 'failed'), { control: 'viewing', open: false, poll: false });
});

test('an unavailable forward resets control and stops the poll (the tab should not be showing at all)', () => {
  assert.deepEqual(toolViewReaction('controlling', 'unavailable'), { control: 'viewing', open: false, poll: false });
});
