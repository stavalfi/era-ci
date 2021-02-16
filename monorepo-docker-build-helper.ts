/* eslint-disable @typescript-eslint/no-var-requires */

import fs from 'fs'
import path from 'path'
import { execSync } from 'child_process'

type Workspaces = {
  [packageJsonName: string]: {
    location: string // relative-path
    workspaceDependencies: string[] // packageJson-names
    mismatchedWorkspaceDependencies: []
  }
}

type Tsconfig = {
  compilerOptions: {
    paths: { [dep: string]: string }
  }
}

type TsconfigBuild = {
  references: { path: string }[]
}

type PackageJson = {
  name?: string
  dependencies?: { [dep: string]: string }
  devDependencies?: { [dep: string]: string }
}

enum Actions {
  removeAllDevDepsNotRelatedTo = 'remove-all-dev-deps-not-related-to',
}

function getGraph(repoPath: string): Workspaces {
  const result = execSync('yarn workspaces --json info', { cwd: repoPath }).toString()
  return JSON.parse(JSON.parse(result).data)
}

// return all packageJson-names which are direct/recursive dependencies of the given packageJson-name
function findAllRecursiveDepsOfPackage(graph: Workspaces, packageJsonName: string): string[] {
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

// remove packages which are devDeps from tsconfig.json/paths
function updateMainTsconfigFile(repoPath: string, graph: Workspaces, deps: string[]): void {
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

function updateAllTsconfigBuildFiles(repoPath: string, graph: Workspaces, packageJsonName: string): void {
  const deps = findAllRecursiveDepsOfPackage(graph, packageJsonName)
  updateMainTsconfigBuildFile(repoPath, graph, deps)
  for (const dep of deps) {
    updatePackageTsconfigBuildFile(graph, dep, findAllRecursiveDepsOfPackage(graph, dep))
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

function deleteAllDevDeps(repoPath: string, graph: Workspaces, packageJsonName: string, expectDevDeps: string[]): void {
  deleteDevDepsFromPackageJson(path.join(repoPath, 'package.json'), expectDevDeps)
  const deps = findAllRecursiveDepsOfPackage(graph, packageJsonName)
  for (const dep of deps) {
    deleteDevDepsFromPackageJson(path.join(repoPath, graph[dep].location, 'package.json'), expectDevDeps)
  }
}

async function main(argv: string[]) {
  const [action, ...params] = argv
  const repoPath = __dirname
  const graph = getGraph(repoPath)

  switch (action as Actions) {
    case Actions.removeAllDevDepsNotRelatedTo: {
      const [packageName, expectDepsParam, expectDevDepsNames = ''] = params
      if (!graph[packageName]) {
        throw new Error('first param must be a name of a package inside the monorepo')
      }
      if (expectDepsParam && expectDepsParam !== '--except-deps') {
        throw new Error('second param must be "--except-deps"')
      }
      const expectDevDepsNamesArray = expectDepsParam ? expectDevDepsNames.split(',') : []

      deleteAllDevDeps(repoPath, graph, packageName, expectDevDepsNamesArray)
      updateAllTsconfigBuildFiles(repoPath, graph, packageName)
      updateMainTsconfigFile(repoPath, graph, findAllRecursiveDepsOfPackage(graph, packageName))

      break
    }
    default:
      throw new Error(`Action: "${action}" is not supported. supported actions: ${Object.values(Actions)}`)
  }
}

if (require.main === module) {
  main(process.argv.slice(2))
}
