import { BaseSequencer } from 'vitest/node'
import type { WorkspaceSpec } from 'vitest/node'

/**
 * Custom test sequencer that enforces layered execution order
 * mirroring system startup: env → db → api → worker → contract → poller → lifecycle → receipt → e2e
 *
 * Property tests run first (pure logic, no infrastructure needed).
 * Files not matching any known layer are placed at the end.
 */
const layerOrder: string[] = [
  'env',
  'db',
  'api',
  'worker',
  'contract',
  'poller',
  'lifecycle',
  'receipt',
  'e2e',
]

function getLayerIndex(filepath: string): number {
  const filename = filepath.split('/').pop() ?? filepath.split('\\').pop() ?? filepath

  // Property tests run first (before infrastructure tests)
  if (filename.includes('property')) {
    return -1
  }

  for (let i = 0; i < layerOrder.length; i++) {
    if (filename.startsWith(layerOrder[i]) || filename.includes(`${layerOrder[i]}.`)) {
      return i
    }
  }

  return layerOrder.length
}

export default class ValidationSequencer extends BaseSequencer {
  async sort(files: WorkspaceSpec[]): Promise<WorkspaceSpec[]> {
    return [...files].sort((a, b) => {
      const aPath = a.moduleId
      const bPath = b.moduleId
      return getLayerIndex(aPath) - getLayerIndex(bPath)
    })
  }

  async shard(files: WorkspaceSpec[]): Promise<WorkspaceSpec[]> {
    return files
  }
}
