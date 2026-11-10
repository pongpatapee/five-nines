import { CLIENTS_ID, COMPONENT_LABELS } from './catalog.ts';
import { topologicalOrder } from './graph.ts';
import type { Design, Edge, Level, NodeSpec } from './schema.ts';

export type IssueCode =
  | 'duplicate_id'
  | 'component_not_allowed'
  | 'unknown_node'
  | 'edge_into_clients'
  | 'self_loop'
  | 'duplicate_edge'
  | 'no_entry'
  | 'multiple_entries'
  | 'cycle'
  | 'no_targets'
  | 'invalid_target'
  | 'unexpected_outgoing'
  | 'needs_load_balancer'
  | 'unreachable';

export interface DesignIssue {
  /** Errors block the simulation; warnings don't. */
  severity: 'error' | 'warning';
  code: IssueCode;
  message: string;
  nodeId?: string;
}

/** Structural checks on a design, phrased for the player. */
export function validateDesign(design: Design, level: Level): DesignIssue[] {
  const issues: DesignIssue[] = [];
  const report = (severity: DesignIssue['severity'], code: IssueCode, message: string, nodeId?: string) =>
    issues.push(nodeId === undefined ? { severity, code, message } : { severity, code, message, nodeId });

  const byId = new Map<string, NodeSpec>();
  for (const node of design.nodes) {
    if (byId.has(node.id)) report('error', 'duplicate_id', `Two components are named "${node.id}".`, node.id);
    byId.set(node.id, node);
    if (!level.components.includes(node.kind)) {
      report('error', 'component_not_allowed', `${COMPONENT_LABELS[node.kind]} isn't available in this level.`, node.id);
    }
  }

  const edges: Edge[] = [];
  const seen = new Set<string>();
  for (const edge of design.edges) {
    const label = `${edge.from} → ${edge.to}`;
    if (edge.to === CLIENTS_ID) {
      report('error', 'edge_into_clients', `Nothing can send traffic back to the clients (${label}).`);
      continue;
    }
    if ((edge.from !== CLIENTS_ID && !byId.has(edge.from)) || !byId.has(edge.to)) {
      report('error', 'unknown_node', `The connection ${label} refers to a component that doesn't exist.`);
      continue;
    }
    if (edge.from === edge.to) {
      report('error', 'self_loop', `${edge.from} can't send traffic to itself.`, edge.from);
      continue;
    }
    const key = `${edge.from}\u0000${edge.to}`;
    if (seen.has(key)) {
      report('error', 'duplicate_edge', `${label} is connected twice.`);
      continue;
    }
    seen.add(key);
    edges.push(edge);
  }

  const entries = edges.filter((edge) => edge.from === CLIENTS_ID);
  if (entries.length === 0) {
    report('error', 'no_entry', 'Connect the clients to a component so traffic has somewhere to go.');
  } else if (entries.length > 1) {
    report(
      'error',
      'multiple_entries',
      'The clients can only send traffic to one component. Put a load balancer in front to spread it.',
    );
  }

  const internal = edges.filter((edge) => edge.from !== CLIENTS_ID);
  if (topologicalOrder([...byId.keys()], internal) === null) {
    report('error', 'cycle', 'The design has a loop: requests would travel in circles forever.');
  }

  for (const node of byId.values()) {
    const outgoing = internal.filter((edge) => edge.from === node.id);
    const incoming = edges.filter((edge) => edge.to === node.id);
    switch (node.kind) {
      case 'loadBalancer': {
        if (outgoing.length === 0) {
          report('error', 'no_targets', `${node.id} has nothing to send traffic to.`, node.id);
        }
        for (const edge of outgoing) {
          const target = byId.get(edge.to)!;
          if (target.kind !== 'appServer') {
            report(
              'error',
              'invalid_target',
              `${node.id} can only balance traffic across app servers, not ${COMPONENT_LABELS[target.kind].toLowerCase()}s.`,
              node.id,
            );
          }
        }
        break;
      }
      case 'appServer': {
        if (outgoing.length > 0) {
          report(
            'error',
            'unexpected_outgoing',
            `${node.id} can't forward traffic: app servers handle each request themselves for now.`,
            node.id,
          );
        }
        if (node.instances > 1) {
          for (const edge of incoming) {
            const sender = edge.from === CLIENTS_ID ? undefined : byId.get(edge.from);
            if (sender?.kind !== 'loadBalancer') {
              report(
                'error',
                'needs_load_balancer',
                `${node.id} has ${node.instances} instances but gets traffic straight from ${edge.from}. ` +
                  'Put a load balancer in front to spread requests across the instances.',
                node.id,
              );
            }
          }
        }
        break;
      }
    }
  }

  const entry = entries[0]?.to;
  if (entry !== undefined && entries.length === 1) {
    const reachable = new Set([entry]);
    const frontier = [entry];
    while (frontier.length > 0) {
      const id = frontier.pop()!;
      for (const edge of internal) {
        if (edge.from === id && !reachable.has(edge.to)) {
          reachable.add(edge.to);
          frontier.push(edge.to);
        }
      }
    }
    for (const id of byId.keys()) {
      if (!reachable.has(id)) {
        report('warning', 'unreachable', `${id} isn't receiving any traffic, but it still costs money.`, id);
      }
    }
  }

  return issues;
}
