// A HimaPack is a folder of plain files (D28), never code: a human-readable spec, a run contract
// naming what a Site must bind and what a generation produces, a graph of the four node kinds, a
// tools directory, and references by identity to the rules its judge nodes apply and the choosers
// its explore nodes pick by. This module is what reads that folder and says whether a given Site can
// host it.
//
// Two things follow from a pack being data. The first is that every part of it can be diffed and
// reviewed by a person who does not read TypeScript, which is the point of D28. The second is that
// nothing here decides anything about a Site: a pack states which wrapper its tools run, and the
// Site's Permit — not the pack — decides whether that wrapper may run there. `checkPack` asks that
// question of the Permit for every tool before a Campaign starts, using the very function
// `decideLaunch` will use when one does, so a check that says a pack fits cannot disagree with the
// decision that later refuses it.
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { parse } from 'yaml';
import { z } from 'zod';
import { loadRule } from './rules.js';
import { loadChooser, namesIn, type Chooser } from './choosers.js';
import { loopOutcome, verdictOutcome, type VerdictOutcome } from './ledger.js';
import { readerNamed } from './readers.js';
import { permitsWrapper, refusedWrapper } from './shell.js';
import { licenceName, type Site } from './sites.js';
// Type-only, and erased: the shape a face renders a pack's words in is declared beside the rest of
// the run view (`remote.ts`), which the browser bundle reads and this module — which opens
// directories — cannot be reached from.
import type { RunWords } from './remote.js';
// Type-only, and erased: what a knob may be is declared in the leaf module all three faces read it
// from (`run-arguments.ts`), so the browser bundle that renders a knob's field and the routes that
// carry a knob's value share one shape with the schema here that parses it.
import type { StrategyDeclaration, StrategyKnob } from './run-arguments.js';
import { PackNotFoundError } from './errors.js';

// Re-exported so a caller of `loadPack` finds the error it can throw right beside it.
export { PackNotFoundError };

/**
 * Where a Campaign's copy of the Site's flow lives inside its workspace. Part of the anatomy rather
 * than of any one pack: a pack's outputs are named relative to the workspace and its tools drive the
 * copy, so there is one place for it and no pack gets to choose another.
 */
export const flowDirName = 'flow';

/** The file a prepared workspace carries, saying what it is and what was copied into it. */
export const workspaceFileName = 'workspace.json';

/** The files a pack is made of, in the order a person reads them. */
export const packFiles = { spec: 'PACK.md', contract: 'contract.yml', graph: 'graph.yml' } as const;

/** A pack id is a directory name, so it is constrained to a safe shape rather than trusted. */
const packId = z.string().regex(/^[a-z0-9][a-z0-9-]*$/, 'a pack, tool, node or chooser id is lowercase letters, digits and dashes');
/** What a binding, an input, an output or a tool's variable may be called. */
const declaredName = z.string().regex(/^[A-Za-z][A-Za-z0-9_]*$/, 'a name is a letter followed by letters, digits or underscores');

// ---------------------------------------------------------------------------------------------
// The run contract: what a Site must bind, what a generation produces, and what the pack runs.
// ---------------------------------------------------------------------------------------------

export const contractInput = z.strictObject({ name: declaredName, description: z.string().default('') });

/** One thing a generation leaves in its workspace: a path relative to the workspace, and the reader
 *  that makes sense of it when one does. `${input}` in the path is bound from the Site's bindings. */
export const contractOutput = z.strictObject({
  name: declaredName,
  path: z.string().min(1),
  reader: z.string().min(1).optional(),
  description: z.string().default(''),
});

/**
 * One tool: the file a person reads and can run by hand, and the command line HimaFabric launches on
 * the Site. `argv` is authoritative — it is what actually runs — and its first word is what the
 * Permit decides on. The script beside it is the same command line written for a person; that the
 * two agree is asserted of the shipped pack by the contract suite, where a reader can see both.
 */
export const packTool = z.strictObject({
  id: packId,
  file: z.string().min(1),
  description: z.string().default(''),
  /** The variables the tool's script reads, and the only names `argv` may reference. */
  inputs: z.array(declaredName).default([]),
  /**
   * How many seats of each licence a Job of this tool holds for as long as it runs — one Design
   * Compiler seat for a synthesis. Declared by the pack because it is a fact about the tool, and
   * held against the Site's own `capacity.licences` by `checkPack`, which is where a pack that could
   * never launch on a Site is said to be unfit.
   *
   * A tool that holds none declares none: the counts here are positive, so "this tool needs no seat"
   * is said by omission rather than by a zero, exactly as every other absent fact in this harness is.
   */
  licences: z.record(licenceName, z.number().int().positive()).default({}),
  argv: z.array(z.string().min(1)).min(1),
});

/**
 * What a pack calls one of the values a Run is stated in, and what it is measured in (#42):
 * `target_period_ns: { label: clock period at most, unit: ns }`.
 *
 * The label is required and non-empty. A pack that has nothing to say about a number says nothing
 * about it — the faces then show it under the name the wire carries — and a label with no unit
 * beside it would put a bare number in front of a person on a page whose whole subject is
 * nanoseconds.
 *
 * The unit is optional for one case and `checkPack` holds it to exactly that one (#58): a Strategy
 * knob of type `choice`, whose value is one of the pack's own words and is measured in nothing.
 * Every other name declared here states a unit, because every other name is a number.
 */
export const packWord = z.strictObject({ label: z.string().min(1), unit: z.string().min(1).optional() });
export type PackWord = z.infer<typeof packWord>;

/**
 * One knob of the Strategy a Run of this pack is set to (#58): a number in a unit with bounds, or a
 * choice out of a list, each with the default a Run starts at.
 *
 * What a Strategy is made of is the pack's, not the harness's: the harness owns the two kinds above
 * and validates every value against what is declared here, and that is the whole of what it knows
 * about a knob. The words a person reads it under are declared beside every other word, under
 * `words:`, keyed by the knob's own name.
 *
 * Every field is required, so a knob says all of itself in one place, and the two bounds hold: a
 * `min` above its `max` is a knob nothing could be set to, and a default outside the bounds or
 * outside the list is a Run nobody could start without overriding it.
 */
export const strategyKnob = z
  .discriminatedUnion('type', [
    z.strictObject({
      type: z.literal('number'),
      unit: z.string().min(1),
      min: z.number(),
      max: z.number(),
      default: z.number(),
    }),
    z.strictObject({
      type: z.literal('choice'),
      options: z.array(z.string().min(1)).min(1),
      default: z.string().min(1),
    }),
  ])
  .superRefine((knob, ctx) => {
    if (knob.type === 'choice') {
      if (!knob.options.includes(knob.default)) {
        ctx.addIssue({ code: 'custom', message: `default "${knob.default}" is not one of ${knob.options.map((o) => `"${o}"`).join(', ')}`, path: ['default'] });
      }
      return;
    }
    if (knob.min > knob.max) {
      ctx.addIssue({ code: 'custom', message: `min ${String(knob.min)} is above max ${String(knob.max)}`, path: ['min'] });
      return;
    }
    if (knob.default < knob.min || knob.default > knob.max) {
      ctx.addIssue({ code: 'custom', message: `default ${String(knob.default)} is outside ${String(knob.min)} through ${String(knob.max)}`, path: ['default'] });
    }
  });

export const packContract = z.strictObject({
  id: packId,
  version: z.string(),
  title: z.string(),
  inputs: z.array(contractInput).min(1),
  outputs: z.array(contractOutput).default([]),
  /** What the Site must let this pack run: every wrapper its tools' command lines begin with. */
  environment: z.strictObject({ wrappers: z.array(z.string().min(1)).default([]) }),
  /** What preparing a Campaign workspace copies out of the bound flow root, into `<workspace>/flow/`. */
  workspace: z.strictObject({ copy: z.array(z.string().min(1)).default([]) }),
  tools: z.array(packTool).default([]),
  rules: z.array(z.string().min(1)).default([]),
  /**
   * What a Run of this pack is set to for one generation, and what it may be set to (#58): one entry
   * per knob, keyed by the name every face carries that knob under.
   *
   * Required, and at least one knob, because a Strategy is what an Explore node chooses anew
   * (CONTEXT.md) and a pack with nothing to choose has no Loop to run. The harness owns no knob of
   * its own: this block is the whole of what a Strategy is for a Run of this pack, and every value —
   * the start form's, `--set`'s, a request body's — is held against it before the Run starts.
   *
   * The "at least one" is a rule of the schema beside the knob's own two — the bounds hold, and the
   * default is inside them — because a rule of the contract belongs where the contract is read. An
   * empty block that loaded would reach a person as a start form with no field on it, a chooser
   * every clause of which sets a knob nothing declares, and finally the ledger's own row schema
   * refusing a Strategy with nothing in it: a storage error in place of a sentence about the pack.
   */
  strategy: z.record(declaredName, strategyKnob).refine((knobs) => Object.keys(knobs).length > 0, {
    error: 'strategy: declares no knob, and a pack whose Strategy has nothing in it has nothing for an Explore node to choose',
  }),
  /**
   * What this pack's numbers are called, for the faces a person reads (#42): one entry per Goal
   * parameter its graph binds and one per knob a Run's Strategy is made of, keyed by that very name.
   *
   * Declared by the pack because the pack is what knows: `target_period_ns` is a name the harness
   * carries and "clock period at most, in ns" is what it means, and only the method that named it
   * can say so. Optional, and empty by default — a pack that declares none renders under the names,
   * exactly as every pack did before this block existed. A name here that the pack neither takes
   * from the Goal nor sets as a Strategy knob is a label no face could ever reach, and
   * `/hima pack check` refuses it.
   */
  words: z.record(declaredName, packWord).default({}),
});
export type PackContract = z.infer<typeof packContract>;
export type PackTool = z.infer<typeof packTool>;
export type ContractOutput = z.infer<typeof contractOutput>;

// ---------------------------------------------------------------------------------------------
// The graph: four node kinds and outcome-labelled edges, and nothing else (CONTEXT.md).
// ---------------------------------------------------------------------------------------------

/** A value a node takes from the Run rather than from the pack: the current strategy, or the goal. */
export const runReference = z.strictObject({ from: z.enum(['strategy', 'goal']), name: declaredName });
export type RunReference = z.infer<typeof runReference>;

/** What a node parameter may be: a number or a word the pack fixes, or a value the Run supplies. */
export const nodeArgument = z.union([z.number(), z.string(), runReference]);
export type NodeArgument = z.infer<typeof nodeArgument>;

const actNode = z.strictObject({
  id: packId,
  kind: z.literal('act'),
  parameters: z
    .strictObject({
      /** A tool of the contract to run on the Site. */
      tool: packId.optional(),
      /** An output of the contract to read into HimaLedger. */
      observes: declaredName.optional(),
      /** What the Run supplies to that tool for this generation; the strategy knob and the like. */
      arguments: z.record(declaredName, nodeArgument).default({}),
    })
    .refine((p) => (p.tool === undefined) !== (p.observes === undefined), {
      error: 'an act node either runs a tool or observes a contract output, and must name exactly one of the two',
    }),
});

const judgeNode = z.strictObject({
  id: packId,
  kind: z.literal('judge'),
  parameters: z.strictObject({
    /** The rules to apply, in order. The outgoing edge is chosen by the outcome of the first. */
    rules: z.array(z.string().min(1)).min(1),
    /** What binds each parameter a rule declares — the Run's goal, for the goal rule. */
    bind: z.record(declaredName, runReference).default({}),
  }),
});

/**
 * When a pack's Loop has stopped learning, in the chooser's own vocabulary (D43).
 *
 * `read` names one of the chooser's `reads`; `band` is a distance in that read's unit; `generations`
 * is how many successive generations must each have moved that measured value by less than the band,
 * from the generation before it, before the exploration is called converged. `generationLimit` is
 * this pack's default for the Budget meter of the same name — how many generations a Campaign of it
 * may open at all — which a person may override at start.
 *
 * Convergence is a fact about measurements, so it is stated here, over the values the ledger holds,
 * and evaluated by the harness: a chooser clause could only say what the pack thinks about *this*
 * generation, and "successive generations stopped moving" is not a thing one generation knows.
 *
 * The whole block is optional, and all four are required inside it: a pack that declares
 * convergence declares what it means by it, and one that declares none has a Loop bounded by the
 * generation limit alone.
 */
export const packConverge = z.strictObject({
  read: declaredName,
  band: z.number(),
  generations: z.number().int().positive(),
  generationLimit: z.number().int().positive(),
});
export type PackConverge = z.infer<typeof packConverge>;

const exploreNode = z.strictObject({
  id: packId,
  kind: z.literal('explore'),
  parameters: z.strictObject({
    /**
     * The chooser to apply, by identity — a file under `choosers/`, exactly as a rule is (D38).
     *
     * Optional because an Explore node has two things it can be: the one that applies a chooser and
     * decides, and the one that opens a Loop of its own and drills down (#28). Exactly one of
     * `chooser` and `opens`, held by `validatePack` rather than by this schema so a pack that names
     * both meets a person as a sentence about their file and not as a parse error.
     */
    chooser: packId.optional(),
    /**
     * The Loop this node opens instead of choosing: the name of one of `graph.loops` (CONTEXT.md,
     * *Explore node* — "drillable into its own small graph"). The fabric runs that graph to its own
     * ending with its own generation counter, and this node's outgoing edges are labelled by the
     * outcome it closed with.
     */
    opens: packId.optional(),
    /**
     * What binds each parameter the chooser declares: the guard band the pack leaves on the table on
     * purpose, and the like. The pack author's numbers, not the chooser's, which is why they are
     * here and not in the chooser file. Spelled as a judge node binds a rule's parameters.
     */
    bind: z.record(declaredName, z.number()).default({}),
    /** When this Loop has stopped learning, and how many generations it may take at most. */
    converge: packConverge.optional(),
  }),
});

const waitNode = z.strictObject({
  id: packId,
  kind: z.literal('wait'),
  parameters: z.strictObject({ blocker: z.string().min(1) }),
});

export const packNode = z.discriminatedUnion('kind', [actNode, judgeNode, exploreNode, waitNode]);
export type PackNode = z.infer<typeof packNode>;

/**
 * An edge, labelled with the outcome it is taken on where a judge chooses between several.
 *
 * `revisit` marks the one edge of a Loop that goes back: it leaves an Explore node, leads to an act
 * node, and following it opens the next Generation with the Strategy the decision chose (D43). It is
 * the only edge a graph may close a cycle with, which is what makes a Loop something a person can
 * see in `graph.yml` rather than something the engine does behind one. Stated by its presence alone
 * — `revisit: false` is not an edge that revisits, it is an ordinary edge spelled at length — so the
 * literal is `true` and an ordinary edge carries no key at all.
 */
export const packEdge = z.strictObject({
  from: packId,
  to: packId,
  /**
   * What this edge is taken on. A judge node's edges carry one of HimaJudge's three verdict
   * outcomes; an Explore node that opens a Loop carries one of the three a Loop can close with
   * (#28). Every other edge carries none, which `validatePack` holds: a label on an edge nothing
   * ever labels is a route a person would read and the engine would never take.
   */
  outcome: z.enum([...verdictOutcome.options, ...loopOutcome.options]).optional(),
  revisit: z.literal(true).optional(),
});
export type PackEdge = z.infer<typeof packEdge>;

/**
 * One Loop an Explore node may open: a graph of its own, with the same four node kinds, its own
 * entry, its own Explore node with its own `converge`, and its own revisit edge (#28).
 *
 * Declared beside the pack's graph rather than inside it because its nodes are not the outer graph's
 * to route between: no edge crosses in or out, and the only way in is an Explore node that names it.
 * Node ids are unique across the whole pack all the same, so a node record, a Job and an attempt all
 * say which node they are about with one id and nothing qualifying it.
 *
 * One level: a Loop's own Explore node applies a chooser and may not open a second Loop (spec,
 * *Out of Scope*).
 */
export const packLoop = z.strictObject({
  entry: packId,
  nodes: z.array(packNode).min(1),
  edges: z.array(packEdge).default([]),
});
export type PackLoop = z.infer<typeof packLoop>;

export const packGraph = z.strictObject({
  id: packId,
  version: z.string(),
  entry: packId,
  nodes: z.array(packNode).min(1),
  edges: z.array(packEdge).default([]),
  /** The Loops this pack's Explore nodes may open, by name. A pack that drills nowhere declares none. */
  loops: z.record(packId, packLoop).default({}),
});
export type PackGraph = z.infer<typeof packGraph>;

/**
 * What HimaFabric actually runs a Run through: an entry, some nodes, and the edges between them. The
 * pack's own graph and each of its Loops are both one of these, which is what lets `drive` run a
 * Loop with the code that runs a graph rather than with a second engine beside it.
 */
export interface RunGraph {
  readonly entry: string;
  readonly nodes: readonly PackNode[];
  readonly edges: readonly PackEdge[];
}

/** One pack as it was read off disk: where it is, and the two files that say what it does. */
export interface Pack {
  readonly id: string;
  readonly dir: string;
  readonly contract: PackContract;
  readonly graph: PackGraph;
}

/** Every graph a pack holds: its own first, then each Loop with the name it is declared under. */
export const graphsOf = (pack: Pack): { readonly loop: string | undefined; readonly graph: RunGraph }[] => [
  { loop: undefined, graph: pack.graph },
  ...Object.entries(pack.graph.loops).map(([loop, graph]) => ({ loop, graph })),
];

/**
 * Where one node of a pack stands: the node itself, the graph it belongs to, and the Loop that graph
 * is, if it is one.
 *
 * The single lookup every caller uses, because a Run's `currentNode` is one id and node ids are
 * unique across a pack: the driver finds the node to run and the graph to route it in, a
 * reconciliation finds the node an interrupted Job belongs to, and a cancel finds the node to settle
 * — all with one answer, so none of them can come to disagree about which graph a node is in.
 *
 * @param pack - the pack the Run runs.
 * @param nodeId - the node, as the run row or a record names it.
 * @returns the node and its graph, or undefined when this pack has no such node.
 */
export function positionOf(pack: Pack, nodeId: string | undefined): { node: PackNode; graph: RunGraph; loop: string | undefined } | undefined {
  if (nodeId === undefined) return undefined;
  for (const { loop, graph } of graphsOf(pack)) {
    const node = graph.nodes.find((n) => n.id === nodeId);
    if (node) return { node, graph, loop };
  }
  return undefined;
}

/**
 * Every Goal parameter this pack binds: the names its graph takes `{ from: goal }`, in a judge
 * node's `bind` or an act node's `arguments`, across its own graph and every Loop it drills into.
 *
 * A Campaign's Goal is a map the *Run* supplies, so nothing about it is fixed by the harness — where
 * a pack says which of its numbers it reads is these references, and this is the one reading of
 * them, so a pack's declared words and the values its nodes are handed are held against one list.
 *
 * @param pack - the pack.
 * @returns the parameter names, without duplicates, in the order the graph first references them.
 */
export function goalParametersOf(pack: Pack): string[] {
  const found = new Set<string>();
  for (const { graph } of graphsOf(pack)) {
    for (const node of graph.nodes) {
      const references = node.kind === 'judge'
        ? Object.values(node.parameters.bind)
        : node.kind === 'act'
          ? Object.values(node.parameters.arguments).filter((a): a is RunReference => typeof a === 'object')
          : [];
      for (const reference of references) if (reference.from === 'goal') found.add(reference.name);
    }
  }
  return [...found];
}

/**
 * The knobs a Run of this pack's Strategy is made of: the pack's own, declared in its contract
 * (#58), in the order it declares them — which is the order its start form shows them in.
 *
 * A pack chooses which Goal parameters it reads, and it chooses what a Strategy is. Every Run
 * HimaFabric starts carries every one of these on its row and every face renders them, whether or
 * not any node of that pack happens to reference one — so a word for a knob is a word a person will
 * read, and a graph that never names the knob does not make it unreachable.
 */
export const strategyKnobsOf = (pack: Pack): string[] => Object.keys(pack.contract.strategy);

/**
 * What this pack calls the numbers a Run of it is stated in, filed by where each number comes from:
 * what the run view carries and every face renders (#42).
 *
 * Undefined — never an empty pair of maps — when the pack has nothing to say about any number a face
 * could look up, so a face has one question to ask and one fallback to take: the names, as before
 * this existed. A word declared for anything else is filed nowhere, which is the state `checkPack`
 * refuses; it is not this function's business to raise, because a card is not the place a pack
 * author is told their file is wrong.
 *
 * @param pack - the pack the Run runs.
 * @returns the words, or undefined when the pack declares none that reach a number.
 */
export function packWords(pack: Pack): RunWords | undefined {
  const declared = Object.entries(pack.contract.words);
  if (declared.length === 0) return undefined;
  const filed = (names: readonly string[]): Record<string, PackWord> =>
    Object.fromEntries(declared.filter(([name]) => names.includes(name)));
  const words = { goal: filed(goalParametersOf(pack)), strategy: filed(strategyKnobsOf(pack)) };
  return Object.keys(words.goal).length + Object.keys(words.strategy).length === 0 ? undefined : words;
}

/**
 * The words the pack a Run names declares, read off the installed packs directory — what the host
 * hands the run view for every Run it answers with (#42).
 *
 * Every way of not finding them answers undefined, including a pack that no longer loads: a Run
 * whose pack has since been uninstalled, renamed, or edited into something that does not hang
 * together still has a card, and that card shows the names HimaLedger itself holds. A page that
 * would not render because a directory moved is a worse answer than the names, and *why* a pack
 * cannot be loaded is what `/hima pack check` says at length — not something to raise from a render
 * that happens once a second.
 *
 * @param packsDir - the directory holding one directory per installed pack.
 * @param id - the pack the Run names, or undefined for a Probe-campaign Run, which names none.
 * @returns the words, or undefined when there are none to be had.
 */
export function installedPackWords(packsDir: string, id: string | undefined): RunWords | undefined {
  if (id === undefined) return undefined;
  try {
    return packWords(loadPack(packsDir, id));
  } catch {
    return undefined;
  }
}

/**
 * The knobs the pack a Run names declares, read off the installed packs directory — what the start
 * form renders one field per, and what the harness holds a start's values against (#58).
 *
 * Every way of not finding them answers undefined, for the reason `installedPackWords` does: a pack
 * that no longer loads still has a page, and *why* it cannot be loaded is what `/hima pack check`
 * says at length. A form with no knob fields is a form that starts a Run at the pack's own defaults,
 * and the start itself refuses what it cannot read.
 *
 * @param packsDir - the directory holding one directory per installed pack.
 * @param id - the pack, or undefined for a Probe-campaign Run, which names none.
 * @returns the declaration, or undefined when there is none to be had.
 */
export function installedPackStrategy(packsDir: string, id: string | undefined): StrategyDeclaration | undefined {
  if (id === undefined) return undefined;
  try {
    return loadPack(packsDir, id).contract.strategy;
  } catch {
    return undefined;
  }
}

// ---------------------------------------------------------------------------------------------
// Placeholders: `${name}` in a contract path or a tool's argv.
// ---------------------------------------------------------------------------------------------

const placeholder = /\$\{([A-Za-z][A-Za-z0-9_]*)\}/g;

/** Every `${name}` a string references, in order, without duplicates. */
export function placeholdersIn(text: string): string[] {
  return [...new Set([...text.matchAll(placeholder)].map((m) => m[1]!))];
}

/**
 * `text` with every `${name}` replaced by the value bound to it.
 *
 * @throws when a placeholder has no value. A pack whose paths and argv reference only declared names
 *         is checked at load, so reaching this means a caller passed an incomplete map — never a
 *         reason to substitute an empty string and write to a path nobody meant.
 */
export function substitute(text: string, values: Readonly<Record<string, string>>, what: string): string {
  return text.replace(placeholder, (_all, name: string) => {
    const value = values[name];
    if (value === undefined) throw new Error(`${what} references \${${name}}, which nothing bound`);
    return value;
  });
}

/** A tool's command line with its inputs bound: what HimaFabric launches, and what the Permit decides. */
export function toolArgv(tool: PackTool, values: Readonly<Record<string, string>>): string[] {
  return tool.argv.map((word) => substitute(word, values, `tool "${tool.id}"`));
}

/** Where one of the contract's outputs is, relative to the Campaign workspace. */
export function outputPath(output: ContractOutput, bindings: Readonly<Record<string, string>>): string {
  return substitute(output.path, bindings, `output "${output.name}"`);
}

// ---------------------------------------------------------------------------------------------
// Loading.
// ---------------------------------------------------------------------------------------------

function readPackFile(dir: string, name: string): string | undefined {
  try {
    return readFileSync(path.join(dir, name), 'utf8');
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
    throw err;
  }
}

/**
 * Load `<packsDir>/<id>/` and validate it against itself: the two YAML files, and every reference one
 * makes to the other. Throws `PackNotFoundError` when there is no such pack, and a plain `Error` when
 * there is one and it does not hang together — the same split `loadSite` makes between a site nobody
 * installed and a site file somebody wrote wrong.
 *
 * What is checked here is what a pack can be wrong about on its own. Whether a *Site* can host it —
 * bindings, wrappers, rules, readers — is `checkPack`, because those answers depend on the Site.
 */
export function loadPack(packsDir: string, id: string): Pack {
  if (!packId.safeParse(id).success) throw new PackNotFoundError(`invalid pack id "${id}"; a pack id is lowercase letters, digits and dashes`);
  const dir = path.join(packsDir, id);
  const contractText = readPackFile(dir, packFiles.contract);
  if (contractText === undefined) {
    throw new PackNotFoundError(`unknown pack "${id}": no ${packFiles.contract} at ${path.join(dir, packFiles.contract)}`);
  }
  const graphText = readPackFile(dir, packFiles.graph);
  if (graphText === undefined) throw new Error(`pack ${id} has a ${packFiles.contract} but no ${packFiles.graph} beside it`);
  const contract = packContract.parse(parse(contractText));
  const graph = packGraph.parse(parse(graphText));
  const pack: Pack = { id, dir, contract, graph };
  validatePack(pack);
  return pack;
}

/**
 * Every pack installed here, by id, in the order a person reads a list: what the workbench's start
 * form offers, so nobody has to know a pack id by heart to start a Campaign (#26).
 *
 * A directory holding a `contract.yml` is a pack; anything else under `packsDir` is not one and is
 * passed over in silence, because a stray file beside the installed packs is not this list's business
 * and a form that refused to render because of one would be a worse answer than a shorter list. The
 * pack is not loaded: the form offers a name to choose, and whether that pack hangs together and fits
 * the Site is what starting a Run answers, in the words `/hima pack check` uses.
 *
 * @param packsDir - the directory holding one directory per installed pack.
 * @returns the pack ids, sorted; empty when there is no such directory at all.
 */
export function installedPacks(packsDir: string): string[] {
  let names: string[];
  try {
    names = readdirSync(packsDir);
  } catch {
    return [];
  }
  return names
    .filter((name) => packId.safeParse(name).success && existsSync(path.join(packsDir, name, packFiles.contract)))
    .sort();
}

/** Every way a pack can contradict itself. Each one throws naming the file a person must edit. */
function validatePack(pack: Pack): void {
  const { id, dir, contract, graph } = pack;
  const broken = (file: string, why: string): never => { throw new Error(`pack ${id}: ${file} ${why}`); };
  if (contract.id !== id) broken(packFiles.contract, `declares id "${contract.id}", but it is installed as "${id}"`);
  if (graph.id !== id) broken(packFiles.graph, `declares id "${graph.id}", not "${id}"`);
  if (graph.version !== contract.version) broken(packFiles.graph, `is version ${graph.version} while ${packFiles.contract} is version ${contract.version}`);

  const inputNames = new Set(contract.inputs.map((i) => i.name));
  const referencesInputs = (text: string, what: string): void => {
    for (const name of placeholdersIn(text)) {
      if (!inputNames.has(name)) broken(packFiles.contract, `${what} references \${${name}}, which is not one of its inputs`);
    }
  };
  for (const output of contract.outputs) referencesInputs(output.path, `output "${output.name}"`);
  for (const piece of contract.workspace.copy) referencesInputs(piece, `workspace copy entry "${piece}"`);

  // A tool's file must be there — a contract naming a script the directory does not hold is a pack
  // nobody can read, let alone run by hand — and its argv may reference only what it declares.
  const wrappers = new Set<string>();
  for (const tool of contract.tools) {
    if (readPackFile(dir, tool.file) === undefined) broken(packFiles.contract, `names tool file ${tool.file} for "${tool.id}", which the pack does not hold`);
    const declared = new Set(tool.inputs);
    for (const word of tool.argv) {
      for (const name of placeholdersIn(word)) {
        if (!declared.has(name)) broken(packFiles.contract, `tool "${tool.id}" references \${${name}}, which is not one of its declared inputs`);
      }
    }
    wrappers.add(tool.argv[0]!);
  }
  // The pack states once, in `environment`, every wrapper a Site must allow it. If that list and the
  // tools disagreed, `/hima pack check` would be reporting a promise no tool keeps.
  const declaredWrappers = new Set(contract.environment.wrappers);
  for (const w of wrappers) if (!declaredWrappers.has(w)) broken(packFiles.contract, `a tool runs "${w}", which environment.wrappers does not declare`);
  for (const w of declaredWrappers) if (!wrappers.has(w)) broken(packFiles.contract, `environment.wrappers declares "${w}", which no tool runs`);

  // A node id is unique across the whole pack — its graph and every loop — because a node record, a
  // Job, an attempt and a run row all name a node by that id and nothing else (#28). Two graphs each
  // holding a "synthesize" would make every one of those ambiguous.
  const declaredIn = new Map<string, string>();
  for (const { loop, graph: part } of graphsOf(pack)) {
    for (const node of part.nodes) {
      const already = declaredIn.get(node.id);
      if (already !== undefined) {
        broken(packFiles.graph, `declares two nodes called "${node.id}", one in ${already} and one in ${graphSaid(loop)}: a node id is unique across a whole pack, because every record names a node by that id alone`);
      }
      declaredIn.set(node.id, graphSaid(loop));
    }
  }
  for (const { loop, graph: part } of graphsOf(pack)) {
    const ids = new Set(part.nodes.map((n) => n.id));
    if (!ids.has(part.entry)) broken(packFiles.graph, `names "${part.entry}" as the entry of ${graphSaid(loop)}, which is not one of its nodes`);
    for (const edge of part.edges) {
      for (const end of ['from', 'to'] as const) {
        const id = edge[end];
        if (ids.has(id)) continue;
        // A node that *is* declared, only somewhere else, is the one mistake worth its own sentence:
        // an edge that crosses between a graph and a loop. The only way into a loop is an Explore
        // node that opens it, and the only way out is that loop closing.
        broken(packFiles.graph, declaredIn.has(id)
          ? `has an edge in ${graphSaid(loop)} ${end} "${id}", which is a node of ${declaredIn.get(id)!}: no edge crosses between a graph and a loop, because the only way into a loop is an explore node that opens it and the only way out is that loop closing`
          : `has an edge in ${graphSaid(loop)} ${end} "${id}", which is not one of its nodes`);
      }
    }
  }
  const toolIds = new Set(contract.tools.map((t) => t.id));
  const outputNames = new Set(contract.outputs.map((o) => o.name));
  for (const { loop, graph: part } of graphsOf(pack)) {
    for (const node of part.nodes) {
      if (node.kind === 'act') {
        const { tool, observes } = node.parameters;
        if (tool !== undefined && !toolIds.has(tool)) broken(packFiles.graph, `node "${node.id}" runs tool "${tool}", which ${packFiles.contract} does not declare`);
        if (observes !== undefined && !outputNames.has(observes)) broken(packFiles.graph, `node "${node.id}" observes output "${observes}", which ${packFiles.contract} does not declare`);
        // Every argument this node takes from the Run's Strategy, held against the contract's own
        // declaration (#58), exactly as the tool and the output above are held against theirs. A
        // Strategy knob is the pack's own invention and the contract declares every one of them, so
        // the graph naming a knob the contract does not is one pack contradicting itself in two of
        // its files — which is what this function is. Unheld, such a node loads, passes
        // `/hima pack check`, prepares a 56 MB workspace and then blocks at the command line for a
        // value nothing could ever have bound.
        //
        // The Goal side cannot be held here and is not: a Goal's names come from the Run, not from
        // the pack, so an argument taken `{ from: goal }` is decided when the Run supplies one and
        // the node says which argument it could not bind.
        for (const [argument, value] of Object.entries(node.parameters.arguments)) {
          if (typeof value !== 'object' || value.from !== 'strategy') continue;
          if (Object.hasOwn(contract.strategy, value.name)) continue;
          broken(
            packFiles.graph,
            `node "${node.id}" takes argument "${argument}" from strategy knob "${value.name}", which ${packFiles.contract} does not declare; `
            + `it declares ${Object.keys(contract.strategy).map((n) => `"${n}"`).join(', ')}`,
          );
        }
      }
      if (node.kind === 'explore') validateExplore(pack, node, loop, broken);
    }
    validateEdgeLabels(part, loop, broken);
    validateLoopShape(part, loop, broken);
    validateForkShape(part, loop, broken);
  }
  validateGenerationLimit(graph, broken);
}

/** Which graph of a pack a rule is talking about, in the words a person reads their own file in. */
const graphSaid = (loop: string | undefined): string => (loop === undefined ? 'its graph' : `loop "${loop}"`);

/**
 * What is wrong between a chooser's clauses and the knobs a contract declares (#58), or undefined
 * when the two fit.
 *
 * Three ways they can disagree, and each of them is a decision the engine could not act on:
 *
 * - a clause sets a knob the contract does not declare, which is a value no node could ever read;
 * - a clause sets a *choice* knob to something outside its own list — including an arithmetic
 *   expression, which is not a word at all;
 * - a clause sets a *number* knob from a name this chooser cannot supply. A bare string under a
 *   number knob is arithmetic, so a chooser's typo lands here rather than at its own load, where
 *   nothing knows whether it was meant as a read or as a word.
 *
 * @param chooser - the chooser the Explore node names, loaded.
 * @param declaration - the contract's `strategy:` block.
 * @returns the fault as a clause of a sentence about that chooser, or undefined.
 */
function chooserKnobIssue(chooser: Chooser, declaration: Readonly<Record<string, StrategyKnob>>): string | undefined {
  const supplies = new Set([...Object.keys(chooser.reads), ...(chooser.parameter ? [chooser.parameter.name] : [])]);
  const declared = Object.keys(declaration);
  for (const [at, clause] of chooser.decide.entries()) {
    for (const [name, next] of Object.entries(clause.next ?? {})) {
      const knob = declaration[name];
      if (knob === undefined) {
        return `sets knob "${name}" in clause ${String(at + 1)}, which ${packFiles.contract} does not declare; it declares ${declared.map((n) => `"${n}"`).join(', ')}`;
      }
      if (knob.type === 'choice') {
        if (typeof next !== 'string' || !knob.options.includes(next)) {
          return `sets the choice knob "${name}" in clause ${String(at + 1)} to ${JSON.stringify(next)}, which is not one of ${knob.options.map((o) => `"${o}"`).join(', ')}`;
        }
        continue;
      }
      const unknown = namesIn(next).find((referenced) => !supplies.has(referenced));
      if (unknown !== undefined) {
        return `sets the number knob "${name}" in clause ${String(at + 1)} from "${unknown}", which is neither one of its reads nor its parameter`;
      }
    }
  }
  return undefined;
}

/**
 * What an Explore node may be (#28): the one that applies a chooser and decides, or the one that
 * opens a Loop of its own and drills down. Exactly one of the two, and drill-down goes one level.
 *
 * Held here rather than in the schema so that a pack naming both meets its author as a sentence
 * about their graph, in the words every other way a pack can contradict itself is said in, rather
 * than as a parse error naming a union branch.
 */
function validateExplore(pack: Pack, node: Extract<PackNode, { kind: 'explore' }>, loop: string | undefined, broken: (file: string, why: string) => never): void {
  const { chooser, opens } = node.parameters;
  const oneOfTwo = 'an explore node either applies a chooser and decides, or opens a loop and drills down, and states exactly one of the two';
  if (chooser !== undefined && opens !== undefined) {
    broken(packFiles.graph, `gives explore node "${node.id}" both chooser "${chooser}" and \`opens: ${opens}\`: ${oneOfTwo}`);
  }
  if (chooser === undefined && opens === undefined) {
    broken(packFiles.graph, `gives explore node "${node.id}" neither a chooser nor a loop to open: ${oneOfTwo}`);
  }
  if (opens === undefined) return;
  if (loop !== undefined) {
    broken(packFiles.graph, `has explore node "${node.id}" of loop "${loop}" open loop "${opens}": a loop's explore node applies a chooser, because drill-down goes one level and no further`);
  }
  if (!Object.hasOwn(pack.graph.loops, opens)) {
    broken(packFiles.graph, `has explore node "${node.id}" open loop "${opens}", which it does not declare under \`loops:\``);
  }
}

/**
 * What an edge may be labelled with, and by what (#28): a judge node's edges carry the verdict
 * outcome they are taken on, an Explore node that opens a Loop carries the outcome that Loop closed
 * with, and nothing else carries a label at all.
 *
 * A label the engine never matches on is a route a person would read in the file and the Run would
 * never take, which is the whole reason a graph is data. The rule runs in both directions, because
 * an edge the engine never matches is unreadable whichever half is missing:
 *
 * - a label on a node whose outcomes nothing branches on, or a label that is not one of that node's
 *   own outcomes, is an edge nothing takes;
 * - an edge out of an Explore node that opens a Loop carrying *no* label is the same edge from the
 *   other side. That node is left on the edge its Loop's outcome names and on no other, so an
 *   unlabelled one — a `revisit: true` among them — is a route the file shows and the Run cannot
 *   take, and the Run ends as though the node drew no edge at all;
 * - and two edges out of one node carrying the same label are a fork the engine resolves by taking
 *   the first that matches, which makes the order the lines happen to be written in decide where a
 *   Run goes.
 */
function validateEdgeLabels(part: RunGraph, loop: string | undefined, broken: (file: string, why: string) => never): void {
  const kindOf = new Map(part.nodes.map((n) => [n.id, n.kind]));
  const opensALoop = new Set(part.nodes.flatMap((n) => (n.kind === 'explore' && n.parameters.opens !== undefined ? [n.id] : [])));
  const allowed = (id: string): readonly string[] | undefined => {
    if (kindOf.get(id) === 'judge') return verdictOutcome.options;
    return opensALoop.has(id) ? loopOutcome.options : undefined;
  };
  const said = (options: readonly string[]): string => options.map((o) => `"${o}"`).join(', ');
  /** Where each label out of each node already leads, so a second edge saying the same thing is met
   *  with the first one rather than silently shadowed by it. Keyed by the node and the label with a
   *  space between them, which no pair of them can collide over: an outcome holds no space, so the
   *  label is whatever follows the last one and the node is the rest. */
  const leadsTo = new Map<string, string>();
  for (const edge of part.edges) {
    if (opensALoop.has(edge.from)) {
      if (edge.revisit === true) {
        broken(packFiles.graph, `gives explore node "${edge.from}" in ${graphSaid(loop)} a revisit edge to "${edge.to}": an explore node that opens a loop revisits nothing itself — the loop it opens carries its own revisit edge, and this node is left on the edge that loop's outcome labels`);
      }
      if (edge.outcome === undefined) {
        broken(packFiles.graph, `draws an edge in ${graphSaid(loop)} from explore node "${edge.from}" to "${edge.to}" with no outcome on it: that node opens a loop and is left on the edge its loop closed with, so every edge out of it carries one of ${said(loopOutcome.options)}`);
      }
    }
    if (edge.outcome === undefined) continue;
    const may = allowed(edge.from);
    if (may === undefined) {
      broken(packFiles.graph, `labels the edge in ${graphSaid(loop)} from "${edge.from}" with "${edge.outcome}", and that is a ${kindOf.get(edge.from) ?? 'missing'} node: only a judge node's edges carry a verdict outcome, and only an explore node that opens a loop carries the outcome that loop closed with`);
    }
    if (!may.includes(edge.outcome)) {
      broken(packFiles.graph, `labels the edge in ${graphSaid(loop)} from "${edge.from}" with "${edge.outcome}", which is not one of ${said(may)}`);
    }
    const already = leadsTo.get(`${edge.from} ${edge.outcome}`);
    if (already !== undefined) {
      broken(packFiles.graph, `draws two edges in ${graphSaid(loop)} out of "${edge.from}" labelled "${edge.outcome}", to "${already}" and to "${edge.to}": one outcome leads one way, because the engine takes the first edge that matches and a fork the line order decides is a route nobody can read off the file`);
    }
    leadsTo.set(`${edge.from} ${edge.outcome}`, edge.to);
  }
}

/**
 * What a Loop may look like in one graph (D43), checked at load so a pack whose Loop cannot be
 * executed is refused where a person can still read the file rather than after a licence-minute of
 * synthesis. Applied to the pack's own graph and to each of its drill-down loops alike, because each
 * of them is a graph HimaFabric runs and each may declare a Loop of its own (#28).
 *
 * Three rules, and they are the same rule from three sides: a Loop is one revisit edge from one
 * Explore node back into the act nodes it wants run again.
 *
 * - A revisit edge leaves an Explore node and enters an act node. Anywhere else it would mean
 *   re-judging or re-waiting, neither of which opens a Generation.
 * - With the revisit edges taken out, nothing cycles. That is what makes a revisit edge readable:
 *   every other way back is a loop the engine would run and `graph.yml` would not show.
 * - An Explore node that applies a chooser has at most one outgoing edge. Its decision chooses a
 *   Strategy or ends the Run; it labels no outcome, so a second edge is a fork nothing could choose
 *   between. An Explore node that *opens* a loop is the exception and has one edge per outcome that
 *   loop can close with, which `validateEdgeLabels` holds.
 *
 * And one rule about where a graph's Runs wait, which belongs here because it is the same kind of
 * fact: a graph declares at most one Wait node. Nothing draws an edge to a Wait node — the engine
 * routes a Hard blocker and an unlabelled UNDETERMINED there — so a graph declaring two says
 * nothing about which of them a person is sent to, and the engine would answer by the order the
 * nodes happen to be written in.
 */
function validateLoopShape(part: RunGraph, loop: string | undefined, broken: (file: string, why: string) => never): void {
  const kindOf = new Map(part.nodes.map((n) => [n.id, n.kind]));
  const waits = part.nodes.filter((n) => n.kind === 'wait');
  if (waits.length > 1) {
    broken(packFiles.graph, `declares ${String(waits.length)} wait nodes in ${graphSaid(loop)}, ${waits.map((n) => `"${n.id}"`).join(' and ')}: a graph declares at most one, because nothing draws an edge to a wait node and which one a run is sent to would be the order they are written in`);
  }
  for (const edge of part.edges) {
    if (edge.revisit !== true) continue;
    if (kindOf.get(edge.from) !== 'explore') {
      broken(packFiles.graph, `has a revisit edge from "${edge.from}", which is a ${kindOf.get(edge.from) ?? 'missing'} node: a revisit edge leaves an explore node`);
    }
    if (kindOf.get(edge.to) !== 'act') {
      broken(packFiles.graph, `has a revisit edge to "${edge.to}", which is a ${kindOf.get(edge.to) ?? 'missing'} node: a revisit edge leads to an act node, which is what the next generation runs`);
    }
  }
  for (const node of part.nodes) {
    if (node.kind !== 'explore' || node.parameters.opens !== undefined) continue;
    const out = part.edges.filter((e) => e.from === node.id);
    if (out.length > 1) {
      broken(packFiles.graph, `gives explore node "${node.id}" ${String(out.length)} outgoing edges, to ${out.map((e) => `"${e.to}"`).join(' and ')}: an explore node has at most one, because its decision chooses a strategy or ends the run and labels no outcome to branch on`);
    }
  }
  // Everything reachable from the entry, following every edge that is not a revisit. A node found
  // twice on one path is a cycle no revisit edge declared, so the graph says one thing and would do
  // another.
  const ordinary = part.edges.filter((e) => e.revisit !== true);
  const settled = new Set<string>();
  const walk = (nodeId: string, path: readonly string[]): void => {
    if (path.includes(nodeId)) {
      const cycle = [...path.slice(path.indexOf(nodeId)), nodeId].map((n) => `"${n}"`).join(' → ');
      const where = loop === undefined ? '' : ` in ${graphSaid(loop)}`;
      broken(packFiles.graph, `cycles${where} through ${cycle} without a revisit edge: a loop is declared with \`revisit: true\` on the edge that closes it, and nowhere else`);
    }
    if (settled.has(nodeId)) return;
    for (const edge of ordinary) if (edge.from === nodeId) walk(edge.to, [...path, nodeId]);
    settled.add(nodeId);
  };
  walk(part.entry, []);
}

/**
 * One branch of a fork as the graph draws it: the id it is known by, which is the id of its first
 * node, and the chain of act nodes it runs from there to the join.
 */
export interface ForkBranch {
  readonly id: string;
  readonly nodes: readonly string[];
}

/**
 * The fork one node draws, read off the edges (D29): where it branched, the judge node every branch
 * converges into, and the branches themselves — or, for a graph that draws something a fork cannot
 * be made of, why not.
 */
export type Fork =
  | { readonly ok: true; readonly from: string; readonly join: string; readonly branches: readonly ForkBranch[] }
  | { readonly ok: false; readonly why: string };

/**
 * **What a fork is, stated once** (D29, CONTEXT.md *Fork and join*): edges and not a node kind.
 *
 * An act node with two or more unlabelled outgoing edges branches. Each branch is the chain of act
 * nodes from that edge's target on, following the one edge out of each, until the first node with
 * two or more incoming edges — which is the join, and which must be a judge node, because that is
 * where branches converge and judging all of them is the only thing that can be done with several
 * answers at once. Every branch of one fork reaches the same join.
 *
 * Only an act node forks, and that is the whole of the widening this rule makes to the graph: an act
 * node's edge out was always the unlabelled "and then", and now there may be several of them. A
 * judge node is left along the edge its first rule's outcome labels, an explore node along the one
 * its decision allows, and a wait node when a person clears it — none of those has an unlabelled
 * "and then" to draw twice.
 *
 * Read here, in one place, by the validator that refuses a fork a Run could not be driven through
 * and by the driver that opens one, so the shape a person is refused for is exactly the shape the
 * engine would have run.
 *
 * @param graph - the graph this node belongs to; a Loop is a graph of its own.
 * @param node - the node that may draw a fork.
 * @returns the fork, why what it draws is not one, or undefined when it draws no fork at all.
 */
export function forkFrom(graph: RunGraph, node: PackNode): Fork | undefined {
  const out = graph.edges.filter((e) => e.from === node.id && e.outcome === undefined);
  if (out.length < 2 || node.kind !== 'act') return undefined;
  const kindOf = new Map(graph.nodes.map((n) => [n.id, n.kind]));
  const incoming = new Map<string, number>();
  for (const edge of graph.edges) incoming.set(edge.to, (incoming.get(edge.to) ?? 0) + 1);
  const branches: ForkBranch[] = [];
  let join: string | undefined;
  for (const edge of out) {
    const nodes: string[] = [];
    let at = edge.to;
    for (;;) {
      if ((incoming.get(at) ?? 0) >= 2) break;
      const kind = kindOf.get(at);
      if (kind === undefined) return { ok: false, why: `branches to "${at}", which is not one of its nodes` };
      if (kind !== 'act') {
        return { ok: false, why: `has a ${kind} node, "${at}", inside the branch it forks to "${edge.to}": a branch is act nodes only, because a fork is judged where its branches converge and nowhere else` };
      }
      nodes.push(at);
      const on = graph.edges.filter((e) => e.from === at);
      if (on.length === 0) return { ok: false, why: `forks to "${edge.to}", whose branch ends at "${at}" with no edge out: every branch of a fork reaches the join, because the run waits for all of them` };
      if (on.length > 1) return { ok: false, why: `forks again at "${at}", inside the branch it forks to "${edge.to}": a fork holds no fork, because a branch is one chain of act nodes` };
      at = on[0]!.to;
      if (nodes.length > graph.nodes.length) return { ok: false, why: `has a branch from "${edge.to}" that never reaches a join` };
    }
    if (nodes.length === 0) return { ok: false, why: `forks straight to "${at}", which every branch converges into: a branch with nothing in it is an edge that does nothing` };
    if (kindOf.get(at) !== 'judge') {
      return { ok: false, why: `has the branches of the fork at "${node.id}" converge into "${at}", which is a ${kindOf.get(at) ?? 'missing'} node: branches converge into a judge node, because judging all of them together is what a join is` };
    }
    if (join !== undefined && join !== at) {
      return { ok: false, why: `has the branches of the fork at "${node.id}" converge into two different nodes, "${join}" and "${at}": every branch of one fork reaches one join, because the run waits for all of them at it` };
    }
    join = at;
    branches.push({ id: edge.to, nodes });
  }
  return { ok: true, from: node.id, join: join!, branches };
}

/**
 * The fork whose branches converge into this node, when one does: what makes a judge node a join.
 *
 * Asked of the graph and never of the run row, so it is the same answer before a fork opens, while
 * it is open, and after it has closed — which is what lets the join be judged as the join by a host
 * that picked the Run up between the fork closing and the judging.
 *
 * @param graph - the graph this node belongs to.
 * @param nodeId - the node that may be a join.
 * @returns the fork that converges here, or undefined when nothing forks into this node.
 */
export function forkJoinedAt(graph: RunGraph, nodeId: string): Extract<Fork, { ok: true }> | undefined {
  for (const node of graph.nodes) {
    const fork = forkFrom(graph, node);
    if (fork !== undefined && fork.ok && fork.join === nodeId) return fork;
  }
  return undefined;
}

/**
 * **What a fork concludes, stated once**: the one outcome a join settles on, over what each of its
 * branches was judged to be.
 *
 * PASS only when every branch passed — a fork is one question asked several ways, and an answer that
 * held for one branch and not another has not held. UNDETERMINED whenever any branch is, because a
 * rule that could not be applied to one branch leaves the whole question unanswered and this harness
 * never folds that into a PASS or a FAIL (D6). Otherwise FAIL.
 *
 * Read over the **first** rule's verdict per branch, which is the constraint the pack chose to
 * branch on, exactly as a judge node that judged one reading is (`judgeNode`). It is the outcome the
 * join's own edge is labelled with, so it is stated here beside what a fork is and pointed at from
 * `edgeFrom`, which is what takes that edge.
 *
 * @param outcomes - what each branch's first rule concluded, one per branch.
 * @returns the outcome the join settles on.
 */
export function forkOutcome(outcomes: readonly VerdictOutcome[]): VerdictOutcome {
  if (outcomes.some((o) => o === 'UNDETERMINED')) return 'UNDETERMINED';
  return outcomes.every((o) => o === 'PASS') ? 'PASS' : 'FAIL';
}

/**
 * What a fork may look like in one graph (D29), checked at load so a pack whose fork cannot be
 * executed is refused where a person can still read the file.
 *
 * The rules are `forkFrom`'s, said in the words a person reads their own file in, plus the two that
 * are about where a fork may be rather than about what it is. **Not inside a drill-down Loop and not
 * inside another fork**, because step 3 runs one level of each (spec, *Out of Scope*): a fork inside
 * a fork is refused by the walk itself, which finds the second fork's node drawing two edges inside
 * a branch; a fork inside a Loop is refused here, where the graph being walked knows it is a Loop.
 * And **nothing a fork's join leads to explores**, for the reason `exploreAfter` states.
 *
 * The act node's own rule is the same rule from the other side, and it is why every act node is
 * asked and not only the ones that look like a fork: an act node has **one** unlabelled edge out, or
 * it has a fork. Two edges that are not a fork the engine could drive would otherwise load as a
 * route a person would read and the Run would take the first line of.
 */
function validateForkShape(part: RunGraph, loop: string | undefined, broken: (file: string, why: string) => never): void {
  for (const node of part.nodes) {
    if (node.kind !== 'act') continue;
    const out = part.edges.filter((e) => e.from === node.id);
    if (out.length <= 1) continue;
    if (loop !== undefined) {
      broken(packFiles.graph, `forks at "${node.id}" in ${graphSaid(loop)}: a loop's graph holds no fork, because drill-down and fork each go one level in step 3 and neither is nested in the other`);
    }
    const fork = forkFrom(part, node);
    if (fork === undefined) {
      broken(packFiles.graph, `gives act node "${node.id}" in ${graphSaid(loop)} ${String(out.length)} outgoing edges, to ${out.map((e) => `"${e.to}"`).join(' and ')}, and they are not a fork: an act node has one unlabelled edge out, or several that fork to act nodes and converge into one judge node`);
    }
    // `why` is already a whole sentence about this file, in the words every other way a pack can
    // contradict itself is refused in; a fork inside a Loop is the one case above, and there is no
    // other graph one of these can be about.
    if (!fork.ok) broken(packFiles.graph, fork.why);
    const explores = exploreAfter(part, fork.join);
    if (explores !== undefined) {
      // No `graphSaid` here, unlike every refusal above: a fork inside a loop was refused a few
      // lines up, so the graph this can be about is always the pack's own.
      broken(packFiles.graph, `has explore node "${explores}" downstream of "${fork.join}", the join of the fork at "${node.id}": an explore node weighs one reading of its loop's latest generation, and a fork writes one reading per branch, so a chooser standing after a join would choose from whichever branch happened to append last`);
    }
  }
}

/**
 * The first explore node a fork's join leads to, when it leads to one at all.
 *
 * Refused at load in step 3, and this is the whole of the reason: a chooser is handed the
 * generation's *own* reading — `exploreNode` narrows the observation and the verdicts it weighs by
 * the Loop it is in and by nothing else — while a fork leaves one reading per branch in that same
 * generation. A chooser standing after a join would therefore decide on whichever branch appended
 * last, which is the site's job scheduling and not the pack's rule, and the decision record would
 * cite a value no person could have predicted from the file. What a fork's several answers mean is
 * a question the pack has not been given a way to answer yet; until it has, the graph may not ask
 * it. Refused where the file can still be read, like every other way a pack contradicts itself.
 *
 * Every node reachable from the join is walked, not only its immediate successors: the explore node
 * two act nodes past the join reads exactly the same branch observations as one drawn straight off
 * it. A revisit edge closes a cycle, so nodes already seen are not walked again.
 *
 * @param graph - the graph the fork belongs to; a Loop is a graph of its own.
 * @param join - the judge node the fork's branches converge into.
 * @returns the id of an explore node the join leads to, or undefined when it leads to none.
 */
function exploreAfter(graph: RunGraph, join: string): string | undefined {
  const kindOf = new Map(graph.nodes.map((n) => [n.id, n.kind]));
  const seen = new Set<string>([join]);
  const walking = [join];
  for (let at = walking.pop(); at !== undefined; at = walking.pop()) {
    for (const edge of graph.edges.filter((e) => e.from === at)) {
      if (seen.has(edge.to)) continue;
      seen.add(edge.to);
      if (kindOf.get(edge.to) === 'explore') return edge.to;
      walking.push(edge.to);
    }
  }
  return undefined;
}

/**
 * One Run, one Budget: the generation limit a Campaign is held to is a single number, and the pack's
 * own graph is where a pack states its default for it.
 *
 * The pack's own graph and no loop's, because a drill-down loop's `converge.generationLimit` bounds
 * that loop and nothing else — it is read off the Explore node whose decision would open the next
 * inner generation, so two Explore nodes in one loop naming two numbers each bound their own
 * decision and neither is ignored. The Budget's is the one number a whole Run is held to, and a
 * graph stating two of those would have the engine choosing which Campaign it is running.
 */
function validateGenerationLimit(graph: PackGraph, broken: (file: string, why: string) => never): void {
  const limits = new Map<number, string>();
  for (const node of graph.nodes) {
    if (node.kind !== 'explore' || node.parameters.converge === undefined) continue;
    limits.set(node.parameters.converge.generationLimit, node.id);
  }
  if (limits.size > 1) {
    const said = [...limits].map(([limit, id]) => `${String(limit)} on explore node "${id}"`).join(', ');
    broken(packFiles.graph, `declares ${String(limits.size)} different generation limits — ${said} — where a campaign has one budget: every explore node that declares \`converge\` states the same \`generationLimit\`, which is the number the whole run is held to`);
  }
}

// ---------------------------------------------------------------------------------------------
// The check: can this Site host this pack?
// ---------------------------------------------------------------------------------------------

export interface InputCheck { readonly name: string; readonly bound: string | undefined; readonly error: string | undefined }
export interface ToolCheck { readonly id: string; readonly file: string; readonly wrapper: string; readonly error: string | undefined }
export interface RuleCheck { readonly ref: string; readonly resolved: string | undefined; readonly error: string | undefined }
export interface ReaderCheck { readonly id: string; readonly output: string; readonly resolved: string | undefined; readonly error: string | undefined }
export interface ChooserCheck { readonly ref: string; readonly node: string; readonly resolved: string | undefined; readonly error: string | undefined }
/** One licence one of the pack's tools holds, held against what the Site declares of it. */
export interface LicenceCheck {
  readonly name: string;
  /** The tool that holds it. */
  readonly tool: string;
  /** How many seats a Job of that tool holds. */
  readonly held: number;
  /** How many the Site declares, or undefined for a licence the Site does not declare at all. */
  readonly declared: number | undefined;
  readonly error: string | undefined;
}

/**
 * Everything `/hima pack check` found, as data. `errors` is every one of the errors below it in the
 * order they were found, so a caller can report the whole picture and still answer the one question
 * a person asked: may this Campaign start?
 */
export interface PackCheck {
  readonly packId: string;
  readonly packVersion: string;
  readonly siteName: string;
  readonly inputs: readonly InputCheck[];
  readonly tools: readonly ToolCheck[];
  readonly rules: readonly RuleCheck[];
  readonly readers: readonly ReaderCheck[];
  readonly choosers: readonly ChooserCheck[];
  readonly licences: readonly LicenceCheck[];
  readonly errors: readonly string[];
  readonly fit: boolean;
}

/**
 * Hold a pack against a Site: every input bound, every tool's first word a wrapper the Permit
 * allows, every rule, reader and chooser resolvable, every chooser's parameter bound by the node
 * that names it, and every licence a tool holds declared by the Site in at least that number.
 *
 * Nothing here touches the Site. Every one of those answers is in files this machine already holds —
 * the site file, its permit, the shipped rules and choosers, the reader registry — so a check can be
 * run before a Site is reachable, and running one costs a customer's machine nothing. That is what
 * makes this the right place for all of them: a pack that cannot be executed is said so before a
 * Campaign exists, rather than after a workspace, a licence and two and a half minutes of synthesis.
 */
export function checkPack(pack: Pack, site: Site): PackCheck {
  const errors: string[] = [];
  const fail = <T>(entry: T, message: string): T => { errors.push(message); return entry; };

  const inputs: InputCheck[] = pack.contract.inputs.map((input) => {
    const bound = site.bindings[input.name];
    if (bound === undefined || bound === '') {
      return fail(
        { name: input.name, bound: undefined, error: `input "${input.name}" is not bound by site ${site.name}` },
        `input "${input.name}" is not bound by site ${site.name}: add it under bindings: in ${site.file}`,
      );
    }
    return { name: input.name, bound, error: undefined };
  });

  const tools: ToolCheck[] = pack.contract.tools.map((tool) => {
    const wrapper = tool.argv[0]!;
    const head = { id: tool.id, file: tool.file, wrapper };
    return permitsWrapper(site, wrapper)
      ? { ...head, error: undefined }
      : fail({ ...head, error: refusedWrapper(site, wrapper) }, `tool "${tool.id}": ${refusedWrapper(site, wrapper)}`);
  });

  // Every rule the pack references, wherever it references it: the contract's own summary list and
  // whatever each judge node applies. A rule named in only one of the two is still resolved here,
  // because a pack that references a rule which does not exist is unfit either way.
  const ruleRefs = [...new Set([...pack.contract.rules, ...pack.graph.nodes.flatMap((n) => (n.kind === 'judge' ? n.parameters.rules : []))])];
  const rules: RuleCheck[] = ruleRefs.map((ref) => {
    try {
      const rule = loadRule(ref);
      return { ref, resolved: `${rule.id}@${rule.version}`, error: undefined };
    } catch (err) {
      return fail({ ref, resolved: undefined, error: (err as Error).message }, (err as Error).message);
    }
  });

  const readers: ReaderCheck[] = pack.contract.outputs
    .filter((o) => o.reader !== undefined)
    .map((output) => {
      const id = output.reader!;
      const reader = readerNamed(id);
      if (!reader) {
        const message = `unknown reader "${id}", named by output "${output.name}": no HimaGadget reader of that id ships with this harness`;
        return fail({ id, output: output.name, resolved: undefined, error: message }, message);
      }
      return { id, output: output.name, resolved: `${reader.id}@${reader.version}`, error: undefined };
    });

  // Every chooser an Explore node names, resolved the way its rules are, and the parameter each one
  // declares held against what the node bound. A guard band nobody bound, or a negative one, inverts
  // what a guard band is for — and finding that out here costs nothing, where finding it out at the
  // Explore node costs a workspace, a licence and two and a half minutes of Design Compiler.
  //
  // Every graph the pack holds, its drill-down loops included: a loop's Explore node names a chooser
  // exactly as the graph's own does, and a Campaign that could not run one of its loops is as unfit
  // as one that could not run its graph. An Explore node that *opens* a loop names no chooser and is
  // not one of these — what it drills into is checked when the pack is loaded.
  const choosers: ChooserCheck[] = graphsOf(pack)
    .flatMap(({ graph }) => graph.nodes)
    .flatMap((n) => (n.kind === 'explore' && n.parameters.chooser !== undefined ? [{ node: n, ref: n.parameters.chooser }] : []))
    .map(({ node, ref }) => {
      const { bind, converge } = node.parameters;
      const head = { ref, node: node.id };
      let chooser;
      try {
        chooser = loadChooser(ref);
      } catch (err) {
        return fail({ ...head, resolved: undefined, error: (err as Error).message }, `node "${node.id}": ${(err as Error).message}`);
      }
      const resolved = `${chooser.id}@${chooser.version}`;
      const declared = chooser.parameter;
      if (declared) {
        const bound = bind[declared.name];
        if (bound === undefined) {
          const message = `chooser "${ref}" declares parameter "${declared.name}" in ${declared.unit}, and node "${node.id}" binds no value for it`;
          return fail({ ...head, resolved, error: message }, message);
        }
        if (bound < 0) {
          const message = `node "${node.id}" binds ${bound} to chooser parameter "${declared.name}", which must be zero or more`;
          return fail({ ...head, resolved, error: message }, message);
        }
      }
      for (const name of Object.keys(bind)) {
        if (name !== declared?.name) {
          const message = `node "${node.id}" binds "${name}", which chooser "${ref}" does not declare`;
          return fail({ ...head, resolved, error: message }, message);
        }
      }
      // Convergence is stated in the chooser's vocabulary (D43), so the read it names is held
      // against that chooser's own `reads` exactly as the bound parameter is held against its
      // `parameter`. A pack that converges on a value its chooser never reads is a Loop that could
      // only ever end at the generation limit, and finding that out here costs nothing.
      if (converge !== undefined && !Object.hasOwn(chooser.reads, converge.read)) {
        const message = `node "${node.id}" converges on "${converge.read}", which chooser "${ref}" does not read; it reads ${Object.keys(chooser.reads).map((r) => `"${r}"`).join(', ')}`;
        return fail({ ...head, resolved, error: message }, message);
      }
      // Every knob the chooser sets, held against the contract's own declaration (#58): the name
      // declared, and the kind matching — arithmetic over this chooser's numbers for a number knob,
      // one of its own declared words for a choice knob. Here, where a chooser and a pack are held
      // to each other, because it is the one place both files are open at once: a chooser alone
      // cannot tell a read from a word, and a contract alone does not know which chooser it named.
      const knobIssue = chooserKnobIssue(chooser, pack.contract.strategy);
      if (knobIssue !== undefined) {
        const message = `node "${node.id}" applies chooser "${ref}", which ${knobIssue}`;
        return fail({ ...head, resolved, error: message }, message);
      }
      return { ...head, resolved, error: undefined };
    });

  // Every licence one of the pack's tools holds, held against what the Site declares of it. A Site
  // that declares fewer seats than a tool holds — none at all, or the reference site's node-locked
  // zero, which says the owner reserves nothing of it — is a Site on which a Job of that tool can
  // never launch. Said here, where every other thing a Site cannot host is said, because the
  // alternative is a Run that sits in `waiting-for-slot` until its time box runs out: a slow, costly
  // way of answering a question two files already settle.
  const licences: LicenceCheck[] = pack.contract.tools.flatMap((tool) =>
    Object.entries(tool.licences).map(([name, held]) => {
      const declared = site.capacity.licences[name];
      const head = { name, tool: tool.id, held, declared };
      const refuse = (why: string): LicenceCheck =>
        fail({ ...head, error: why }, `tool "${tool.id}" holds ${held} of "${name}": ${why}`);
      if (declared === undefined) {
        return refuse(`site ${site.name} does not declare it; add it under capacity.licences: in ${site.file}`);
      }
      if (held > declared) {
        return refuse(`site ${site.name} declares ${declared} of it, so a job of this tool could never launch there`);
      }
      return { ...head, error: undefined };
    }),
  );

  // Every word the contract declares, held against the names a face could ever look it up by (#42):
  // the Goal parameters this pack binds, and the knobs a Strategy is made of. A word keyed by
  // anything else is a label nothing will ever read — a face looks each number up by the name it
  // arrives under — so a pack author's clock period would go on being shown as `target_period_ns`
  // with nothing anywhere saying why.
  //
  // Here, with the other things a pack author is told at once, rather than at load: a pack whose
  // words have drifted from its graph is still a pack that runs, and refusing to *load* it would
  // stop a Campaign over a label. `/hima pack check` is where a pack is held to what it promises.
  const usable = [...goalParametersOf(pack), ...strategyKnobsOf(pack)];
  for (const name of Object.keys(pack.contract.words)) {
    if (usable.includes(name)) continue;
    errors.push(
      `words: declares "${name}", which this pack neither takes from its goal nor sets as a strategy knob; `
      + `it uses ${usable.map((n) => `"${n}"`).join(', ')}`,
    );
  }

  // And the same rule from the other side, for the knobs (#58): a knob this contract declares and
  // says no words for is a field on the start form, a line on the card and a column of the ledger
  // that a person reads under the name the wire carries — and a knob is the pack's own invention, so
  // there is nothing else anybody could read it as. The unit goes with the kind: a number is
  // measured in what the declaration says it is measured in, and a choice is measured in nothing.
  for (const [name, knob] of Object.entries(pack.contract.strategy)) {
    const word = pack.contract.words[name];
    if (word === undefined) {
      errors.push(`words: says nothing for strategy knob "${name}", which this pack declares; a knob a person reads is a knob its pack has words for`);
      continue;
    }
    if (knob.type === 'choice') {
      if (word.unit !== undefined) {
        errors.push(`words: gives strategy knob "${name}" the unit "${word.unit}", and it is a choice of ${knob.options.map((o) => `"${o}"`).join(', ')}: a choice is measured in nothing`);
      }
      continue;
    }
    if (word.unit !== knob.unit) {
      errors.push(
        `words: gives strategy knob "${name}" ${word.unit === undefined ? 'no unit' : `the unit "${word.unit}"`}, `
        + `and its declaration states ${knob.unit}: one knob is measured in one thing`,
      );
    }
  }
  // Every other word states a unit, which is what #42 declared a word to be: a choice knob is the
  // one thing a person reads that is not a number, and everything else here is one.
  for (const [name, word] of Object.entries(pack.contract.words)) {
    if (word.unit !== undefined || pack.contract.strategy[name]?.type === 'choice') continue;
    errors.push(`words: declares "${name}" with no unit, and only a choice knob has none: a number with nothing saying what it is measured in is a number nobody can read`);
  }

  return {
    packId: pack.id,
    packVersion: pack.contract.version,
    siteName: site.name,
    inputs,
    tools,
    rules,
    readers,
    choosers,
    licences,
    errors,
    fit: errors.length === 0,
  };
}

/**
 * What this Site bound for every input the pack's contract names.
 *
 * @throws when any input is unbound. Callers reach this only past a `checkPack` that found the pack
 *         fit, so an unbound input here is a programming fault, never a Site's misconfiguration
 *         reaching a caller as an empty string.
 */
export function boundInputs(pack: Pack, site: Site): Record<string, string> {
  const bindings: Record<string, string> = {};
  for (const input of pack.contract.inputs) {
    const bound = site.bindings[input.name];
    if (bound === undefined || bound === '') throw new Error(`site ${site.name} binds no "${input.name}" for pack ${pack.id}`);
    bindings[input.name] = bound;
  }
  return bindings;
}
