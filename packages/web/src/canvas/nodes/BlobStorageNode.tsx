import { nodeCostUsdPerMonth } from '@five-nines/sim';
import type { NodeProps } from '@xyflow/react';
import { memo } from 'react';
import { COMPONENTS } from '../../components/registry.ts';
import type { BlobStorageFlowNode } from '../flow.ts';
import { NodeShell } from './NodeShell.tsx';

/**
 * Blob storage. No level offers it yet, so it never runs and has no live stats; a level that does will add them here
 * (requests against the per-prefix limit, as the payment provider shows its rate limit).
 */
export const BlobStorageNode = memo(function BlobStorageNode({ id, data, selected }: NodeProps<BlobStorageFlowNode>) {
  return (
    <NodeShell
      id={id}
      kind="blobStorage"
      config={COMPONENTS.blobStorage.summary(data.spec)}
      costUsdPerMonth={nodeCostUsdPerMonth(data.spec)}
      selected={selected}
    />
  );
});
