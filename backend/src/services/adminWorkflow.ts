export type WorkflowStatus = 'generated' | 'approved' | 'locked';

export function workflowTransitionError(
  current: WorkflowStatus,
  target: WorkflowStatus
): string | null {
  if (target === 'generated') return null;
  if (current === target) return null;
  if (target === 'approved' && current === 'generated') return null;
  if (target === 'locked' && current === 'approved') return null;
  return `Invalid workflow transition: ${current} -> ${target}`;
}

export function monthLockStatusError(status: string): string | null {
  return status === 'approved' || status === 'locked'
    ? null
    : `Puzzle must be approved before the month can be locked (current status: ${status}).`;
}
