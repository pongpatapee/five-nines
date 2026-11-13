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
  | 'unknown_shard_key'
  | 'needs_payment'
  | 'needs_provider'
  | 'multiple_providers'
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

  const databases = [...byId.values()].filter((node) => node.kind === 'database' || node.kind === 'shards');
  for (const extra of databases.slice(1)) {
    report(
      'error',
      'multiple_databases',
      `${extra.id} is a second database. All the data lives in one place: one database, or one set of shards.`,
      extra.id,
    );
  }
  const providers = [...byId.values()].filter((node) => node.kind === 'paymentProvider');
  for (const extra of providers.slice(1)) {
    report('error', 'multiple_providers', `${extra.id} is a second payment provider. There's only one, and its rate limit is shared.`, extra.id);
  }

  const hasData = level.workload.data !== undefined;
  const hasPayments = level.workload.payments !== undefined;
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
        if (!hasData && !hasPayments && outgoing.length > 0) {
          report(
            'error',
            'unexpected_outgoing',
            `${node.id} can't forward traffic: app servers handle each request themselves for now.`,
            node.id,
          );
        }
        if (hasData) checkDataAccess(node.id, targets, byId, internal, report);
        if (hasPayments) checkPaymentAccess(node.id, targets, report);
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
      case 'shards': {
        if (outgoing.length > 0) {
          report(
            'error',
            'unexpected_outgoing',
            `${node.id} only answers reads and writes; it can't send traffic on. (Each shard is its own primary.)`,
            node.id,
          );
        }
        const keys = level.workload.data?.shardKeys ?? [];
        if (!keys.some((key) => key.id === node.shardKey)) {
          report(
            'error',
            'unknown_shard_key',
            keys.length > 0
              ? `${node.id} needs a shard key: ${keys.map((key) => key.label).join(', ')}.`
              : `${node.id} has no shard key to split the data by in this level.`,
            node.id,
          );
        }
        break;
      }
      case 'queue': {
        const providerTargets = targets.filter((target) => target.kind === 'paymentProvider');
        for (const target of targets.filter((target) => target.kind !== 'paymentProvider')) {
          report(
            'error',
            'invalid_target',
            `${node.id}'s workers can only send orders to the payment provider, not to ${label(target.kind)}.`,
            node.id,
          );
        }
        if (providerTargets.length === 0) {
          report('error', 'needs_provider', `${node.id}'s workers have nowhere to charge the orders. Connect it to the payment provider.`, node.id);
        }
        break;
      }
      case 'paymentProvider': {
        if (outgoing.length > 0) {
          report('error', 'unexpected_outgoing', `${node.id} is outside your system; it can't send traffic on.`, node.id);
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

/**
 * In levels with payments, every request an app server finishes charges a payment: directly at the provider, or
 * through a queue.
 */
function checkPaymentAccess(appId: string, targets: readonly NodeSpec[], report: Report): void {
  for (const target of targets) {
    if (!PAYMENT_KINDS.includes(target.kind)) {
      report(
        'error',
        'invalid_target',
        `${appId} can only send orders to a queue or to the payment provider, not to ${label(target.kind)}.`,
        appId,
      );
    }
  }
  const routes = targets.filter((target) => PAYMENT_KINDS.includes(target.kind));
  if (routes.length === 0) {
    report(
      'error',
      'needs_payment',
      `${appId} needs to charge each order: connect it to the payment provider, or to a queue whose workers do.`,
      appId,
    );
  } else if (routes.length > 1) {
    report(
      'error',
      'duplicate_data_target',
      `${appId} charges orders two ways. Connect it to the payment provider or to a queue, not both.`,
      appId,
    );
  }
}

type Report = (severity: DesignIssue['severity'], code: IssueCode, message: string, nodeId?: string) => void;

/** "a cache", "a database", "read replicas", "an app server"… for messages. */
function label(kind: NodeSpec['kind']): string {
  const name = COMPONENT_LABELS[kind].toLowerCase();
  if (kind === 'readReplicas' || kind === 'shards') return name;
  return /^[aeiou]/.test(name) ? `an ${name}` : `a ${name}`;
}

const DATA_KINDS: readonly NodeSpec['kind'][] = ['cache', 'database', 'readReplicas', 'shards'];
const PAYMENT_KINDS: readonly NodeSpec['kind'][] = ['queue', 'paymentProvider'];

/**
 * In levels with data, every request an app server finishes reads or writes data. It needs a database (one, or a set
 * of shards), may check one cache first, and may read from one group of that database's replicas.
 */
function checkDataAccess(
  appId: string,
  targets: readonly NodeSpec[],
  byId: ReadonlyMap<string, NodeSpec>,
  edges: readonly Edge[],
  report: Report,
): void {
  for (const target of targets) {
    if (!DATA_KINDS.includes(target.kind)) {
      report(
        'error',
        'invalid_target',
        `${appId} can only send its reads and writes to a cache, a database, shards or read replicas, not to ${label(target.kind)}.`,
        appId,
      );
    }
  }
  const stores = targets.filter((target) => target.kind === 'database' || target.kind === 'shards');
  for (const kind of ['cache', 'readReplicas'] as const) {
    if (targets.filter((target) => target.kind === kind).length > 1) {
      const what = { cache: 'cache', readReplicas: 'group of read replicas' }[kind];
      report('error', 'duplicate_data_target', `${appId} is connected to more than one ${what}. Connect it to one.`, appId);
    }
  }
  if (stores.length > 1) {
    report('error', 'duplicate_data_target', `${appId} is connected to more than one database. Connect it to one.`, appId);
  }
  const database = stores[0];
  if (!database) {
    report(
      'error',
      'needs_database',
      `${appId} needs a database: every request reads or writes data, and writes go to the database. Connect ${appId} to one.`,
      appId,
    );
    return;
  }
  if (database.kind === 'shards') {
    if (targets.some((target) => target.kind === 'readReplicas')) {
      report(
        'error',
        'replica_mismatch',
        `${appId} reads from read replicas, but its data lives in ${database.id}, which is sharded. Replicas copy a single database.`,
        appId,
      );
    }
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
