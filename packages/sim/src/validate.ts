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
  | 'entry_not_allowed'
  | 'needs_database'
  | 'duplicate_data_target'
  | 'needs_primary'
  | 'replica_mismatch'
  | 'multiple_databases'
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
  for (const entry of entries) {
    const kind = byId.get(entry.to)!.kind;
    if (kind !== 'appServer' && kind !== 'loadBalancer') {
      report(
        'error',
        'entry_not_allowed',
        `The clients can't talk to ${label(kind)} directly. Requests go to an app server (or a load balancer) first.`,
        entry.to,
      );
    }
  }
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

  const databases = [...byId.values()].filter((node) => node.kind === 'database');
  for (const extra of databases.slice(1)) {
    report(
      'error',
      'multiple_databases',
      `${extra.id} is a second database. One primary holds all the data here; splitting data across databases comes later.`,
      extra.id,
    );
  }

  const hasData = level.workload.data !== undefined;
  for (const node of byId.values()) {
    const outgoing = internal.filter((edge) => edge.from === node.id);
    const incoming = edges.filter((edge) => edge.to === node.id);
    const targets = outgoing.map((edge) => byId.get(edge.to)!);
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
              `${node.id} can only balance traffic across app servers, not ${label(target.kind)}.`,
              node.id,
            );
          }
        }
        break;
      }
      case 'appServer': {
        if (!hasData && outgoing.length > 0) {
          report(
            'error',
            'unexpected_outgoing',
            `${node.id} can't forward traffic: app servers handle each request themselves for now.`,
            node.id,
          );
        }
        if (hasData) checkDataAccess(node.id, targets, byId, internal, report);
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
      case 'cache': {
        if (outgoing.length > 0) {
          report(
            'error',
            'unexpected_outgoing',
            `${node.id} can't send traffic on. On a cache miss, the app server reads the database itself: connect the app server to the database too.`,
            node.id,
          );
        }
        break;
      }
      case 'database': {
        for (const target of targets) {
          if (target.kind !== 'readReplicas') {
            report(
              'error',
              'invalid_target',
              `${node.id} can only copy its data to read replicas, not to ${label(target.kind)}.`,
              node.id,
            );
          }
        }
        break;
      }
      case 'readReplicas': {
        if (outgoing.length > 0) {
          report('error', 'unexpected_outgoing', `${node.id} only answers reads; it can't send traffic on.`, node.id);
        }
        const primaries = incoming.filter((edge) => byId.get(edge.from)?.kind === 'database');
        if (primaries.length !== 1) {
          report(
            'error',
            'needs_primary',
            primaries.length === 0
              ? `${node.id} has nothing to copy. Connect the database to it, so it can replay the database's writes.`
              : `${node.id} can only copy one database.`,
            node.id,
          );
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

type Report = (severity: DesignIssue['severity'], code: IssueCode, message: string, nodeId?: string) => void;

/** "a cache", "a database", "read replicas", "an app server"… for messages. */
function label(kind: NodeSpec['kind']): string {
  const name = COMPONENT_LABELS[kind].toLowerCase();
  if (kind === 'readReplicas') return name;
  return /^[aeiou]/.test(name) ? `an ${name}` : `a ${name}`;
}

/**
 * In levels with data, every request an app server finishes reads or writes data. It needs a database, may check
 * one cache first, and may read from one group of that database's replicas.
 */
function checkDataAccess(
  appId: string,
  targets: readonly NodeSpec[],
  byId: ReadonlyMap<string, NodeSpec>,
  edges: readonly Edge[],
  report: Report,
): void {
  for (const target of targets) {
    if (target.kind === 'appServer' || target.kind === 'loadBalancer') {
      report(
        'error',
        'invalid_target',
        `${appId} can only send its reads and writes to a cache, a database or read replicas, not to ${label(target.kind)}.`,
        appId,
      );
    }
  }
  for (const kind of ['cache', 'database', 'readReplicas'] as const) {
    if (targets.filter((target) => target.kind === kind).length > 1) {
      const what = { cache: 'cache', database: 'database', readReplicas: 'group of read replicas' }[kind];
      report('error', 'duplicate_data_target', `${appId} is connected to more than one ${what}. Connect it to one.`, appId);
    }
  }
  const database = targets.find((target) => target.kind === 'database');
  if (!database) {
    report(
      'error',
      'needs_database',
      `${appId} needs a database: every request reads or writes data, and writes go to the database. Connect ${appId} to one.`,
      appId,
    );
    return;
  }
  for (const replicas of targets.filter((target) => target.kind === 'readReplicas')) {
    const copies = edges.some((edge) => edge.from === database.id && edge.to === replicas.id);
    const copiesSomething = edges.some((edge) => edge.to === replicas.id && byId.get(edge.from)?.kind === 'database');
    if (!copies && copiesSomething) {
      report(
        'error',
        'replica_mismatch',
        `${appId} reads from ${replicas.id}, but ${replicas.id} copies a different database than the one ${appId} writes to.`,
        appId,
      );
    }
  }
}
