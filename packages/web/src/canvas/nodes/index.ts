/**
 * The React Flow node component for each node type: the clients, plus one per component kind. TypeScript requires an
 * entry for every kind in the engine's `ComponentKind`.
 */
import type { ComponentKind } from '@five-nines/sim';
import type { NodeTypes } from '@xyflow/react';
import { AppServerNode } from './AppServerNode.tsx';
import { BlobStorageNode } from './BlobStorageNode.tsx';
import { CacheNode } from './CacheNode.tsx';
import { ClientsNode } from './ClientsNode.tsx';
import { DatabaseNode } from './DatabaseNode.tsx';
import { LoadBalancerNode } from './LoadBalancerNode.tsx';
import { PaymentProviderNode } from './PaymentProviderNode.tsx';
import { QueueNode } from './QueueNode.tsx';
import { ReadReplicasNode } from './ReadReplicasNode.tsx';
import { ShardsNode } from './ShardsNode.tsx';

const COMPONENT_NODES = {
  appServer: AppServerNode,
  loadBalancer: LoadBalancerNode,
  cache: CacheNode,
  database: DatabaseNode,
  readReplicas: ReadReplicasNode,
  shards: ShardsNode,
  queue: QueueNode,
  paymentProvider: PaymentProviderNode,
  blobStorage: BlobStorageNode,
} satisfies Record<ComponentKind, unknown>;

export const NODE_TYPES: NodeTypes = { clients: ClientsNode, ...COMPONENT_NODES };
