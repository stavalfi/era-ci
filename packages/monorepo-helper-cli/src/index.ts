#! /usr/bin/env node

import { generateDockerfiles } from './generate-docker-files'
import { deleteAllDevDeps, updateAllTsconfigBuildFiles, updateMainTsconfigFile } from './remove-dev-deps'
import { Actions, Workspaces } from './types'
import { findAllRecursiveDepsOfPackage, getGraph } from './utils'

async function evaluateAction({
  action,
  graph,
  params,
  repoPath,
}: {
  repoPath: string
  graph: Workspaces
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
      updateMainTsconfigFile(repoPath, graph, findAllRecursiveDepsOfPackage(repoPath, graph, packageName))

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
    default:
      throw new Error(`Action: "${action}" is not supported. supported actions: ${Object.values(Actions)}`)
  }
}

export async function main(argv: string[]) {
  const [action, repoPathStr, repoPath, ...params] = argv

  if (repoPathStr !== '--repo-path') {
    throw new Error(`2'th param must be --repo-path`)
  }

  const graph = getGraph(repoPath)

  await evaluateAction({
    action: action as Actions,
    repoPath,
    params,
    graph,
  })
}

if (require.main === module) {
  main(process.argv.slice(2))
}
