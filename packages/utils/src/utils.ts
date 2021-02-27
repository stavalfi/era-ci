import execa from 'execa'
import fs from 'fs'
import gitRemoteOriginUrl from 'git-remote-origin-url'
import gitUrlParse from 'git-url-parse'
import _ from 'lodash'
import path from 'path'
import semver from 'semver'
import { PackageManager, TargetType } from './enums'
import {
  ExecutionStatus,
  GitRepoInfo,
  PackageJson,
  Status,
  UnionArrayValues,
  WorkspacesInfo,
  Yarn1Workspaces,
  Yarn2Workspace,
} from './types'

export async function determinePackageManager({
  repoPath,
  processEnv,
}: {
  repoPath: string
  processEnv: NodeJS.ProcessEnv
}): Promise<PackageManager> {
  const { stdout: yarnVersion } = await execa.command(`yarn --version`, {
    cwd: repoPath,
  })
  if (semver.major(yarnVersion) === 2) {
    return PackageManager.yarn2
  }

  const [dotYarn, dotPnp, dotYarnrcYaml, yarnLock] = [
    fs.existsSync(path.join(repoPath, '.yarn')),
    fs.existsSync(path.join(repoPath, '.pnp.js')),
    fs.existsSync(path.join(repoPath, '.yarnrc.yml')),
    fs.existsSync(path.join(repoPath, 'yarn.lock')),
  ]

  if (semver.major(yarnVersion) === 1 || yarnLock || dotYarn || dotYarnrcYaml || dotPnp) {
    return PackageManager.yarn1
  }

  throw new Error(
    `could not determine which package-manager this repository is using: "${repoPath}". supported package-managers: ${Object.values(
      PackageManager,
    )}`,
  )
}

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
  repoPath,
  processEnv,
}: {
  repoPath: string
  processEnv: NodeJS.ProcessEnv
}): Promise<WorkspacesInfo> {
  switch (await determinePackageManager({ repoPath, processEnv })) {
    case PackageManager.yarn1: {
      // this function does not use execaCommand on purpose because other cli packages are using it and they don't have a logger to provide
      const result = await execa.command(`yarn workspaces --json info`, {
        cwd: repoPath,
        stdio: 'pipe',
        shell: true,
      })
      const workspacesInfo: Yarn1Workspaces = JSON.parse(JSON.parse(result.stdout).data)
      return Object.fromEntries(
        Object.entries(workspacesInfo).map(([packageName, workspaceInfo]) => [
          packageName,
          {
            ...workspaceInfo,
            name: packageName,
            location: path.join(repoPath, workspaceInfo.location),
          },
        ]),
      )
    }
    case PackageManager.yarn2: {
      return execa
        .command(`yarn workspaces list --json --verbose`, {
          cwd: repoPath,
          stdio: 'pipe',
          shell: true,
        })
        .then(r =>
          r.stdout
            .split('\n')
            .map(line => JSON.parse(line) as Yarn2Workspace)
            .filter(r => r.location !== '.')
            .map(r => [
              r.name,
              {
                name: r.name,
                location: path.join(repoPath, r.location),
                workspaceDependencies: r.workspaceDependencies,
                mismatchedWorkspaceDependencies: r.mismatchedWorkspaceDependencies,
              },
            ]),
        )
        .then(r => Object.fromEntries(r))
    }
  }
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

export async function getGitRepoInfo({
  repoPath,
  log,
}: {
  repoPath: string
  log: {
    trace: (message: string, json?: Record<string, unknown>) => void
    infoFromStream: (stream: NodeJS.ReadableStream) => void
    errorFromStream: (stream: NodeJS.ReadableStream) => void
  }
}): Promise<GitRepoInfo> {
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
