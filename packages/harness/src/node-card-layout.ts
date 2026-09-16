// Pure layout and tab-set facts for the node card (#41 task 6), kept out of `client/NodeCard.tsx` so
// the host build — and this module's own L1 tests — can reach them without pulling React/JSX into
// the host bundle: `canvas-layout.ts` and `scene.ts` are this module's siblings for the same reason.
// No DOM, no Node imports; `NodeCard.tsx` imports this as a sibling module and adds nothing of its
// own to what it says.
import type { NodeKind } from './canvas-layout.js';

/** One tab the node card can show, across every node kind. */
export type NodeCardTabKey = 'facts' | 'job' | 'code' | 'knowledge' | 'evidence' | 'rules' | 'verdicts' | 'decision' | 'strategy' | 'generations' | 'blocker' | 'clearance';

/** The tab set for each node kind, in the order the card shows them; the first is the default tab. */
export const TABS_BY_KIND: Readonly<Record<NodeKind, readonly NodeCardTabKey[]>> = {
  act: ['facts', 'job', 'code', 'knowledge', 'evidence'],
  judge: ['rules', 'verdicts', 'evidence'],
  explore: ['decision', 'strategy', 'generations'],
  wait: ['blocker', 'clearance'],
};

/** The mockup's own size for the card: 384 wide, "about 300" tall (spec, "The canvas"). */
export const NODE_CARD_WIDTH = 384;
export const NODE_CARD_HEIGHT = 300;

/** The gap between a node's own edge and the card, and the margin the card is clamped inside the
 *  canvas's own edge by, in canvas pixels. */
const GAP = 28;
const MARGIN = 8;

/**
 * Where the card sits, in the canvas's own screen coordinates: to the right of its node by default,
 * flipped to the left when the right side would clip past the canvas's own edge, and clamped fully
 * inside the canvas on both axes either way — a card must never draw itself half off the pane it is
 * anchored inside.
 *
 * @param anchor - the node's own current screen position (already through the canvas's pan/zoom
 *                 transform), which the card is anchored beside.
 * @param canvas - the canvas's own viewport, in the same screen coordinates.
 */
export function cardPosition(anchor: { readonly x: number; readonly y: number }, canvas: { readonly width: number; readonly height: number }): { readonly x: number; readonly y: number } {
  const rightX = anchor.x + GAP;
  const leftX = anchor.x - GAP - NODE_CARD_WIDTH;
  const fitsRight = rightX + NODE_CARD_WIDTH <= canvas.width - MARGIN;
  const maxX = Math.max(MARGIN, canvas.width - NODE_CARD_WIDTH - MARGIN);
  const maxY = Math.max(MARGIN, canvas.height - NODE_CARD_HEIGHT - MARGIN);
  return {
    x: Math.min(Math.max(fitsRight ? rightX : leftX, MARGIN), maxX),
    y: Math.min(Math.max(anchor.y - NODE_CARD_HEIGHT / 2, MARGIN), maxY),
  };
}
