export interface ContinuationExecutionView {
  readonly id: string;
  readonly nodeId: string;
  readonly phase: string;
  readonly result?: { readonly kind?: string };
}

/**
 * Turn a settled-but-uncompleted execution into one explicit owner instruction.
 * Generic "continue" prose repeatedly left real exit-0 Jobs at this boundary.
 */
export function settledExecutionCompletionPrompt(
  runId: string,
  currentNode: string | undefined,
  executions: readonly ContinuationExecutionView[],
): string | undefined {
  if (!currentNode) return undefined;
  const matches = executions.filter((execution) => execution.nodeId === currentNode
    && execution.phase === 'ready' && execution.result?.kind === 'settled');
  if (matches.length !== 1) return undefined;
  const execution = matches[0]!;
  return [
    `Continue only existing Run ${runId}; do not reply with prose only.`,
    `The current ${currentNode} Job is already settled under execution ${execution.id}.`,
    'Call hima_context once for the current owner epoch and control revision, then call hima_execute action=complete on that exact executionId with a fresh requestId.',
    'Do not begin or work this node again, do not grep the context spill, and do not create another Run.',
  ].join('\n');
}
