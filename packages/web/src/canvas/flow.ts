/**
 * Draft ↔ React Flow conversion. The draft is the source of truth; React Flow nodes and edges are derived from it on
 * every render, and React Flow's change events are translated back into draft intents by `DesignCanvas`.
 */
import {
  CLIENTS_ID,
  type AppServerSpec,
  type BlobStorageSpec,
  type CacheSpec,
  type DatabaseSpec,
  type Edge,
  type LoadBalancerSpec,
  type NodeSpec,
  type PaymentProviderSpec,
  type QueueSpec,
  type ReadReplicasSpec,
  type ShardsSpec,
} from '@five-nines/sim';
import type { Connection, Edge as RFEdge, Node as RFNode } from '@xyflow/react';
import { balancerBackendCount, edgeKey } from './draft.ts';
import type { CanvasSelection, Draft } from './types.ts';

export type ClientsNodeData = { kind: 'clients' };
export type AppServerNodeData = { kind: 'appServer'; spec: AppServerSpec };
export type LoadBalancerNodeData = {
  kind: 'loadBalancer';
  spec: LoadBalancerSpec;
  /** Total instances behind this balancer: the "M" in "N/M in rotation". */
  backendCount: number;
};

export type CacheNodeData = { kind: 'cache'; spec: CacheSpec };
export type DatabaseNodeData = { kind: 'database'; spec: DatabaseSpec };
export type ReadReplicasNodeData = { kind: 'readReplicas'; spec: ReadReplicasSpec };
export type ShardsNodeData = { kind: 'shards'; spec: ShardsSpec };
export type QueueNodeData = { kind: 'queue'; spec: QueueSpec };
export type PaymentProviderNodeData = { kind: 'paymentProvider'; spec: PaymentProviderSpec };
export type BlobStorageNodeData = { kind: 'blobStorage'; spec: BlobStorageSpec };

export type ClientsFlowNode = RFNode<ClientsNodeData, 'clients'>;
export type AppServerFlowNode = RFNode<AppServerNodeData, 'appServer'>;
export type LoadBalancerFlowNode = RFNode<LoadBalancerNodeData, 'loadBalancer'>;
export type CacheFlowNode = RFNode<CacheNodeData, 'cache'>;
export type DatabaseFlowNode = RFNode<DatabaseNodeData, 'database'>;
export type ReadReplicasFlowNode = RFNode<ReadReplicasNodeData, 'readReplicas'>;
export type ShardsFlowNode = RFNode<ShardsNodeData, 'shards'>;
export type QueueFlowNode = RFNode<QueueNodeData, 'queue'>;
export type PaymentProviderFlowNode = RFNode<PaymentProviderNodeData, 'paymentProvider'>;
export type BlobStorageFlowNode = RFNode<BlobStorageNodeData, 'blobStorage'>;
export type DesignFlowNode =
  | ClientsFlowNode
  | AppServerFlowNode
  | LoadBalancerFlowNode
  | CacheFlowNode
  | DatabaseFlowNode
  | ReadReplicasFlowNode
  | ShardsFlowNode
  | QueueFlowNode
  | PaymentProviderFlowNode
  | BlobStorageFlowNode;

export type FlowEdgeData = {
  from: string;
  to: string;
  /** Work that leaves a queue: taken off it later by workers, not passed on as each request arrives. */
  async: boolean;
};
export type DesignFlowEdge = RFEdge<FlowEdgeData, 'flow'>;

export interface Dimensions {
  width: number;
  height: number;
}

export interface ToFlowOptions {
  selection?: CanvasSelection | null;
  /** Measured node sizes reported by React Flow, carried over so nodes don't get re-measured on every render. */
  measured?: Record<string, Dimensions>;
}

/** React Flow nodes for a draft: the clients node first, then the design's nodes in order. */
export function draftToFlowNodes(draft: Draft, options: ToFlowOptions = {}): DesignFlowNode[] {
  const selectedId = options.selection?.kind === 'node' ? options.selection.id : null;
  const common = (id: string) => {
    const measured = options.measured?.[id];
    return {
      id,
      position: draft.layout[id] ?? { x: 0, y: 0 },
      selected: id === selectedId,
      ...(measured ? { measured } : {}),
    };
  };

  const nodes: DesignFlowNode[] = [
    { ...common(CLIENTS_ID), type: 'clients', deletable: false, data: { kind: 'clients' } },
  ];
  for (const spec of draft.design.nodes) nodes.push(componentNode(spec, draft, common(spec.id)));
  return nodes;
}

/** A component's React Flow node: its type is its kind, its data the spec (plus what its node displays). */
function componentNode(
  spec: NodeSpec,
  draft: Draft,
  base: Pick<DesignFlowNode, 'id' | 'position' | 'selected' | 'measured'>,
): DesignFlowNode {
  switch (spec.kind) {
    case 'appServer':
      return { ...base, type: 'appServer', data: { kind: 'appServer', spec } };
    case 'loadBalancer':
      return {
        ...base,
        type: 'loadBalancer',
        data: { kind: 'loadBalancer', spec, backendCount: balancerBackendCount(draft, spec.id) },
      };
    case 'cache':
      return { ...base, type: 'cache', data: { kind: 'cache', spec } };
    case 'database':
      return { ...base, type: 'database', data: { kind: 'database', spec } };
    case 'readReplicas':
      return { ...base, type: 'readReplicas', data: { kind: 'readReplicas', spec } };
    case 'shards':
      return { ...base, type: 'shards', data: { kind: 'shards', spec } };
    case 'queue':
      return { ...base, type: 'queue', data: { kind: 'queue', spec } };
    case 'paymentProvider':
      return { ...base, type: 'paymentProvider', data: { kind: 'paymentProvider', spec } };
    case 'blobStorage':
      return { ...base, type: 'blobStorage', data: { kind: 'blobStorage', spec } };
  }
}

/** React Flow edges for a draft, keyed by `edgeKey`. */
export function draftToFlowEdges(draft: Draft, options: Pick<ToFlowOptions, 'selection'> = {}): DesignFlowEdge[] {
  const selected = options.selection?.kind === 'edge' ? edgeKey(options.selection.edge) : null;
  const queues = new Set(draft.design.nodes.filter((node) => node.kind === 'queue').map((node) => node.id));
  return draft.design.edges.map((edge) => {
    const id = edgeKey(edge);
    return {
      id,
      type: 'flow',
      source: edge.from,
      target: edge.to,
      selected: id === selected,
      data: { from: edge.from, to: edge.to, async: queues.has(edge.from) },
    };
  });
}

/** The design edge a React Flow edge stands for. */
export function flowEdgeToEdge(edge: Pick<RFEdge, 'source' | 'target'>): Edge {
  return { from: edge.source, to: edge.target };
}

/** The design edge a completed connection gesture asks for. */
export function connectionToEdge(connection: Pick<Connection, 'source' | 'target'>): Edge {
  return { from: connection.source, to: connection.target };
}
