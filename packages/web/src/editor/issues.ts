/** How validation issues are presented: ordering, canvas marks and the Run button's blocking reason. */
import type { DesignIssue } from '@five-nines/sim';
import type { NodeMark } from '../canvas/types.ts';

/** Errors first, then warnings; otherwise in the order the validator reported them. */
export function sortIssues(issues: readonly DesignIssue[]): DesignIssue[] {
  const errors = issues.filter((issue) => issue.severity === 'error');
  const warnings = issues.filter((issue) => issue.severity !== 'error');
  return [...errors, ...warnings];
}

/** One mark per offending node; an error outranks a warning on the same node. */
export function issueMarks(issues: readonly DesignIssue[]): Record<string, NodeMark> {
  const marks: Record<string, NodeMark> = {};
  for (const issue of issues) {
    if (issue.nodeId === undefined) continue;
    if (issue.severity === 'error') marks[issue.nodeId] = 'error';
    else marks[issue.nodeId] ??= 'warning';
  }
  return marks;
}

/** Why the design can't run yet: the first error's message, or null when it can. */
export function runBlocker(issues: readonly DesignIssue[]): string | null {
  return issues.find((issue) => issue.severity === 'error')?.message ?? null;
}
