// @hima-seam client-slots wrapped
// Hima occupies the native dsh dock. The host owns sessions, chat, files and panel geometry;
// this adapter registers the Hima view and passes navigation actions into presentation components.
import { createElement, useState, type ReactElement } from 'react';
import { CampaignChip } from './CampaignChip.js';
import { Glyph } from './glyphs.js';
import { HimaRunCard, type ToolBlock } from './HimaRunCard.js';
import { HimaWorkbench } from './HimaWorkbench.js';
import { campaignEvents, statusSaid, useOwnedRun } from './owned-run.js';
import { SettingsSection } from './SettingsSection.js';
import { HIMA_STYLE } from './workbench-style.js';

const HIMA_RUN_TOOLS = ['hima_observe', 'hima_run', 'hima_context', 'hima_execute'] as const;
const WORKBENCH_KIND = 'hima-workbench';
const WORKBENCH_ID = '@hima/harness/workbench';

/** The published slot contracts used by this bundle, kept at the existing wrapped seam. */
type Registration = ({ inject?: (...args: string[]) => object; priority?: number }) & (
  | { name: 'tool.call.toolview' | 'sidebar.right.pane.tab' | 'sidebar.right.pane.tab.title'; key: string }
  | { name: 'sidebar.footer.action' | 'conversation.session.header.actions' | 'sidebar.right.tab.menu.item' | 'settings.section'; id: string; order?: number; label?: string | (() => string) }
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
  readonly sessions: { open(id: string): void };
  effect(callback: () => (() => void)): unknown;
  /** Optional-service lookup ("Prefer `ctx.get(name)` with an undefined check; use `inject` only for
   *  hard dependencies" — the shell's own slot documentation). Used for `uiWorkspace`'s native folder
   *  picker (#41 task 8), which is not every install's own plugin set: declaring it in the static
   *  `inject` array above would block this whole adapter's `apply()` on a service that may never
   *  arrive, taking the Campaign chip and tab down with it. */
  get?(name: string): unknown;
}

export const inject = ['slots', 'sidebarRight', 'sidebarRightTabs', 'layout', 'sessions', 'conversation'];
export const name = 'hima-guide';

/** Hima's own mark, composed through the shell's brand seats. */
function HimaMark({ size = 24, className }: { size?: number; className?: string }): ReactElement {
  return createElement('svg', { width: size, height: size, viewBox: '0 0 24 24', fill: 'none', 'aria-hidden': true, className },
    createElement('path', { d: 'M4 5v14M20 5v14M4 12h16M4 5l5-3M15 22l5-3', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round' }));
}
function HimaName(): ReactElement {
  return createElement('span', { className: 'hima-brand' }, 'HimaHarness');
}

function AuthoringCard({ block, openAuthor }: { block: ToolBlock; openAuthor(id: string): void }): ReactElement {
  const [error, setError] = useState<string>();
  let value: { sessionId: string; pack: string; folder: string } | undefined;
  if (block.kind && !block.isError) {
    for (const item of block.content ?? []) {
      if (item.type !== 'text' || !item.text) continue;
      try {
        const parsed = JSON.parse(item.text) as Partial<NonNullable<typeof value>>;
        if (typeof parsed.sessionId === 'string' && typeof parsed.pack === 'string' && typeof parsed.folder === 'string') value = parsed as NonNullable<typeof value>;
      } catch { /* Pending and failed calls retain their actual tool text. */ }
    }
  }
  return createElement('div', { 'data-hima-region': 'authoring-session' },
    value ? createElement('div', null,
      createElement('p', null, `Pack ${value.pack} · ${value.folder}`),
      createElement('button', { type: 'button', 'data-hima-control': 'open-authoring', onClick: () => {
        try { openAuthor(value!.sessionId); setError(undefined); } catch (failure) { setError((failure as Error).message); }
      } }, 'Open authoring session'),
      createElement('p', null, 'Begin with /hima-grill. Campaign and Files remain beside the conversation.'))
      : createElement('pre', null, (block.content ?? []).map((item) => item.text ?? '').join('\n') || 'Preparing Pack workspace…'),
    error ? createElement('p', { role: 'alert' }, error) : null);
}

/**
 * The Campaign tab's own chip title (#41 task 8): `Campaign · configure` for a session that owns no
 * Run at all, `Campaign · <dot glyph> ‹node›` (the running glyph, never a unicode character) while running,
 * `Campaign · waiting` badged while a person is needed, else `Campaign · ‹status word›` for an ended
 * or cancelled Run — the exact word `statusSaid` gives the chip, so the two never disagree.
 * Registered under the same key as the tab body (`sidebar.right.pane.tab.title`), so the shell
 * dispatches it beside `HimaWorkbench` and delivers it the same standard `sessionId` prop.
 */
function CampaignTabTitle({ sessionId }: { sessionId: string }): ReactElement {
  const { run, stale } = useOwnedRun(sessionId);
  const status = run?.status;
  const body = run === undefined
    ? 'Campaign · configure'
    : status === 'running'
      ? createElement('span', null, 'Campaign ·', createElement(Glyph, { name: 'dot', size: 13 }), ` ${run.currentNode ?? 'running'}`)
      : status === 'waiting'
        ? createElement('span', null, 'Campaign · waiting', createElement('span', { className: 'hima-campaign-chip-badge', 'aria-hidden': true }))
        : `Campaign · ${statusSaid(status)}`;
  return createElement('span', { className: 'hima-tab-title', 'data-hima-state-stale': String(stale) }, body);
}

/**
 * "Diagnostics" at the end of the Campaign tab's own actions menu (#41 task 8): the one way to the
 * sheet that carries the Run id, the owner session's UUID, its epoch and revision — nowhere else in
 * this product prints those. Present only on the Campaign tab's own menu; every other tab's menu
 * renders nothing here, exactly as an entry with nothing to say is meant to (contract doc: "Entries
 * decide their own visibility from the tab they are given"). No `label` here: this item draws its own
 * text, and nothing on this list slot projects a registrant's `label` on its behalf.
 *
 * `openRun()` is called before the dispatch, and the dispatch itself waits a tick: the tab this menu
 * belongs to is already open (its own menu is what is open), but a docked-and-collapsed pane can
 * still leave `HimaWorkbench` unmounted until it is actually revealed, and an event with nobody
 * listening yet would open nothing.
 */
function DiagnosticsMenuItem({ tab, dismiss, openRun }: { tab?: { id?: string; kind?: string }; dismiss(): void; openRun(): void }): ReactElement | null {
  if (tab?.kind !== WORKBENCH_KIND) return null;
  return createElement('button', {
    type: 'button', className: 'hima-tab-menu-item', 'data-hima-control': 'open-diagnostics',
    onClick: () => {
      openRun();
      setTimeout(() => { campaignEvents.dispatchEvent(new CustomEvent('diagnostics', { detail: { tabId: tab.id } })); }, 0);
      dismiss();
    },
  }, 'Diagnostics');
}

interface EntryProps {
  wide: boolean;
  useSessions<T>(selector: (state: { current?: string }) => T): T;
  open(wide: boolean): void;
}
function WorkbenchEntry({ wide, useSessions, open }: EntryProps): ReactElement {
  const current = useSessions((state) => state.current);
  const [error, setError] = useState<string>();
  return createElement('div', { className: 'hima-entry hima-root', 'data-wide': wide },
    createElement('style', null, HIMA_STYLE),
    createElement('button', {
      type: 'button', disabled: current === undefined,
      title: current === undefined ? 'Choose a workspace and session to open Campaign' : 'Campaign — beside the conversation',
      'aria-label': 'Open Campaign beside the conversation', 'data-hima-control': 'open-workbench',
      onClick: () => { try { open(wide); setError(undefined); } catch (failure) { setError((failure as Error).message); } },
    }, createElement(HimaMark, { size: 18 }), wide ? 'Campaign' : null),
    error ? createElement('p', { role: 'alert' }, error) : null,
    wide && current === undefined ? createElement('p', null, 'Choose a workspace to begin') : null);
}

export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.sidebarRightTabs.register({
    id: WORKBENCH_ID, kind: WORKBENCH_KIND, title: () => 'Campaign',
    guide: [{ order: 0, title: () => 'Hima Campaign', description: () => 'Preparation, execution, code and evidence beside the conversation.' }],
  }));
  const openRun = (runId?: string) => ctx.sidebarRight.openTab(WORKBENCH_KIND, runId === undefined ? undefined : { params: { runId } });
  // `uiWorkspace` (the native folder picker) is looked up once, optionally: not every install runs
  // the plugin that provides it, and this whole adapter must still mount without it (see `get` on
  // `ClientContext`, above).
  const uiWorkspace = ctx.get?.('uiWorkspace') as { pickDirectory(): Promise<string | null> } | undefined;
  const pickFolder = uiWorkspace === undefined ? undefined : () => uiWorkspace.pickDirectory();
  ctx.slots.inject('sidebar.right.pane.tab', () => ctx.slots.register({
    name: 'sidebar.right.pane.tab', key: WORKBENCH_ID,
    inject: () => ({ openFiles: () => ctx.sidebarRight.openTab('files'), openOwner: (id: string) => ctx.sessions.open(id), pickFolder }),
  }, HimaWorkbench));
  ctx.slots.inject('sidebar.right.pane.tab.title', () => ctx.slots.register({
    name: 'sidebar.right.pane.tab.title', key: WORKBENCH_ID,
  }, CampaignTabTitle));
  ctx.slots.inject('sidebar.right.tab.menu.item', () => ctx.slots.register({
    name: 'sidebar.right.tab.menu.item', id: 'hima-diagnostics', order: 10,
    inject: () => ({ openRun: () => openRun() }),
  }, DiagnosticsMenuItem));
  ctx.slots.inject('conversation.session.header.actions', () => ctx.slots.register({
    name: 'conversation.session.header.actions', id: 'hima-campaign', order: 15,
    inject: () => ({ openRun }),
  }, CampaignChip));
  ctx.slots.inject('settings.section', () => ctx.slots.register({
    name: 'settings.section', id: 'hima', order: 40, label: () => 'HimaHarness',
    inject: () => ({ pickFolder }),
  }, SettingsSection));
  ctx.slots.inject('sidebar.footer.action', () => ctx.slots.register({
    name: 'sidebar.footer.action', id: 'hima-workbench',
    inject: () => ({ open: (wide: boolean) => { openRun(); if (wide) ctx.layout.toggleSidebar(); } }),
  }, WorkbenchEntry));
  for (const slot of ['sidebar.brand.mark', 'conversation.hero.brand.mark'] as const) {
    ctx.slots.inject(slot, () => ctx.slots.register({ name: slot, priority: -10 }, HimaMark));
  }
  ctx.slots.inject('sidebar.brand.name', () => ctx.slots.register({ name: 'sidebar.brand.name', priority: -10 }, HimaName));
  ctx.slots.inject('tool.call.toolview', () => {
    const claimed = HIMA_RUN_TOOLS.map((key) => ctx.slots.register({ name: 'tool.call.toolview', key, inject: () => ({ openRun, toolName: key }) }, HimaRunCard));
    claimed.push(ctx.slots.register({ name: 'tool.call.toolview', key: 'hima_author', inject: () => ({ openAuthor: (id: string) => { ctx.sessions.open(id); } }) }, AuthoringCard));
    return () => { for (const dispose of claimed) if (typeof dispose === 'function') (dispose as () => void)(); };
  });
}
