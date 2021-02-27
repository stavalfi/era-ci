#! /usr/bin/env node

import { calculateArtifactsHash } from '@era-ci/artifact-hash'
import { getPackages, WorkspacesInfo } from '@era-ci/utils'
import path from 'path'
import { generateDockerfiles } from './generate-docker-files'
import { deleteAllDevDeps, updateAllTsconfigBuildFiles, updateMainTsconfigFile } from './remoev-dev-deps'
import { Actions } from './types'
import { findAllRecursiveDepsOfPackage } from './utils'

async function evaluateAction({
  action,
  graph,
  params,
  repoPath,
}: {
  repoPath: string
  graph: WorkspacesInfo
  action: Actions
  params: string[]
}): Promise<void> {
  switch (action as Actions) {
    case Actions.removeAllDevDepsNotRelatedTo: {
      const [packageName, expectDepsParam, expectDevDepsNames = ''] = params
      if (!graph[packageName]) {
        throw new Error(`3'th param must be a name of a package inside the monorepo`)
      }
      if (expectDepsParam && expectDepsParam !== '--except-deps') {
        throw new Error(`4'th param must be "--except-deps"`)
      }
      const expectDevDepsNamesArray = expectDepsParam ? expectDevDepsNames.split(',') : []

      deleteAllDevDeps(repoPath, graph, packageName, expectDevDepsNamesArray)
      updateAllTsconfigBuildFiles(repoPath, graph, packageName)
      updateMainTsconfigFile(repoPath, graph, findAllRecursiveDepsOfPackage(graph, packageName))

      break
    }
    case Actions.generateDockerfiles: {
      const [packageName] = params
      if (packageName === 'all-packages') {
        return generateDockerfiles(repoPath, graph, Object.keys(graph))
      }
      if (!graph[packageName]) {
        throw new Error(`3'th param must be a name of a package inside the monorepo`)
      }
      return generateDockerfiles(repoPath, graph, [packageName])
    }
    case Actions.calculateArtifactHash: {
      const [packageName] = params
      if (!graph[packageName]) {
        throw new Error(`3'th param must be a name of a package inside the monorepo`)
      }
      const { artifacts } = await calculateArtifactsHash({
        repoPath,
        packagesPath: Object.values(graph).map(n => path.join(repoPath, n.location)),
      })
      // eslint-disable-next-line no-console
      console.log(artifacts.find(a => a.data.artifact.packageJson.name === packageName)?.data.artifact.packageHash!)
      return
    }
    default:
      throw new Error(`Action: "${action}" is not supported. supported actions: ${Object.values(Actions)}`)
  }
}

export async function main(argv: string[], processEnv: NodeJS.ProcessEnv) {
  const [action, repoPathStr, repoPath, ...params] = argv

  if (repoPathStr !== '--repo-path') {
    throw new Error(`2'th param must be --repo-path`)
  }

  const graph = await getPackages({ repoPath, processEnv })

  await evaluateAction({
    action: action as Actions,
    repoPath,
    params,
    graph,
  })
}

if (require.main === module) {
  // eslint-disable-next-line no-process-env
  main(process.argv.slice(2), process.env)
}
