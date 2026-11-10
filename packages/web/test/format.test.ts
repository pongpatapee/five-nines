import { describe, expect, it } from 'vitest';
import { edgeBezier, flowToContainer, containerToFlow, pointOnEdge } from '../src/canvas/geometry.ts';
import { formatAvailability, formatDuration, formatMs, formatUsdPerMonth, gradeRank } from '../src/format.ts';
import { nextTier, tierPercent } from '../src/results/grading.ts';

describe('formatting', () => {
  it('shows availability with four decimals, truncated, robust to float error', () => {
    expect(formatAvailability(0.999)).toBe('99.9000%');
    expect(formatAvailability(0.99989999)).toBe('99.9899%');
    expect(formatAvailability(1)).toBe('100.0000%');
  });

  it('formats money, durations and latency', () => {
    expect(formatUsdPerMonth(2600)).toBe('$2,600/mo');
    expect(formatDuration(180)).toBe('3 min');
    expect(formatDuration(45)).toBe('45 s');
    expect(formatMs(null)).toBe('—');
    expect(formatMs(3.14)).toBe('3.1 ms');
  });

  it('orders grades and tiers', () => {
    expect(gradeRank('fail')).toBeLessThan(gradeRank('pass'));
    expect(gradeRank('star')).toBeLessThan(gradeRank('mastered'));
    expect(nextTier('fail')).toBe('pass');
    expect(nextTier('star')).toBe('mastered');
    expect(nextTier('mastered')).toBeNull();
    expect([tierPercent('pass'), tierPercent('star'), tierPercent('mastered')]).toEqual(['99.9%', '99.99%', '99.999%']);
  });
});

describe('edge geometry', () => {
  const source = { x: 0, y: 0 };
  const target = { x: 200, y: 100 };

  it('starts at the source and ends at the target', () => {
    expect(pointOnEdge(source, target, 0)).toEqual(source);
    expect(pointOnEdge(source, target, 1)).toEqual(target);
  });

  it('leaves horizontally, like React Flow’s default edge', () => {
    const [, c1, c2] = edgeBezier(source, target);
    expect(c1).toEqual({ x: 100, y: 0 });
    expect(c2).toEqual({ x: 100, y: 100 });
    expect(pointOnEdge(source, target, 0.5)).toEqual({ x: 100, y: 50 });
  });

  it('maps between flow and container coordinates', () => {
    const viewport = { x: 40, y: -20, zoom: 2 };
    const p = flowToContainer({ x: 10, y: 10 }, viewport);
    expect(p).toEqual({ x: 60, y: 0 });
    expect(containerToFlow(p, viewport)).toEqual({ x: 10, y: 10 });
  });
});
