import { DependencyCycleError, InvalidScheduleInputError } from './errors';
import type { DependencyInput, TaskScheduleInput } from './types';

function insertSorted(queue: string[], taskId: string): void {
  const index = queue.findIndex((queuedId) => queuedId.localeCompare(taskId) > 0);
  if (index === -1) queue.push(taskId);
  else queue.splice(index, 0, taskId);
}

function rotateToSmallest(taskIds: string[]): string[] {
  let smallestIndex = 0;
  for (let index = 1; index < taskIds.length; index += 1) {
    if (taskIds[index].localeCompare(taskIds[smallestIndex]) < 0) smallestIndex = index;
  }
  return [...taskIds.slice(smallestIndex), ...taskIds.slice(0, smallestIndex)];
}

function extractCycle(
  remaining: Set<string>,
  predecessors: Map<string, Set<string>>,
): string[] {
  const visitedAt = new Map<string, number>();
  const path: string[] = [];
  let current = [...remaining].sort()[0];

  while (!visitedAt.has(current)) {
    visitedAt.set(current, path.length);
    path.push(current);
    const next = [...(predecessors.get(current) ?? [])]
      .filter((taskId) => remaining.has(taskId))
      .sort()[0];
    if (next === undefined) throw new Error('Unable to extract dependency cycle');
    current = next;
  }

  const cycleStart = visitedAt.get(current) ?? 0;
  const forwardCycle = path.slice(cycleStart).reverse();
  return rotateToSmallest(forwardCycle);
}

export function validateDependencies(
  tasks: TaskScheduleInput[],
  dependencies: DependencyInput[],
): void {
  const taskIds = new Set(tasks.map(({ id }) => id));
  if (dependencies.some(({ predecessorTaskId, successorTaskId }) => (
    !taskIds.has(predecessorTaskId) || !taskIds.has(successorTaskId)
  ))) {
    throw new InvalidScheduleInputError('UNKNOWN_DEPENDENCY_TASK');
  }
  const successors = new Map<string, Set<string>>();
  const predecessors = new Map<string, Set<string>>();
  const indegrees = new Map<string, number>();
  for (const taskId of taskIds) {
    successors.set(taskId, new Set());
    predecessors.set(taskId, new Set());
    indegrees.set(taskId, 0);
  }

  for (const dependency of dependencies) {
    const { predecessorTaskId, successorTaskId } = dependency;
    const outgoing = successors.get(predecessorTaskId);
    if (outgoing?.has(successorTaskId)) continue;
    outgoing?.add(successorTaskId);
    predecessors.get(successorTaskId)?.add(predecessorTaskId);
    indegrees.set(successorTaskId, (indegrees.get(successorTaskId) ?? 0) + 1);
  }

  const queue = [...taskIds]
    .filter((taskId) => indegrees.get(taskId) === 0)
    .sort();
  const processed = new Set<string>();

  while (queue.length > 0) {
    const taskId = queue.shift();
    if (taskId === undefined) break;
    processed.add(taskId);
    for (const successorId of [...(successors.get(taskId) ?? [])].sort()) {
      const nextIndegree = (indegrees.get(successorId) ?? 0) - 1;
      indegrees.set(successorId, nextIndegree);
      if (nextIndegree === 0) insertSorted(queue, successorId);
    }
  }

  if (processed.size !== taskIds.size) {
    const remaining = new Set([...taskIds].filter((taskId) => !processed.has(taskId)));
    throw new DependencyCycleError(extractCycle(remaining, predecessors));
  }
}
