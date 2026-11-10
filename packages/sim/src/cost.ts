import { APP_SERVER_SIZES, CACHE_SIZES, DATABASE_SIZES, LOAD_BALANCER } from './catalog.ts';
import type { Design, NodeSpec } from './schema.ts';

export function nodeCostUsdPerMonth(node: NodeSpec): number {
  switch (node.kind) {
    case 'appServer':
      return APP_SERVER_SIZES[node.size].usdPerMonth * node.instances;
    case 'loadBalancer':
      return LOAD_BALANCER.usdPerMonth;
    case 'cache':
      return CACHE_SIZES[node.size].usdPerMonth;
    case 'database':
      return DATABASE_SIZES[node.size].usdPerMonth;
    case 'readReplicas':
      return DATABASE_SIZES[node.size].usdPerMonth * node.count;
  }
}

export function designCostUsdPerMonth(design: Design): number {
  return design.nodes.reduce((sum, node) => sum + nodeCostUsdPerMonth(node), 0);
}
