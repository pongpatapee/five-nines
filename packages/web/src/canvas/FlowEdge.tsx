import { BaseEdge, type EdgeProps } from '@xyflow/react';
import { memo, useContext, useLayoutEffect } from 'react';
import { EdgeRegistryContext } from './context.ts';
import type { DesignFlowEdge } from './flow.ts';
import { edgePath } from './geometry.ts';

/**
 * The one edge type. Draws the shared Bézier from `geometry.ts` and records its endpoints in the canvas's edge
 * registry, so the playback overlay animates along exactly what's on screen. An edge out of a queue is drawn as async
 * (`flow-edge--async`): its work leaves when a worker takes it, not when a request arrives.
 */
export const FlowEdge = memo(function FlowEdge({
  id,
  source,
  target,
  sourceX,
  sourceY,
  targetX,
  targetY,
  selected,
  markerEnd,
  data,
}: EdgeProps<DesignFlowEdge>) {
  const registry = useContext(EdgeRegistryContext);

  useLayoutEffect(() => {
    if (!registry) return;
    registry.set(id, { key: id, from: source, to: target, source: { x: sourceX, y: sourceY }, target: { x: targetX, y: targetY } });
  }, [registry, id, source, target, sourceX, sourceY, targetX, targetY]);

  useLayoutEffect(() => {
    if (!registry) return;
    return () => {
      registry.delete(id);
    };
  }, [registry, id]);

  return (
    <BaseEdge
      id={id}
      path={edgePath({ x: sourceX, y: sourceY }, { x: targetX, y: targetY })}
      className={['flow-edge', selected && 'is-selected', data?.async && 'flow-edge--async'].filter(Boolean).join(' ')}
      markerEnd={markerEnd}
      interactionWidth={18}
    />
  );
});
