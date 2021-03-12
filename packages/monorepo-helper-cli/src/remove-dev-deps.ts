import { WorkspacesInfo } from '@era-ci/utils'
import fs from 'fs'
import path from 'path'
import { Tsconfig } from './types'
import { findAllRecursiveDepsOfPackage, updateMainTsconfigBuildFile, updatePackageTsconfigBuildFile } from './utils'

// remove packages which are devDeps from tsconfig.json/paths
export function updateMainTsconfigFile(repoPath: string, graph: WorkspacesInfo, deps: string[]): void {
  const tsconfigBuildFilePath = path.join(repoPath, 'tsconfig.json')
  const tsconfigBuild = JSON.parse(fs.readFileSync(tsconfigBuildFilePath, 'utf-8')) as Tsconfig
  tsconfigBuild.compilerOptions.paths = Object.fromEntries(
    Object.entries(tsconfigBuild.compilerOptions.paths ?? {})
      .map(([depName, value]) => {
        if (deps.includes(depName)) {
          return [depName, value]
        } else {
          return []
        }
      })
      .filter(r => r.length > 0),
  )

  fs.writeFileSync(tsconfigBuildFilePath, JSON.stringify(tsconfigBuild, null, 2))
}

export function updateAllTsconfigBuildFiles(repoPath: string, graph: WorkspacesInfo, packageJsonName: string): void {
  const deps = findAllRecursiveDepsOfPackage(graph, packageJsonName)
  updateMainTsconfigBuildFile(repoPath, graph, deps)
  for (const dep of deps) {
    updatePackageTsconfigBuildFile({ graph, packageJsonName: dep, keepDeps: findAllRecursiveDepsOfPackage(graph, dep) })
  }
}

function deleteDevDepsFromPackageJson(packageJsonPath: string, expectDevDeps: string[]) {
  const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf-8'))
  packageJson.devDependencies = Object.fromEntries(
    Object.entries(packageJson.devDependencies ?? {})
      .map(([key, value]) => {
        if (expectDevDeps.some(e => e === '@types/*') && key.includes('@types/')) {
          return [key, value]
        }
        if (expectDevDeps.includes(key)) {
          return [key, value]
        }
        return []
      })
      .filter(x => x.length > 0),
  )
  fs.writeFileSync(packageJsonPath, JSON.stringify(packageJson, null, 2), 'utf-8')
}

export function deleteAllDevDeps(
  repoPath: string,
  graph: WorkspacesInfo,
  packageJsonName: string,
  expectDevDeps: string[],
): void {
  deleteDevDepsFromPackageJson(path.join(repoPath, 'package.json'), expectDevDeps)
  const deps = findAllRecursiveDepsOfPackage(graph, packageJsonName)
  for (const dep of deps) {
    deleteDevDepsFromPackageJson(path.join(graph[dep].location, 'package.json'), expectDevDeps)
  }
}
