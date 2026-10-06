// What the native workspace's preparation form reads (`StartChoices`, `PreparationView`), and the
// one page `GET /hima/` still serves: a message pointing a browser to the native HimaHarness
// workspace. The server-rendered workbench (start form, run list and Run card) retired with the
// pre-DBOS engine; the Run card is the client's (`client/HimaRunCard.tsx`).
//
// The markers a driver reads on the client's Run card:
//   data-hima-region="run-status"       the verdict band; data-hima-state-status="<RunStatus>"
//   data-hima-region="run-meters"       the Budget: every meter against the bound the Run was started
//                                       under. -elapsed-ms, -time-box-ms, -generation,
//                                       -generation-limit, -jobs, -job-cap, -attempts,
//                                       -retry-allowance, one -licence-<name>="held/declared" per
//                                       licence the Site declares (the name lower-cased, because that
//                                       is how the DOM holds an attribute name on either mount), and
//                                       -ended-by="time-box"|"generation-limit"|"cancel" on a Run one
//                                       of them ended. A key the run row does not hold both halves of
//                                       is absent, never a zero. On this page the region is nested
//                                       *inside* `run-status`, under the third question — what it has
//                                       spent — so `read('run-status')` hands back the meters' words
//                                       too; `read`/`wait` find a region by name wherever it sits.
//   data-hima-region="run-generations"  the generations table, one row per generation the Run opened;
//                                       -count, -current (the generation running, else the last),
//                                       and -g<n>="running"|"done"|"blocked" per row. The keys are
//                                       the *outer* graph's rows, as they were: a drill-down Loop's
//                                       generations are rows of the same table but not generations
//                                       of the Campaign, and `run-loops` is what says anything of them
//   data-hima-region="run-loops"        the same ledger, when the Run opened a drill-down Loop (#28):
//                                       -count, how many it opened, and -open, the name of the one
//                                       still open, empty when none is. Absent on a Run that opened
//                                       none. It wraps the whole table because how many Loops a
//                                       Campaign opened is a fact about the Campaign and not about
//                                       one of its rows, and because reading it hands back every
//                                       nested row, whichever generation opened it
//   data-hima-loop="<loopId>"           not a region: it marks the rows of one drill-down Loop —
//                                       its group's head row, each of its generations' rows, and its
//                                       foot row — with the id the `opened` record minted, so the two
//                                       depths of the ledger are told apart in the page's own HTML
//   data-hima-region="run-branches"     the same ledger, when the Run forked (#29): each branch is a
//                                       row under the generation that forked it, and the join's line
//                                       closes them. -count, how many branches the Campaign forked
//                                       into, and -open, the join of the fork it is standing inside
//                                       — empty when it is standing inside none. Absent on a Run that
//                                       forked nowhere. It wraps the whole table for the reasons
//                                       `run-loops` does: both keys are facts about the Campaign
//                                       rather than about one of its rows, and reading it hands back
//                                       every branch row whichever generation forked it
//   data-hima-branch="<branchId>"       not a region: it marks one branch's own row with the branch's
//                                       id — the id of its first node, which every record of it
//                                       carries — so a fork's branches are told apart in the page's
//                                       own HTML and never by the order they happen to be in
//   data-hima-region="run-nodes"        the path; data-hima-state-<nodeId>="<NodeState>" per node
//   data-hima-region="run-cancel"       the stop a person asked for; -observed, what came of the latest
//   data-hima-region="run-blocker"      the blockers; -count, and -node naming the latest
//   data-hima-region="run-blocker-tail" the latest blocker's log tail, as the Job wrote it
//   data-hima-region="run-refusal"      what the run refused to read or to write down, and why; -count
//   data-hima-region="run-workshop"     where the node the Run stands at stands as a workshop (#62),
//                                       and what its current attempt wrote; -workshop, -state,
//                                       -files and -node
//   data-hima-region="run-observation"  what was observed; -count
//   data-hima-region="run-decision"     the decision; -chosen="goal-met"|"converged"|"next-strategy",
//                                       -strategy on a next strategy (the whole Strategy as JSON, by
//                                       the pack's own knob names, because an attribute name is
//                                       case-folded and a knob's is not), -read on a converged one
//   data-hima-region="run-experience"   the Campaign's technical report, on a Run that has ended and
//                                       had one written (#30): where both files are on the Site, what
//                                       each hashes to, a link to the `.md` route, and the report
//                                       itself rendered from its own Markdown. -sha256, the
//                                       Markdown's, and -written-at, the instant both files state as
//                                       their own. Absent on every Run whose report is not written
//   data-hima-region="run-error"        why a control's request was refused; empty text when none.
//                                       On this page it is nested *inside* `run-status`, under the
//                                       fourth question, beside the controls it belongs to — so
//                                       `read('run-status')` hands back a refusal's words and the
//                                       controls' too. `read`/`wait` find a region by name wherever
//                                       it sits, and its own text is still exactly the refusal.
//   data-hima-control="cancel"          stops the Run; shown while it is running or waiting
//   data-hima-control="resume"          carries a waiting Run on; shown only while it waits
import type { PackCheck, PackOverview } from './packs.js';
import { HIMA_WORKBENCH_PATH } from './paths.js';
import type { RunWords, StrategyDeclaration } from './remote.js';
import { WORKBENCH_STYLE } from './workbench-style.js';

const escape = (text: string): string =>
  text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/**
 * What this home has installed, which is what the start form offers to start a Campaign of — and
 * which pack's Strategy the knob fields are for.
 *
 * `pack` is the selection the form is rendered *for*: the one the page asked for by `?pack=`, else
 * the first installed. `strategy` is that pack's own declaration and `words` its own words (#58),
 * both read by the host when the page is composed. The selected Site and static check travel with
 * those fields. Unreadable declarations carry a preparation diagnostic and cannot be submitted;
 * the final start operation still reloads and checks the Pack and Site.
 */
export interface StartChoices {
  readonly packs: readonly string[];
  readonly sites: readonly string[];
  readonly pack?: string;
  readonly site?: string;
  readonly check?: PackCheck;
  readonly preparation?: { readonly kind: 'request' | 'pack' | 'site'; readonly message: string };
  readonly goal?: import('./run-arguments.js').GoalDeclaration;
  readonly strategy?: StrategyDeclaration;
  readonly words?: RunWords;
  /** One read-only Campaign preparation. It creates no Run, workspace, Job or Ledger row. */
  readonly proposal?: PreparationView;
  /**
   * What each pack's option is marked with, by pack id (#64): `test pack (<stage>)` for a folder the
   * authoring pipeline has started and not finished, `unreadable: <why>` for one whose own reading
   * refuses it, and nothing at all for a released pack or a hand-written one.
   *
   * Read by the host when the page is composed, for the reason `strategy` is: a pack folder is a
   * directory and this module opens none. A pack with no entry here is offered plain, which is every
   * pack this repository ships.
   */
  readonly marks?: Readonly<Record<string, string>>;
  /**
   * The packs a person may not choose: a folder whose own reading refuses it has no contract, no
   * graph and no rung, so there is nothing for a start to be a start of (#64).
   *
   * Still listed, and listed with its mark: a pack that vanished off the form would tell a person
   * nothing, and what they need is the path the reading refused. Absent when every installed folder
   * reads, which is every home this repository's own tests leave behind but the two that arrange one
   * on purpose — and it is composed whether or not any folder is startable, because a home where
   * none is, is the one that most needs every option to say why.
   */
  readonly cannotStart?: readonly string[];
}

export interface PreparationView {
  readonly id: string;
  readonly ready: boolean;
  readonly pack: PackOverview;
  readonly site?: {
    readonly name: string;
    readonly kind: 'local' | 'ssh';
    readonly readiness: 'ready' | 'needs-discovery' | 'stale';
    readonly resources: { readonly cores: number; readonly memoryGiB: number; readonly parallelJobs: number };
  };
  readonly inputs: readonly { readonly name: string; readonly description: string; readonly value?: string; readonly ready: boolean; readonly source?: 'file' | 'site' }[];
  readonly knowledge: { readonly documents: number; readonly ready: boolean; readonly currentDocuments: number };
  readonly probe: { readonly status: 'declaration-only' | 'discovered' | 'needed' | 'stale'; readonly observedAt?: string };
  readonly goal: Readonly<Record<string, number>>;
  readonly strategy: Readonly<Record<string, string | number>>;
  /**
   * What this Pack calls each Goal parameter it declares, in the same order `goal` above states
   * them, for a caller that must ask a person for a value this file did not supply (#41 task 3): a
   * Campaign file editor renders one field per entry here, whether or not the Campaign file — or
   * this call's overrides — currently answers it.
   */
  readonly goalDeclared: Readonly<Record<string, { readonly label: string; readonly unit?: string; readonly min?: number; readonly max?: number; readonly precision?: number }>>;
  /** The Budget this preparation would start with, and where each of its three numbers comes from:
   *  a Campaign file's own override, the Pack's own declaration, or this Harness's own default,
   *  applied in that order (#41 task 3). `jobCap`/`licences` are the Site's own declared scarcity,
   *  carried here rather than computed twice, and absent with no Site selected. */
  readonly budget: {
    readonly timeBoxMinutes: { readonly value: number; readonly source: 'request' | 'file' | 'pack' | 'harness' };
    readonly retries: { readonly value: number; readonly source: 'request' | 'file' | 'pack' | 'harness' };
    readonly generations: { readonly value: number; readonly source: 'request' | 'file' | 'pack' | 'harness' };
    readonly jobCap?: number;
    readonly licences?: Readonly<Record<string, number>>;
  };
  readonly referenceGraph: { readonly entry: string; readonly nodes: readonly { readonly id: string; readonly kind: string }[]; readonly edges: readonly { readonly from: string; readonly to: string; readonly outcome?: string; readonly revisit?: boolean }[] };
  readonly unknowns: readonly string[];
  readonly nextActions: readonly string[];
}

// A Run moves while it is watched, and the host renders this page once. So the open document asks
// the same URL for itself every second — same route, same fence, the session it was loaded under —
// and swaps `<main>` only when the host rendered something different. There is no second endpoint,
// no stream and no state in the page: what it shows is always one render of the run view, whole.
//
// Swapping only on a difference is what lets a driver read and click between refreshes: the DOM
// stands still while the Run does, and every marker of the card lives inside `<main>`, so a swap
// replaces the regions and their `data-hima-state-*` attributes together (D42, ADR-0004 — a `wait`
// is only meaningful against a page that changes). The start form is deliberately outside `<main>`,
// because a form is what a person is typing into and not a rendering of anything the ledger holds.
//
// A control's own refusal (`run-error`) is inside `<main>` and so is cleared by the next swap. That
// is the right lifetime rather than an oversight: every refusal a caller can act on by re-reading
// the Run *is* the swap that clears it, and the one refusal that leaves the Run untouched — a Site
// that could not be asked, where nothing at all was written — leaves the card unchanged too, so its
// message stays on screen for exactly as long as it is still true.
//
// Every value here is a literal: the client bundle imports `HIMA_API_PREFIX` from `remote.ts`, which
// imports this module, and a call at module scope is a side effect esbuild may not shake out — this
// server-side string would then be shipped to the browser for nothing.
const REFRESH = `(() => {
  const main = document.querySelector('main');
  if (main === null) return;
  let shown = main.innerHTML;
  const look = async () => {
    const answer = await fetch(location.href, { credentials: 'same-origin', headers: { accept: 'text/html' } });
    if (!answer.ok) return;
    const fresh = new DOMParser().parseFromString(await answer.text(), 'text/html').querySelector('main');
    if (fresh === null || fresh.innerHTML === shown) return;
    shown = fresh.innerHTML;
    main.innerHTML = shown;
  };
  setInterval(() => { look().catch(() => undefined); }, 1000);
})();`;

/**
 * One whole page: the head, the chrome with the way back to the chat and the list, whatever stands
 * above the swapped `<main>`, the body, and the scripts this page needs.
 */
function page(title: string, crumb: string, body: string, above = '', script = ''): string {
  return '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">'
    + `<title>${escape(title)}</title><style>${WORKBENCH_STYLE}</style></head><body>`
    + '<a class="skip-link" href="#workbench-content">Skip to workbench content</a>'
    + `<header class="chrome"><h1>HimaHarness</h1><nav aria-label="Main navigation"><a href="/" data-hima-control="open-chat">HimaGuide</a><a href="${HIMA_WORKBENCH_PATH}" aria-current="${crumb === '' ? 'page' : 'true'}" data-hima-control="open-workbench">Workbench</a></nav>${crumb}</header>`
    + `<div id="workbench-content" class="page" tabindex="-1">${above}<main>${body}</main></div>`
    + `<script>${REFRESH}</script>${script === '' ? '' : `<script>${script}</script>`}</body></html>`;
}

/** `GET /hima/?run=<id>` for a Run the ledger does not hold, or a request the fence or the method refused: the reason, on the same page. */
export const messagePage = (message: string): string =>
  page('HimaHarness workbench', '', `<section class="band"><p class="note">${escape(message)}</p></section>`);
