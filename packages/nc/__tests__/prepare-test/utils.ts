import execa from 'execa'
import path from 'path'
import { ToActualName } from './types'

export async function getPackages(repoPath: string): Promise<string[]> {
  const result = await execa.command('yarn workspaces --json info', {
    cwd: repoPath,
  })
  const workspacesInfo: { location: string }[] = JSON.parse(JSON.parse(result.stdout).data)
  return Object.values(workspacesInfo || {})
    .map(workspaceInfo => workspaceInfo.location)
    .map(relativePackagePath => path.join(repoPath, relativePackagePath))
}

export const getPackagePath = (repoPath: string, toActualName: ToActualName) => async (packageName: string) => {
  const packagesPath = await getPackages(repoPath)
  const packagePath = packagesPath.find(path => path.endsWith(toActualName(packageName)))
  if (!packagePath) {
    throw new Error(
      `bug: could not create repo correctly. missing folder: packages/${toActualName(packageName)} in: ${repoPath}`,
    )
  }
  return packagePath
}

export const ignore = () => {
  // ignore
}
