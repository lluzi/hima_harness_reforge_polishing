// @hima-seam client-slots wrapped
// The HimaGuide browser module: the workbench half of the bundle, served to the web shell as
// `@hima/harness`'s client bundle. It contributes exactly one thing — the keyed tool view for the
// Hima tools that report a Run — and imports no other feature plugin's component.
//
// dsh publishes no installable types for the browser context, so the surface this module stands on
// is stated here as a Hima-owned interface: that is the wrapped seam, and it is one screen wide.
import { HimaRunCard } from './HimaRunCard.js';

/**
 * The wire tool names whose calls this module renders: the two that answer with a Run. Both get the
 * same card, because both answer with a run id and the card reads the Run itself — a second component
 * for the second tool would be the same JSON rendered twice, drifting apart.
 *
 * `hima_cancel` and `hima_resume` are deliberately not here. Each answers about a Run someone else's
 * card is already showing, and claiming their keys would put a second, competing copy of that Run in
 * the transcript rather than telling anyone something new.
 */
const HIMA_RUN_TOOLS = ['hima_observe', 'hima_run'] as const;

/** The slot this module contributes into: dsh's keyed atomic tool view, dispatched by tool name. */
const TOOL_VIEW_SLOT = 'tool.call.toolview';

/** The slice of the browser plugin context this module uses. */
export interface ClientContext {
  readonly slots: {
    /** Claim one key of a slot for a component. */
    register(declaration: { name: string; key: string }, component: unknown): unknown;
    /** Run a registration for the lifetime of the named slot's declaration. */
    inject(name: string, callback: () => unknown): unknown;
  };
}

/** The browser services this module needs before it may run. */
export const inject = ['slots'];

/** Stable plugin name, as dsh's own client packages declare it. */
export const name = 'hima-guide';

/**
 * Register the Hima tool view. A `hima_observe` or `hima_run` call then renders as the Hima card
 * instead of the generic tool row: where the Run stands, the path it took node by node, the blocker a
 * person has to clear, what was read, the verdicts, and what the Run decided next.
 *
 * @param ctx - the browser plugin context.
 */
export function apply(ctx: ClientContext): void {
  ctx.slots.inject(TOOL_VIEW_SLOT, () => {
    const claimed = HIMA_RUN_TOOLS.map((key) => ctx.slots.register({ name: TOOL_VIEW_SLOT, key }, HimaRunCard));
    // One disposer for the two claims, so this callback answers what a single registration answered
    // before: whatever the slot service does with a returned disposer, it gets one, not a list.
    return () => { for (const dispose of claimed) if (typeof dispose === 'function') (dispose as () => void)(); };
  });
}
