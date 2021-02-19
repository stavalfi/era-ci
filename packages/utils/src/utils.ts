import execa from 'execa'
import fs from 'fs'
import gitRemoteOriginUrl from 'git-remote-origin-url'
import gitUrlParse from 'git-url-parse'
import _ from 'lodash'
import path from 'path'
import semver from 'semver'
import { ExecutionStatus, GitRepoInfo, PackageJson, Status, TargetType, UnionArrayValues } from './types'

export const didPassOrSkippedAsPassed = (status: Status): boolean =>
  [Status.passed, Status.skippedAsPassed].includes(status)

export function calculateCombinedStatus<StatusesArray extends Status[]>(
  statuses: StatusesArray,
): UnionArrayValues<Status, StatusesArray> {
  if (statuses.length === 0) {
    return Status.skippedAsPassed
  }

  if (statuses.includes(Status.failed)) {
    return Status.failed
  }

  if (statuses.includes(Status.passed)) {
    if (statuses.includes(Status.skippedAsFailed)) {
      return Status.failed
    } else {
      return Status.passed
    }
  } else {
    if (statuses.includes(Status.skippedAsFailed)) {
      return Status.skippedAsFailed
    } else {
      return Status.skippedAsPassed
    }
  }
}

export function calculateExecutionStatus<ExecutionStatusArray extends ExecutionStatus[]>(
  executionStatuses: ExecutionStatusArray,
): UnionArrayValues<ExecutionStatus, ExecutionStatusArray> {
  if (executionStatuses.length === 0 || executionStatuses.every(e => e === ExecutionStatus.aborted)) {
    return ExecutionStatus.aborted
  }

  if (
    executionStatuses.includes(ExecutionStatus.done) &&
    executionStatuses.every(e => e === ExecutionStatus.done || e === ExecutionStatus.aborted)
  ) {
    return ExecutionStatus.done
  }

  if (executionStatuses.every(e => e === ExecutionStatus.scheduled)) {
    return ExecutionStatus.scheduled
  }

  return ExecutionStatus.running
}

export const toFlowLogsContentKey = (flowId: string): string => `flow-logs-content-${flowId}`

export const MISSING_FLOW_ID_ERROR = `flow-id was not found`
export const INVALIDATE_CACHE_HASH = '1'

type SupportedExecaCommandOptions = Omit<execa.Options, 'stderr' | 'stdout' | 'all' | 'stdin'> &
  Required<Pick<execa.Options, 'stdio'>> & {
    log: {
      trace: (message: string, json?: Record<string, unknown>) => void
      infoFromStream: (stream: NodeJS.ReadableStream) => void
      errorFromStream: (stream: NodeJS.ReadableStream) => void
    }
  }

export async function execaCommand<Options extends SupportedExecaCommandOptions>(
  command: string | [string, ...Array<string>],
  options: Options['stdio'] extends 'inherit' ? SupportedExecaCommandOptions : Options,
): Promise<execa.ExecaReturnValue<string>> {
  const execaOptions = {
    ..._.omit(options, ['logLevel', 'log']),
    stdio: options.stdio === 'inherit' ? 'pipe' : options.stdio,
  }
  const subprocess = Array.isArray(command)
    ? execa(command[0], command.slice(1), execaOptions)
    : execa.command(command, execaOptions)

  if (options.stdio === 'ignore') {
    return subprocess
  }

  if (options.stdio === 'inherit') {
    if (subprocess.stdout) {
      options.log.infoFromStream(subprocess.stdout)
    }
    if (subprocess.stderr) {
      options.log.errorFromStream(subprocess.stderr)
    }
  }

  return subprocess
}

export async function getPackages({
  log,
  repoPath,
}: {
  repoPath: string
  log: {
    trace: (message: string, json?: Record<string, unknown>) => void
    infoFromStream: (stream: NodeJS.ReadableStream) => void
    errorFromStream: (stream: NodeJS.ReadableStream) => void
  }
}): Promise<Array<string>> {
  const result = await execaCommand('yarn workspaces --json info', {
    cwd: repoPath,
    stdio: 'pipe',
    log,
  })
  const workspacesInfo: { location: string }[] = JSON.parse(JSON.parse(result.stdout).data)
  return Object.values(workspacesInfo)
    .map(workspaceInfo => workspaceInfo.location)
    .map(relativePackagePath => path.join(repoPath, relativePackagePath))
}

export const buildFullDockerImageName = ({
  dockerOrganizationName,
  dockerRegistry,
  imageName,
  imageTag,
}: {
  dockerRegistry: string
  dockerOrganizationName: string
  imageName: string
  imageTag?: string
}): string => {
  const withImageTag = imageTag ? `:${imageTag}` : ''
  if (dockerRegistry[dockerRegistry.length - 1] === '/') {
    dockerRegistry = dockerRegistry.slice(0, dockerRegistry.length - 1)
  }
  return `${dockerRegistry.replace(`http://`, '').replace(`https://`, '')}/${dockerOrganizationName}/${
    distructPackageJsonName(imageName).name
  }${withImageTag}`
}

export async function getGitRepoInfo(
  repoPath: string,
  log: {
    trace: (message: string, json?: Record<string, unknown>) => void
    infoFromStream: (stream: NodeJS.ReadableStream) => void
    errorFromStream: (stream: NodeJS.ReadableStream) => void
  },
): Promise<GitRepoInfo> {
  const gitInfo = gitUrlParse(await gitRemoteOriginUrl(repoPath))
  const { stdout: headCommit } = await execaCommand(`git rev-parse HEAD`, {
    log,
    stdio: 'pipe',
    cwd: repoPath,
  })
  return {
    auth: {
      username: 'not-supported-yet',
      token: 'not-supported-yet',
    },
    commit: headCommit,
    repoName: gitInfo.name,
    repoNameWithOrgName: gitInfo.full_name,
  }
}

export function distructPackageJsonName(packageJsonName: string): { name: string; scope?: string } {
  if (packageJsonName.includes('@')) {
    const [scope, name] = packageJsonName.split('/')
    return { scope, name }
  } else {
    return { name: packageJsonName }
  }
}

export function calculateNewVersion({
  packagePath,
  packageJsonVersion,
  allPublishedVersions = [],
  log,
}: {
  packagePath: string
  packageJsonVersion: string
  allPublishedVersions?: Array<string>
  log: {
    debug: (message: string, json?: Record<string, unknown>) => void
  }
}): string {
  if (!semver.valid(packageJsonVersion)) {
    throw new Error(`version packgeJson in ${packagePath} is invalid: ${packageJsonVersion}`)
  }

  const incVersion = (version: string) => {
    if (!semver.valid(version)) {
      throw new Error(`version is invalid: ${version} in ${packagePath}`)
    }
    const newVersion = semver.inc(version, 'patch')
    if (!newVersion) {
      throw new Error(`could not path-increment version: ${version} in ${packagePath}`)
    }
    return newVersion
  }

  const allValidVersions = allPublishedVersions.filter(version => semver.valid(version))
  const sorted = semver.sort(allValidVersions)

  if (sorted.length === 0) {
    return packageJsonVersion
  }

  const highestPublishedVersion = sorted[sorted.length - 1]

  let nextVersion: string
  if (sorted.includes(packageJsonVersion)) {
    nextVersion = incVersion(highestPublishedVersion)
  } else {
    if (semver.compare(packageJsonVersion, highestPublishedVersion) === 1) {
      nextVersion = packageJsonVersion
    } else {
      nextVersion = incVersion(highestPublishedVersion)
    }
  }
  log.debug(`calculated next-version: "${nextVersion}" - params:`, {
    packagePath,
    packageJsonVersion,
    highestPublishedVersion,
  })

  return nextVersion
}

export async function getPackageTargetTypes(packagePath: string, packageJson: PackageJson): Promise<TargetType[]> {
  const isNpm = !packageJson.private
  const isDocker: boolean = fs.existsSync(path.join(packagePath, 'Dockerfile'))

  const result: TargetType[] = []
  if (isDocker) {
    result.push(TargetType.docker)
  }
  if (isNpm) {
    result.push(TargetType.npm)
  }

  return result
}
