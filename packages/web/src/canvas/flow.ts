/**
 * Draft ↔ React Flow conversion. The draft is the source of truth; React Flow nodes and edges are derived from it on
 * every render, and React Flow's change events are translated back into draft intents by `DesignCanvas`.
 */
import { CLIENTS_ID, type AppServerSpec, type Edge, type LoadBalancerSpec } from '@five-nines/sim';
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

export type ClientsFlowNode = RFNode<ClientsNodeData, 'clients'>;
export type AppServerFlowNode = RFNode<AppServerNodeData, 'appServer'>;
export type LoadBalancerFlowNode = RFNode<LoadBalancerNodeData, 'loadBalancer'>;
export type DesignFlowNode = ClientsFlowNode | AppServerFlowNode | LoadBalancerFlowNode;

export type FlowEdgeData = { from: string; to: string };
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
  for (const spec of draft.design.nodes) {
    if (spec.kind === 'appServer') {
      nodes.push({ ...common(spec.id), type: 'appServer', data: { kind: 'appServer', spec } });
    } else {
      nodes.push({
        ...common(spec.id),
        type: 'loadBalancer',
        data: { kind: 'loadBalancer', spec, backendCount: balancerBackendCount(draft, spec.id) },
      });
    }
  }
  return nodes;
}

/** React Flow edges for a draft, keyed by `edgeKey`. */
export function draftToFlowEdges(draft: Draft, options: Pick<ToFlowOptions, 'selection'> = {}): DesignFlowEdge[] {
  const selected = options.selection?.kind === 'edge' ? edgeKey(options.selection.edge) : null;
  return draft.design.edges.map((edge) => {
    const id = edgeKey(edge);
    return { id, type: 'flow', source: edge.from, target: edge.to, selected: id === selected, data: { ...edge } };
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
