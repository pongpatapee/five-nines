import { CLIENTS_ID } from './catalog.ts';
import type { Design, Edge, NodeSpec } from './schema.ts';

export interface Graph {
  nodes: ReadonlyMap<string, NodeSpec>;
  children: ReadonlyMap<string, readonly string[]>;
  /** The node the clients send traffic to. */
  entryId: string;
  /** Every node, parents before children, ties broken by design order. */
  order: readonly string[];
}

/** Kahn's algorithm. Returns null if the edges contain a cycle. */
export function topologicalOrder(ids: readonly string[], edges: readonly Edge[]): string[] | null {
  const indegree = new Map(ids.map((id) => [id, 0]));
  const children = new Map(ids.map((id) => [id, [] as string[]]));
  for (const { from, to } of edges) {
    children.get(from)?.push(to);
    indegree.set(to, (indegree.get(to) ?? 0) + 1);
  }
  const order: string[] = [];
  const ready = ids.filter((id) => indegree.get(id) === 0);
  while (ready.length > 0) {
    const id = ready.shift()!;
    order.push(id);
    for (const child of children.get(id) ?? []) {
      const remaining = indegree.get(child)! - 1;
      indegree.set(child, remaining);
      if (remaining === 0) ready.push(child);
    }
  }
  return order.length === ids.length ? order : null;
}

/** Builds the runtime graph of a design. The design must already have passed validation. */
export function buildGraph(design: Design): Graph {
  const nodes = new Map(design.nodes.map((node) => [node.id, node]));
  const children = new Map(design.nodes.map((node) => [node.id, [] as string[]]));
  const internal = design.edges.filter((edge) => edge.from !== CLIENTS_ID);
  for (const { from, to } of internal) children.get(from)!.push(to);

  const entryId = design.edges.find((edge) => edge.from === CLIENTS_ID)?.to;
  const order = topologicalOrder([...nodes.keys()], internal);
  if (entryId === undefined || order === null) {
    throw new Error('buildGraph needs a design that passed validateDesign.');
  }
  return { nodes, children, entryId, order };
}
