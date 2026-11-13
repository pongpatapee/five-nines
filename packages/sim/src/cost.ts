import {
  APP_SERVER_SIZES,
  CACHE,
  CACHE_SIZES,
  DATABASE_SIZES,
  LOAD_BALANCER,
  PAYMENT_PROVIDER,
  QUEUE,
  QUEUE_SIZES,
} from './catalog.ts';
import type { Design, NodeSpec } from './schema.ts';

export function nodeCostUsdPerMonth(node: NodeSpec): number {
  switch (node.kind) {
    case 'appServer':
      return APP_SERVER_SIZES[node.size].usdPerMonth * node.instances;
    case 'loadBalancer':
      return LOAD_BALANCER.usdPerMonth;
    case 'cache':
      return CACHE_SIZES[node.size].usdPerMonth * (node.replicated ? CACHE.replicatedCostFactor : 1);
    case 'database':
      return DATABASE_SIZES[node.size].usdPerMonth;
    case 'readReplicas':
      return DATABASE_SIZES[node.size].usdPerMonth * node.count;
    case 'shards':
      return DATABASE_SIZES[node.size].usdPerMonth * node.count;
    case 'queue':
      return QUEUE_SIZES[node.size].usdPerMonth + QUEUE.workerUsdPerMonth * node.workers;
    case 'paymentProvider':
      return PAYMENT_PROVIDER.usdPerMonth;
  }
}

export function designCostUsdPerMonth(design: Design): number {
  return design.nodes.reduce((sum, node) => sum + nodeCostUsdPerMonth(node), 0);
}
