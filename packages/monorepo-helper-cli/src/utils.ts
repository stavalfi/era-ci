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

const getPackageJson = (packageJsonPath: string): PackageJson => JSON.parse(fs.readFileSync(packageJsonPath, 'utf-8'))

// remove packages which are devDeps from tsconfig-build.json
export function updatePackageTsconfigBuildFile(
  options: { graph: WorkspacesInfo; packageJsonName: string } & ({ keepDeps: string[] } | { removeDeps: string[] }),
): void {
  const tsconfigBuildFilePath = path.join(options.graph[options.packageJsonName].location, 'tsconfig-build.json')
  const tsconfigBuild = JSON.parse(fs.readFileSync(tsconfigBuildFilePath, 'utf-8')) as TsconfigBuild
  const packageJson = getPackageJson(path.join(options.graph[options.packageJsonName].location, 'package.json'))

  const directDeps =
    'keepDeps' in options
      ? Object.keys(packageJson.dependencies ?? {}).filter(depName => options.keepDeps.includes(depName))
      : Object.keys(packageJson.dependencies ?? {}).filter(
          depName => options.graph[depName] && !options.removeDeps.includes(depName),
        )

  tsconfigBuild.references = directDeps.map(dep => ({
    path: path.relative(
      options.graph[options.packageJsonName].location,
      path.join(options.graph[dep].location, 'tsconfig-build.json'),
    ),
  }))
  fs.writeFileSync(tsconfigBuildFilePath, JSON.stringify(tsconfigBuild, null, 2), 'utf-8')
}
