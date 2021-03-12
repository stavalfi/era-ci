import { WorkspacesInfo } from '@era-ci/utils'
import fs from 'fs'
import path from 'path'
import { updateMainTsconfigBuildFile } from './utils'

export async function removePackages({
  graph,
  packageNamesToRemove,
  repoPath,
}: {
  graph: WorkspacesInfo
  packageNamesToRemove: string[]
  repoPath: string
}): Promise<void> {
  await Promise.all(
    packageNamesToRemove.map(packageJsonName =>
      fs.promises.rm(path.join(graph[packageJsonName].location), { recursive: true }),
    ),
  )
  const packagesToKeep = Object.keys(graph).filter(packageJsonName => !packageNamesToRemove.includes(packageJsonName))
  updateMainTsconfigBuildFile(repoPath, graph, packagesToKeep)
}
