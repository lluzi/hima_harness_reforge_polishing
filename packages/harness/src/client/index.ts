// @hima-seam client-slots wrapped
// Hima occupies the native dsh dock. The host owns sessions, chat, files and panel geometry;
// this adapter registers the Hima view and passes navigation actions into presentation components.
import { createElement, useState, type ReactElement } from 'react';
import { HimaRunCard } from './HimaRunCard.js';
import { HimaWorkbench } from './HimaWorkbench.js';
import { STUDIO_STYLE } from './workbench-style.js';

const HIMA_RUN_TOOLS = ['hima_observe', 'hima_run'] as const;
const WORKBENCH_KIND = 'hima-workbench';
const WORKBENCH_ID = '@hima/harness/workbench';

/** The published slot contracts used by this bundle, kept at the existing wrapped seam. */
type Registration = ({ inject?: (...args: string[]) => object; priority?: number }) & (
  | { name: 'tool.call.toolview' | 'sidebar.right.pane.tab'; key: string }
  | { name: 'sidebar.footer.action'; id: string }
  | { name: 'sidebar.brand.mark' | 'sidebar.brand.name' | 'conversation.hero.brand.mark' }
);
export interface ClientContext {
  readonly slots: {
    register(declaration: Registration, component: unknown): unknown;
    inject(name: string, callback: () => unknown): unknown;
  };
  readonly sidebarRight: { openTab(kind: string, options?: { params?: { runId?: string } }): void };
  readonly sidebarRightTabs: { register(definition: { id: string; kind: string; title(address: string): string; guide: { order: number; title(): string; description(): string }[] }): () => void };
  readonly layout: { toggleSidebar(): void };
  effect(callback: () => (() => void)): unknown;
}

export const inject = ['slots', 'sidebarRight', 'sidebarRightTabs', 'layout'];
export const name = 'hima-guide';

/** Hima's own mark, composed through the shell's brand seats. */
function HimaMark({ size = 24, className }: { size?: number; className?: string }): ReactElement {
  return createElement('svg', { width: size, height: size, viewBox: '0 0 24 24', fill: 'none', 'aria-hidden': true, className },
    createElement('path', { d: 'M4 5v14M20 5v14M4 12h16M4 5l5-3M15 22l5-3', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round' }));
}
function HimaName(): ReactElement {
  return createElement('span', { className: 'hima-brand' }, 'HimaHarness');
}

interface EntryProps {
  wide: boolean;
  useSessions<T>(selector: (state: { current?: string }) => T): T;
  open(wide: boolean): void;
}
function WorkbenchEntry({ wide, useSessions, open }: EntryProps): ReactElement {
  const current = useSessions((state) => state.current);
  const [error, setError] = useState<string>();
  return createElement('div', { className: 'hima-entry', 'data-wide': wide },
    createElement('style', null, STUDIO_STYLE),
    createElement('button', {
      type: 'button', disabled: current === undefined,
      title: current === undefined ? 'Choose a workspace and session to open Live Run' : 'Live Run — beside the conversation',
      'aria-label': 'Open Live Run beside the conversation', 'data-hima-control': 'open-workbench',
      onClick: () => { try { open(wide); setError(undefined); } catch (failure) { setError((failure as Error).message); } },
    }, createElement(HimaMark, { size: 18 }), wide ? 'Live Run' : null),
    error ? createElement('p', { role: 'alert' }, error) : null,
    wide && current === undefined ? createElement('p', null, 'Choose a workspace to begin') : null);
}

export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.sidebarRightTabs.register({
    id: WORKBENCH_ID, kind: WORKBENCH_KIND, title: () => 'Live Run',
    guide: [{ order: 0, title: () => 'Hima Live Run', description: () => 'Research, execution and evidence beside the conversation.' }],
  }));
  const openRun = (runId?: string) => ctx.sidebarRight.openTab(WORKBENCH_KIND, runId === undefined ? undefined : { params: { runId } });
  ctx.slots.inject('sidebar.right.pane.tab', () => ctx.slots.register({
    name: 'sidebar.right.pane.tab', key: WORKBENCH_ID,
    inject: () => ({ openFiles: () => ctx.sidebarRight.openTab('files') }),
  }, HimaWorkbench));
  ctx.slots.inject('sidebar.footer.action', () => ctx.slots.register({
    name: 'sidebar.footer.action', id: 'hima-workbench',
    inject: () => ({ open: (wide: boolean) => { openRun(); if (wide) ctx.layout.toggleSidebar(); } }),
  }, WorkbenchEntry));
  for (const slot of ['sidebar.brand.mark', 'conversation.hero.brand.mark'] as const) {
    ctx.slots.inject(slot, () => ctx.slots.register({ name: slot, priority: -10 }, HimaMark));
  }
  ctx.slots.inject('sidebar.brand.name', () => ctx.slots.register({ name: 'sidebar.brand.name', priority: -10 }, HimaName));
  ctx.slots.inject('tool.call.toolview', () => {
    const claimed = HIMA_RUN_TOOLS.map((key) => ctx.slots.register({ name: 'tool.call.toolview', key, inject: () => ({ openRun }) }, HimaRunCard));
    return () => { for (const dispose of claimed) if (typeof dispose === 'function') (dispose as () => void)(); };
  });
}
