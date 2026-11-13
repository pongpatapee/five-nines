import { LEVELS, peakLoad } from '@five-nines/sim';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { ExpectedLoad, working } from '../src/editor/ExpectedLoad.tsx';

type L = (typeof LEVELS)[number];
const [level1, , level3, level4, level5] = LEVELS as unknown as [L, L, L, L, L];

describe('expected load in the inspector', () => {
  it('shows the sum behind each gauge', () => {
    const medium = peakLoad(level1, level1.antiSolutions.find((a) => a.name === 'One medium server')!.design);
    expect(working(medium.nodes.app!)).toBe('350 req/s ÷ 400 req/s per instance');
    const four = peakLoad(level3, level3.solutions[0]!.design);
    expect(working(four.nodes.app!)).toBe('1,000 req/s each (split over 5) ÷ 1,600 req/s per instance');
    expect(working(four.nodes.lb!)).toBe('5,000 req/s ÷ 100,000 req/s it can pass on');
    const cached = peakLoad(level4, level4.solutions[0]!.design);
    expect(working(cached.nodes.db!)).toMatch(/^[\d,]+ reads \+ 1,300 writes × 2.5 = [\d,]+ of 10,000 reads\/s$/);
    expect(working(cached.nodes.cache!)).toMatch(/^24,700 lookups\/s ÷ 100,000 per second · hits about \d\d% of reads/);
    const replicas = peakLoad(level5, level5.solutions[0]!.design);
    expect(working(replicas.nodes.replicas!)).toBe(
      '19,200 reads ÷ 3 = 6,400 each, + 800 writes replayed × 1.25 = 7,400 of 10,000 reads/s per replica',
    );
  });

  it('shows what the crash leaves, and says when nothing reaches a node', () => {
    const load = peakLoad(level3, level3.solutions[0]!.design);
    const html = renderToStaticMarkup(createElement(ExpectedLoad, { nodeId: 'app', load }));
    expect(html).toContain('Expected peak utilization 63%, comfortable');
    expect(html).toContain('After the busiest instance crashes');
    expect(html).toContain('Expected peak utilization 78%, busy');
    expect(html).not.toMatch(/p99 (of|will be)/);
    const missing = renderToStaticMarkup(createElement(ExpectedLoad, { nodeId: 'ghost', load }));
    expect(missing).toContain('No traffic reaches ghost yet');
  });
});
