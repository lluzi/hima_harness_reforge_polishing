// The Tool pane's reaction to a fresh forward status, pulled out of `ToolViewPanel` so the rules that
// keep a person safe and the pane alive are one pure, tested function rather than effects tangled in
// render. One reason to change: what the pane should do the instant it learns the forward's state.
import type { ToolViewStatus } from '../tool-view.js';

/** Whether the person is only watching the tool, or driving it. */
export type ToolControl = 'viewing' | 'controlling';

export type ToolViewState = ToolViewStatus['state'];

export interface ToolViewReaction {
  /** The control state after this status. View-only unless the forward is `ready`: a frame that
   *  reloaded, dropped or restarted never leaves a person holding a live tool they did not ask to
   *  touch. While `ready` the previous control is kept, so a reload (a new url) does not evict a driver. */
  readonly control: ToolControl;
  /** Whether the pane should open the forward now. Only a `stopped` forward is auto-opened; a start
   *  already in flight (`starting`) is waited out, and a `failed` one is left for an explicit Retry. */
  readonly open: boolean;
  /** Whether the pane should keep polling while visible. Every live state is followed so a drop or a
   *  restart from elsewhere is picked up; a `failed` forward (Retry only) and an `unavailable` Site
   *  (no tab) are terminal, so polling stops. */
  readonly poll: boolean;
}

/** How the Tool pane should react to learning the forward is now in `next`, given the control state
 *  it currently holds. `open` and `poll` depend only on `next`; `control` also depends on the previous
 *  state so that it is preserved across a ready→ready reload. */
export function toolViewReaction(previousControl: ToolControl, next: ToolViewState): ToolViewReaction {
  switch (next) {
    case 'ready':
      return { control: previousControl, open: false, poll: true };
    case 'stopped':
      return { control: 'viewing', open: true, poll: true };
    case 'starting':
      return { control: 'viewing', open: false, poll: true };
    case 'failed':
    case 'unavailable':
      return { control: 'viewing', open: false, poll: false };
  }
}
