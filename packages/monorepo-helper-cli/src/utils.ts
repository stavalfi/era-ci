import { WorkspacesInfo } from '@era-ci/utils'
import fs from 'fs'
import path from 'path'
import { PackageJson } from './types'

// return all packageJson-names which are direct/recursive dependencies of the given packageJson-name
// find only deps (not dev-deps)
export function findAllRecursiveDepsOfPackage(graph: WorkspacesInfo, packageJsonName: string): string[] {
  const results: string[] = [packageJsonName]

  function find(packageJsonName1: string): void {
    const packageJson = JSON.parse(
      fs.readFileSync(path.join(graph[packageJsonName1].location, 'package.json'), 'utf-8'),
    ) as PackageJson
    const allDeps = packageJson.dependencies ?? {}
    const allDevDepAndDepFromRepo = graph[packageJsonName1]
    for (const depName of Object.keys(allDeps)) {
      if (allDevDepAndDepFromRepo.workspaceDependencies.includes(depName)) {
        if (!results.includes(depName)) {
          results.push(depName)
          find(depName)
        }
      }
    }
  }

  find(packageJsonName)

  return results
}
