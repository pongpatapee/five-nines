/** Plain-language descriptions of engine output, shared by playback (postmortem) and results. */
import type { FailureCause, FailureReason } from '@five-nines/sim';
import { formatCount, formatSimTime } from './format.ts';

/** What each failure reason means, as the tail of a sentence about a node. */
export const FAILURE_REASON_TEXT: Record<FailureReason, string> = {
  overloaded: 'overloaded: more requests arrived than the load balancer can handle',
  timeout: "requests timed out waiting in its queue: it can't keep up with the traffic",
  instance_down: 'requests sent to a crashed instance',
  no_healthy_backend: 'no healthy instance left in rotation',
  stale_read: 'served stale data: reads missed a write they should have seen',
  rate_limited: 'refused calls over its rate limit',
  queue_full: 'turned orders away: the queue was full',
  deadline_missed: 'orders waited past the deadline before being charged',
};

/**
 * "app: requests sent to a crashed instance (9,000 requests, from t=61s)".
 *
 * `cause.requests` counts the whole run, so pass `{ count: false }` when describing a moment part-way through it
 * (the freeze-frame): "app: requests sent to a crashed instance (from t=61s)".
 */
export function describeCause(cause: FailureCause, { count = true }: { count?: boolean } = {}): string {
  const since = `from ${formatSimTime(cause.firstAtSec)}`;
  const detail = count ? `${formatCount(cause.requests)} requests, ${since}` : since;
  return `${cause.nodeId}: ${FAILURE_REASON_TEXT[cause.reason]} (${detail})`;
}
