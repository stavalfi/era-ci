import { WorkspacesInfo } from '@era-ci/utils'
import fs from 'fs'
import path from 'path'
import { PackageJson, TsconfigBuild } from './types'

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

// remove packages which are devDeps from tsconfig-build.json
export function updateMainTsconfigBuildFile(repoPath: string, graph: WorkspacesInfo, deps: string[]): void {
  const tsconfigBuildFilePath = path.join(repoPath, 'tsconfig-build.json')
  const tsconfigBuild = JSON.parse(fs.readFileSync(tsconfigBuildFilePath, 'utf-8')) as TsconfigBuild
  tsconfigBuild.references = deps.map(dep => ({
    path: path.join(graph[dep].location, 'tsconfig-build.json'),
  }))
  fs.writeFileSync(tsconfigBuildFilePath, JSON.stringify(tsconfigBuild, null, 2))
}
