import { describe, expect, it } from 'vitest';
import type { Design } from '../src/schema.ts';
import { validateDesign } from '../src/validate.ts';
import { balanced, makeLevel, singleServer } from './fixtures.ts';

const level = makeLevel();
const codes = (design: Design, onLevel = level) => validateDesign(design, onLevel).map((issue) => issue.code);

describe('validateDesign', () => {
  it('accepts a single server and a balanced pool', () => {
    expect(codes(singleServer('small'))).toEqual([]);
    expect(codes(balanced(4, 'large'))).toEqual([]);
  });

  it('requires the clients to be connected to exactly one component', () => {
    expect(codes({ nodes: singleServer('small').nodes, edges: [] })).toContain('no_entry');
    expect(
      codes({
        nodes: [
          { id: 'a', kind: 'appServer', size: 'small', instances: 1 },
          { id: 'b', kind: 'appServer', size: 'small', instances: 1 },
        ],
        edges: [
          { from: 'clients', to: 'a' },
          { from: 'clients', to: 'b' },
        ],
      }),
    ).toContain('multiple_entries');
  });

  it('rejects components the level has not unlocked', () => {
    expect(codes(balanced(2, 'small'), makeLevel({ components: ['appServer'] }))).toContain('component_not_allowed');
  });

  it('requires a load balancer in front of multiple instances', () => {
    const design: Design = {
      nodes: [{ id: 'app', kind: 'appServer', size: 'small', instances: 3 }],
      edges: [{ from: 'clients', to: 'app' }],
    };
    expect(codes(design)).toEqual(['needs_load_balancer']);
  });

  it('rejects broken wiring', () => {
    const design: Design = {
      nodes: [
        { id: 'lb', kind: 'loadBalancer', healthCheckIntervalSec: 30, retryOnConnectFailure: false },
        { id: 'lb2', kind: 'loadBalancer', healthCheckIntervalSec: 30, retryOnConnectFailure: false },
        { id: 'app', kind: 'appServer', size: 'small', instances: 1 },
      ],
      edges: [
        { from: 'clients', to: 'lb' },
        { from: 'lb', to: 'lb2' },
        { from: 'lb2', to: 'lb' },
        { from: 'app', to: 'lb' },
        { from: 'lb', to: 'ghost' },
        { from: 'app', to: 'clients' },
      ],
    };
    const found = codes(design);
    expect(found).toEqual(
      expect.arrayContaining(['cycle', 'invalid_target', 'unexpected_outgoing', 'unknown_node', 'edge_into_clients']),
    );
  });

  it('rejects duplicate ids, duplicate edges and self-loops', () => {
    const design: Design = {
      nodes: [
        { id: 'app', kind: 'appServer', size: 'small', instances: 1 },
        { id: 'app', kind: 'appServer', size: 'large', instances: 1 },
      ],
      edges: [
        { from: 'clients', to: 'app' },
        { from: 'clients', to: 'app' },
        { from: 'app', to: 'app' },
      ],
    };
    expect(codes(design)).toEqual(expect.arrayContaining(['duplicate_id', 'duplicate_edge', 'self_loop']));
  });

  it('warns, without blocking, about components that receive no traffic', () => {
    const design = singleServer('small');
    design.nodes.push({ id: 'idle', kind: 'appServer', size: 'xlarge', instances: 1 });
    expect(validateDesign(design, level)).toEqual([
      expect.objectContaining({ severity: 'warning', code: 'unreachable', nodeId: 'idle' }),
    ]);
  });
});
