import execa from 'execa'
import fs from 'fs'
import gitRemoteOriginUrl from 'git-remote-origin-url'
import gitUrlParse from 'git-url-parse'
import _ from 'lodash'
import path from 'path'
import semver from 'semver'
import { Artifact, ExecutionStatus, GitRepoInfo, PackageJson, Status, TargetType, UnionArrayValues } from './types'

export const didPassOrSkippedAsPassed = (status: Status): boolean =>
  [Status.passed, Status.skippedAsPassed].includes(status)

export function calculateCombinedStatus<StatusesArray extends Status[]>(
  statuses: StatusesArray,
): UnionArrayValues<Status, StatusesArray> {
  if (statuses.includes(Status.failed)) {
    return Status.failed
  }

  if (statuses.includes(Status.skippedAsFailed)) {
    return Status.skippedAsFailed
  }

  if (statuses.includes(Status.passed)) {
    return Status.passed
  }

  return Status.skippedAsPassed
}

export function calculateExecutionStatus<ExecutionStatusArray extends ExecutionStatus[]>(
  executionStatuses: ExecutionStatusArray,
): UnionArrayValues<ExecutionStatus, ExecutionStatusArray> {
  if (executionStatuses.length === 0) {
    return ExecutionStatus.aborted
  } else {
    if (executionStatuses.every(e => e === ExecutionStatus.done)) {
      return ExecutionStatus.done
    }

    if (executionStatuses.every(e => e === ExecutionStatus.done || e === ExecutionStatus.aborted)) {
      return ExecutionStatus.aborted
    }

    if (executionStatuses.every(e => e === ExecutionStatus.scheduled)) {
      return ExecutionStatus.scheduled
    }

    return ExecutionStatus.running
  }
}

export const toFlowLogsContentKey = (flowId: string): string => `flow-logs-content-${flowId}`

export const MISSING_FLOW_ID_ERROR = `flow-id was not found`
export const INVALIDATE_CACHE_HASH = '1'

type SupportedExecaCommandOptions = Omit<execa.Options, 'stderr' | 'stdout' | 'all' | 'stdin'> &
  Required<Pick<execa.Options, 'stdio'>> & {
    log: {
      verbose: (message: string) => void
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
  options.log.verbose(
    `running command: ${JSON.stringify(command, null, 2)} with options: ${JSON.stringify(execaOptions, null, 2)}`,
  )
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
    verbose: (message: string) => void
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

const buildDockerImageName = (packageJsonName: string) => {
  return packageJsonName.replace('/', '-').replace('@', '')
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
  return `${dockerRegistry
    .replace(`http://`, '')
    .replace(`https://`, '')}/${dockerOrganizationName}/${buildDockerImageName(imageName)}${withImageTag}`
}

export async function getGitRepoInfo(
  repoPath: string,
  log: {
    verbose: (message: string) => void
    infoFromStream: (stream: NodeJS.ReadableStream) => void
    errorFromStream: (stream: NodeJS.ReadableStream) => void
  },
): Promise<GitRepoInfo> {
  const gitInfo = gitUrlParse(await gitRemoteOriginUrl(repoPath))
  const { stdout: headCommit } = await execaCommand(`git rev-parse HEAD`, {
    log,
    stdio: 'pipe',
  })
  return {
    auth: {
      username: '1',
      token: gitInfo.token,
    },
    commit: headCommit,
    repoName: gitInfo.name,
    repoNameWithOrgName: gitInfo.full_name,
  }
}

export const setPackageVersion = async ({
  toVersion,
  artifact,
  fromVersion,
}: {
  fromVersion: string
  toVersion: string
  artifact: Artifact
}): Promise<void> => {
  const packageJsonPath = path.join(artifact.packagePath, 'package.json')
  const packageJsonAsString = await fs.promises.readFile(packageJsonPath, 'utf-8')
  const from = `"version": "${fromVersion}"`
  const to = `"version": "${toVersion}"`
  if (packageJsonAsString.includes(from)) {
    const updatedPackageJson = packageJsonAsString.replace(from, to)
    await fs.promises.writeFile(packageJsonPath, updatedPackageJson, 'utf-8')
  } else {
    throw new Error(
      `could not find the following substring in package.json: '${from}'. is there any missing/extra spaces? package.json as string: ${packageJsonAsString}`,
    )
  }
}

export function calculateNewVersion({
  packagePath,
  packageJsonVersion,
  allVersions,
  highestPublishedVersion,
}: {
  packagePath: string
  packageJsonVersion: string
  highestPublishedVersion?: string
  allVersions?: Array<string>
}): string {
  if (!semver.valid(packageJsonVersion)) {
    throw new Error(`version packgeJson in ${packagePath} is invalid: ${packageJsonVersion}`)
  }
  const allValidVersions = allVersions?.filter(version => semver.valid(version))

  if (!allValidVersions?.length) {
    // this is immutable in each registry so if this is not defined or empty, it means that we never published before or there was unpublish of all the versions.
    return packageJsonVersion
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

  if (!highestPublishedVersion) {
    // this is mutable in each registry so if we have versions but this is false, it means that:
    // a. this is the first run of the ci on a target that was already pbulished.
    // b. or, less likely, someone mutated one of the labels that this ci is modifying in every run :(

    if (allValidVersions.includes(packageJsonVersion)) {
      return incVersion(packageJsonVersion)
    } else {
      return packageJsonVersion
    }
  } else {
    if (allValidVersions.includes(highestPublishedVersion)) {
      const maxVersion = semver.gt(packageJsonVersion, highestPublishedVersion)
        ? packageJsonVersion
        : highestPublishedVersion

      if (allVersions?.includes(maxVersion)) {
        return incVersion(maxVersion)
      } else {
        return maxVersion
      }
    } else {
      const sorted = semver.sort(allValidVersions)

      return incVersion(sorted[sorted.length - 1])
    }
  }
}

export async function getPackageTargetType(
  packagePath: string,
  packageJson: PackageJson,
): Promise<TargetType | undefined> {
  const isNpm = !packageJson.private
  // @ts-ignore
  const isDocker: boolean = fs.existsSync(path.join(packagePath, 'Dockerfile'))

  if (isDocker) {
    return TargetType.docker
  }
  if (isNpm) {
    return TargetType.npm
  }
}
