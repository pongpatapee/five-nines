import type { TimelineFrame } from '@five-nines/sim';
import { memo } from 'react';
import { cast, latencyAt, latencyWorthNoting } from '../theme/index.ts';

export interface LatencyNoteProps {
  timeline: readonly TimelineFrame[];
  /** Playhead, simulated seconds. */
  timeSec: number;
  requiredMs: number;
}

/**
 * The mentor's running commentary on p99 under the timeline: when p99 climbs towards or past the limit, which machine
 * was busiest at that second, and how busy. Silent while latency is fine.
 */
export const LatencyNote = memo(function LatencyNote({ timeline, timeSec, requiredMs }: LatencyNoteProps) {
  const index = Math.min(timeline.length - 1, Math.max(0, Math.floor(timeSec)));
  const frame = timeline[index];
  const situation = frame ? latencyAt(frame, requiredMs) : null;
  const noting = latencyWorthNoting(situation);
  return (
    // Not a live region: it changes every simulated second, which would drown a screen reader. The grade card's hints
    // say the same with the run's worst second.
    <p className="pb-latency-note" data-tone={noting && situation.p99Ms > requiredMs ? 'alarm' : 'note'} data-quiet={!noting}>
      {noting && (
        <>
          <b className="pb-latency-note__who">{cast.members.mentor.name}:</b> {cast.mentorLatency(situation)}
        </>
      )}
    </p>
  );
});
