import { APP_SERVER_SIZES, LOAD_BALANCER } from './catalog.ts';
import type { Design, NodeSpec } from './schema.ts';

export function nodeCostUsdPerMonth(node: NodeSpec): number {
  switch (node.kind) {
    case 'appServer':
      return APP_SERVER_SIZES[node.size].usdPerMonth * node.instances;
    case 'loadBalancer':
      return LOAD_BALANCER.usdPerMonth;
  }
}

export function designCostUsdPerMonth(design: Design): number {
  return design.nodes.reduce((sum, node) => sum + nodeCostUsdPerMonth(node), 0);
}
