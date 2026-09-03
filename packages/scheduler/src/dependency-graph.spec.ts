import { describe, expect, it } from 'vitest';
import { validateDependencies } from './dependency-graph';
import { DependencyCycleError, InvalidScheduleInputError } from './errors';
import type { DependencyInput, TaskScheduleInput } from './types';

function task(id: string): TaskScheduleInput {
  return {
    id,
    projectId: 'project',
    assigneeId: 'member',
    remainingHours: 1,
    status: 'NOT_STARTED',
    manualRank: 0,
  };
}

describe('validateDependencies', () => {
  it('accepts a valid dependency chain', () => {
    const tasks = ['A', 'B', 'C'].map(task);
    const dependencies: DependencyInput[] = [
      { predecessorTaskId: 'A', successorTaskId: 'B' },
      { predecessorTaskId: 'B', successorTaskId: 'C' },
    ];

    expect(() => validateDependencies(tasks, dependencies)).not.toThrow();
  });

  it('throws the exact detected cycle in stable task order', () => {
    const tasks = ['A', 'B', 'C'].map(task);
    const dependencies: DependencyInput[] = [
      { predecessorTaskId: 'A', successorTaskId: 'B' },
      { predecessorTaskId: 'B', successorTaskId: 'C' },
      { predecessorTaskId: 'C', successorTaskId: 'A' },
    ];

    expect(() => validateDependencies(tasks, dependencies)).toThrowError(
      new DependencyCycleError(['A', 'B', 'C']),
    );
  });

  it('detects the same cycle when task and dependency inputs are reversed', () => {
    const tasks = ['A', 'B', 'C', 'D'].map(task);
    const dependencies: DependencyInput[] = [
      { predecessorTaskId: 'A', successorTaskId: 'B' },
      { predecessorTaskId: 'B', successorTaskId: 'C' },
      { predecessorTaskId: 'C', successorTaskId: 'A' },
      { predecessorTaskId: 'C', successorTaskId: 'D' },
    ];

    const validate = (orderedTasks: TaskScheduleInput[], orderedDependencies: DependencyInput[]) => {
      try {
        validateDependencies(orderedTasks, orderedDependencies);
      } catch (error) {
        return error;
      }
      throw new Error('Expected a dependency cycle');
    };

    expect(validate(tasks, dependencies)).toEqual(
      validate([...tasks].reverse(), [...dependencies].reverse()),
    );
  });

  it.each([
    { predecessorTaskId: 'missing', successorTaskId: 'A' },
    { predecessorTaskId: 'A', successorTaskId: 'missing' },
  ])('rejects an unknown dependency task: $predecessorTaskId -> $successorTaskId', (dependency) => {
    expect(() => validateDependencies([task('A')], [dependency])).toThrowError(
      new InvalidScheduleInputError('UNKNOWN_DEPENDENCY_TASK'),
    );
  });
});
