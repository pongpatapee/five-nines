import type { FailureCause } from '@five-nines/sim';
import { describe, expect, it } from 'vitest';
import { describeCause } from '../src/describe.ts';

const cause: FailureCause = { nodeId: 'app', reason: 'instance_down', requests: 9000, firstAtSec: 61, lastAtSec: 120 };

describe('describeCause', () => {
  it('describes a cause over the whole run', () => {
    expect(describeCause(cause)).toBe('app: requests sent to a crashed instance (9,000 requests, from t=61s)');
  });

  it('leaves out the whole-run count when describing a moment part-way through', () => {
    expect(describeCause(cause, { count: false })).toBe('app: requests sent to a crashed instance (from t=61s)');
  });
});
