// Errors the faces recognise by type. All but the last two name a fault as demonstrably the
// caller's, not ours. Kept in their own leaf module —
// no imports of their own — because `remote.ts` recognises them by type to classify a failure as
// `hima/bad-request` rather than `hima/internal`, and `remote.ts` is also imported (for its pure
// contract: `HIMA_API_PREFIX` and the view types) by the browser bundle. Were these classes defined
// in `sites.ts` or `rules.ts` instead, importing them into `remote.ts` would pull those modules' Node
// builtins (`node:fs`, `node:path`, `node:url`) into that browser bundle, which has no such builtins.

/**
 * Thrown by `loadSite` for a site *reference* the caller cannot have gotten right: either
 * `<sitesDir>/<name>.yml` itself does not exist, or it exists but its own `name:` is not `name` —
 * on a case-insensitive filesystem `LOCAL` resolves to `local.yml`, and a Site's identity is the one
 * its file states, never the string that resolved it (#19). A missing or broken permit, or a site
 * file that fails its schema, is a fault in a config a person set up ahead of the request, not in
 * the request itself, so those stay plain `Error`s.
 */
export class SiteNotFoundError extends Error {}

/**
 * Thrown by `observe` only for a run *reference* the caller cannot have gotten right: `--run` naming
 * a run the ledger does not hold, or one belonging to a different Site than the file being read —
 * a record may not claim a Site its run never named. Never thrown for a ledger that failed to
 * answer; that is ours.
 */
export class RunReferenceError extends Error {}

/**
 * Thrown by `loadRule` only for a rule *reference* the caller cannot have gotten right: a malformed
 * `<id>@<version>` shape, an id with no rule file, or a version that does not match the one on disk.
 * Never thrown for a rule file that exists but is itself broken (fails its schema, or declares a
 * different id than its file name) — that is a fault in the shipped rules a person authored, not in
 * what the caller asked for.
 */
export class RuleReferenceError extends Error {}

/**
 * Thrown by `loadChooser` only for a chooser *reference* a pack cannot have gotten right: a
 * malformed `<id>@<version>` shape, an id with no chooser file, or a version that does not match the
 * one on disk. Never thrown for a chooser file that exists but is itself broken — that is a fault in
 * the shipped choosers a person authored, exactly as a broken rule file is.
 */
export class ChooserReferenceError extends Error {}

/**
 * Thrown by `loadPack` only when `<packsDir>/<id>/` holds none of the files a pack is made of: the
 * caller named a pack that is not installed. A pack whose files are there but broken — a contract
 * that fails its schema, a graph naming a node that does not exist, a tool file the contract lists
 * and the directory does not hold — is a fault in a pack somebody authored, not in what the caller
 * asked for, so those stay plain `Error`s, exactly as a broken site file does.
 */
export class PackNotFoundError extends Error {}

/**
 * Thrown by the one reading of a pack folder (`pack-folder.ts`, #64) when the folder is not a folder
 * of plain files: something in it that is not a plain file or a directory, an entry that changed
 * inode while it was being read, a name that is not UTF-8 or that no file of a pack can have, or a
 * file that is there and cannot be read.
 *
 * A class rather than a plain `Error` because every face has to answer it in words. "This folder is
 * not a pack folder, and here is the path" is a fact a person can act on — move the link, fix the
 * permissions, rename the file — and it is not this harness failing: a crash would tell them nothing
 * and leave the fault where it was. It is not a `PackNotFoundError`, because the folder *is* there,
 * and telling a person their pack is not installed would send them to install it again.
 */
export class PackFolderError extends Error {}

/**
 * Thrown by `startRun` only for a Run *request* the caller cannot have gotten right: a Goal with no
 * numbers in it, or a Strategy that does not fit what the pack's contract declares — a knob it does
 * not declare, or a value outside the bounds or the list it does declare (#58). Never thrown
 * for a Site that cannot host the pack, a workspace already occupied, or anything else the Site is
 * the author of — those are answers `startRun` returns, because they are facts the caller must be
 * told rather than mistakes the caller made.
 */
export class RunStartError extends Error {}

/**
 * Thrown by `startRun` when a node's turn threw and the Run could not be advanced past it: a Site
 * that stopped answering, a status that could not be asked, a read that failed. The one error here
 * that is *ours* rather than the caller's — it lives beside them because the faces recognise it by
 * type for the same reason they recognise the others, and this module is the one they can all import
 * without pulling Node builtins into the browser bundle.
 *
 * It is thrown only after the fault has been recorded: the node is `blocked` carrying the message
 * and the Run is `waiting`, so the ledger says what happened before anyone is told about it. It
 * carries the Run's id because that is what a person needs next — the Run's records hold the Job
 * that was launched and everything the generation got as far as.
 */
export class RunFaultError extends Error {
  constructor(readonly runId: string, message: string) {
    super(message);
  }
}

/**
 * Thrown when a Site could not be asked a question about a Job, so nobody knows the answer (#18).
 * The second error here that is *ours*, and the one that says least: a `tmux has-session` whose exit
 * 1 is `error connecting to <socket> (Permission denied)` rather than `can't find session`, a probe
 * that came back on no exit code this harness understands, an ssh that could not connect at all.
 *
 * It exists because the alternative is worse than a fault. Read as "the session is not there", any
 * of those blocks a node, spends the Retry allowance and ends a person's Run while a Job of ours goes
 * on holding a licence on the customer's machine, with nothing watching it. So the harness invents no
 * outcome: this is raised, **nothing is written** — no `finished`, no `killed`, no `gone`, no
 * `blocked` node behind an open Job — and whoever asked is told which Site could not be asked and in
 * tmux's own words. The next poll, the next boot or a person asks again.
 *
 * It carries the Site's name because that is what a person acts on: the question is about a machine,
 * not about a Run, and the same Site is what every other Job on it is failing to answer for too.
 */
export class SiteUnreadableError extends Error {
  constructor(readonly site: string, message: string) {
    super(message);
  }
}

/**
 * Thrown by a Model moment when its turn produced no answer (#59): the model route refused the
 * request, failed mid-stream, or was cut off. The third error here that is neither ours nor the
 * caller's — a machine somewhere else did not answer, exactly as `SiteUnreadableError` says of a
 * Site — and it carries that route's own words, because the reason is the entire content of the
 * failure and there is nothing written for the caller to fetch instead.
 *
 * The moment it belongs to is closed `failed` before this reaches anyone, so the ledger says a
 * session opened and how it ended whether or not the caller ever sees this.
 */
export class MomentTurnError extends Error {}

/**
 * Thrown when a moment is asked for on a Run that stands at no node: there is nothing for it to be
 * *at*. The caller's request is well formed and the Run is real — it simply has not reached a node
 * — so the faces answer it the way they answer a resume of a Run that is not waiting.
 */
export class NoCurrentNodeError extends Error {}

/**
 * Thrown when a moment is asked for over the route on a Run that is **running** (#62).
 *
 * The route and the fabric are two openers of moments at one node, and they number their sessions
 * differently on purpose: the fabric's workshop opens one moment per *node attempt*, so the session
 * records and the node records number the same thing, while the route counts a moment of its own
 * (`nextMomentAttempt`) one past the highest any session of that node has made. A moment opened
 * through the route while a workshop attempt is live therefore takes the number the workshop's own
 * retry is about to take, and the node's sessions stop being readable as one per attempt — by a
 * face, by an audit, or by the fold that says where the workshop stands.
 *
 * A Run that is running is being driven by somebody, and a moment on the node it is standing at is
 * that drive's to open. So this is refused while the Run is `running` and allowed at every other
 * status — the Run's own request is well formed, it has simply arrived while the Run was in motion,
 * which is why it is the conflict code and not a bad request.
 */
export class RunRunningError extends Error {}

/**
 * Thrown when a moment is asked for over the route on a Run that is **waiting at a workshop node**
 * (#62).
 *
 * The other half of `RunRunningError`, and the half a restart leaves behind. A workshop whose host
 * went away mid-moment is reconciled by the next boot, which blocks the node and sets the Run
 * `waiting` **without moving it** (`recovery.ts`) — not running, so the rule above lets it through —
 * and the next attempt at that node is the resume's to open, numbered by the node. A moment opened
 * here first would take that number, and the node's session records would stop being one pair per
 * attempt exactly as they would on a Run in motion.
 *
 * A Retry allowance that ran out is **not** that state and is not refused here: spending it routes
 * the Run on to the pack's own Wait node, so the Run stands somewhere else and a moment opened there
 * is numbered against that Wait node and collides with nothing. What this covers is the waiting a
 * restart leaves behind, where the Run never moved off the workshop's node.
 *
 * Read off the ledger alone: the latest `opened` session record at the node the Run stands on carries
 * a `workshop` block, which is the fact that says this node's moments are the fabric's. Nothing is
 * loaded and no pack is opened, so a pack since edited or uninstalled changes none of it.
 */
export class WorkshopNodeError extends Error {}

/** A before-launch callback vetoed before tmux dispatch; unlike a lost response, no Job was sent. */
export class LaunchNotDispatchedError extends Error {}
