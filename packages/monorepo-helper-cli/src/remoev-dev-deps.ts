import fs from 'fs'
import path from 'path'
import { PackageJson, Tsconfig, TsconfigBuild, Workspaces } from './types'
import { findAllRecursiveDepsOfPackage } from './utils'

// remove packages which are devDeps from tsconfig.json/paths
export function updateMainTsconfigFile(repoPath: string, graph: Workspaces, deps: string[]): void {
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

const getPackageJson = (packageJsonPath: string): PackageJson => JSON.parse(fs.readFileSync(packageJsonPath, 'utf-8'))

// remove packages which are devDeps from tsconfig-build.json
function updatePackageTsconfigBuildFile(graph: Workspaces, packageJsonName: string, deps: string[]): void {
  const tsconfigBuildFilePath = path.join(graph[packageJsonName].location, 'tsconfig-build.json')
  const tsconfigBuild = JSON.parse(fs.readFileSync(tsconfigBuildFilePath, 'utf-8')) as TsconfigBuild
  const packageJson = getPackageJson(path.join(graph[packageJsonName].location, 'package.json'))
  const directDeps = deps.filter(dep => packageJson.dependencies?.[dep])
  tsconfigBuild.references = directDeps.map(dep => ({
    path: path.relative(graph[packageJsonName].location, path.join(graph[dep].location, 'tsconfig-build.json')),
  }))
  fs.writeFileSync(tsconfigBuildFilePath, JSON.stringify(tsconfigBuild, null, 2), 'utf-8')
}

// remove packages which are devDeps from tsconfig-build.json
function updateMainTsconfigBuildFile(repoPath: string, graph: Workspaces, deps: string[]): void {
  const tsconfigBuildFilePath = path.join(repoPath, 'tsconfig-build.json')
  const tsconfigBuild = JSON.parse(fs.readFileSync(tsconfigBuildFilePath, 'utf-8')) as TsconfigBuild
  tsconfigBuild.references = deps.map(dep => ({
    path: path.join(graph[dep].location, 'tsconfig-build.json'),
  }))
  fs.writeFileSync(tsconfigBuildFilePath, JSON.stringify(tsconfigBuild, null, 2))
}

export function updateAllTsconfigBuildFiles(repoPath: string, graph: Workspaces, packageJsonName: string): void {
  const deps = findAllRecursiveDepsOfPackage(repoPath, graph, packageJsonName)
  updateMainTsconfigBuildFile(repoPath, graph, deps)
  for (const dep of deps) {
    updatePackageTsconfigBuildFile(graph, dep, findAllRecursiveDepsOfPackage(repoPath, graph, dep))
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
  graph: Workspaces,
  packageJsonName: string,
  expectDevDeps: string[],
): void {
  deleteDevDepsFromPackageJson(path.join(repoPath, 'package.json'), expectDevDeps)
  const deps = findAllRecursiveDepsOfPackage(repoPath, graph, packageJsonName)
  for (const dep of deps) {
    deleteDevDepsFromPackageJson(path.join(repoPath, graph[dep].location, 'package.json'), expectDevDeps)
  }
}
