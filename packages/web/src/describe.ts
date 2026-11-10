/** Plain-language descriptions of engine output, shared by playback (postmortem) and results. */
import type { FailureCause, FailureReason } from '@five-nines/sim';
import { formatCount, formatSimTime } from './format.ts';

/** What each failure reason means, as the tail of a sentence about a node. */
export const FAILURE_REASON_TEXT: Record<FailureReason, string> = {
  overloaded: 'overloaded: more requests arrived than it could serve before they timed out',
  timeout: 'requests waited in the queue past the timeout',
  instance_down: 'requests sent to a crashed instance',
  no_healthy_backend: 'no healthy instance left in rotation',
};

/** "app: requests sent to a crashed instance (9,000 requests, from t=61s)" */
export function describeCause(cause: FailureCause): string {
  return `${cause.nodeId}: ${FAILURE_REASON_TEXT[cause.reason]} (${formatCount(cause.requests)} requests, from ${formatSimTime(cause.firstAtSec)})`;
}
