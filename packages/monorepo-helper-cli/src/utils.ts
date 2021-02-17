import { execSync } from 'child_process'
import fs from 'fs'
import path from 'path'
import { PackageJson, Workspaces } from './types'

export function getGraph(repoPath: string): Workspaces {
  const result = execSync('yarn workspaces --json info', { cwd: repoPath }).toString()
  return JSON.parse(JSON.parse(result).data)
}

// return all packageJson-names which are direct/recursive dependencies of the given packageJson-name
// find only deps (not dev-deps)
export function findAllRecursiveDepsOfPackage(repoPath: string, graph: Workspaces, packageJsonName: string): string[] {
  const results: string[] = [packageJsonName]

  function find(packageJsonName1: string): void {
    const packageJson = JSON.parse(
      fs.readFileSync(path.join(repoPath, graph[packageJsonName1].location, 'package.json'), 'utf-8'),
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
