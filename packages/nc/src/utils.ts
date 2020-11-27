import execa from 'execa'
import gitRemoteOriginUrl from 'git-remote-origin-url'
import gitUrlParse from 'git-url-parse'
import _ from 'lodash'
import nodegit from 'nodegit'
import path from 'path'
import { Log } from './create-logger'
import { StepsResultOfArtifactsByStep } from './create-step'
import { ExecutionStatus, GitRepoInfo, Status, UnionArrayValues } from './types'

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

export function getExitCode(stepsResultOfArtifactsByStep: StepsResultOfArtifactsByStep): number {
  const finalStepsStatus = calculateCombinedStatus(
    _.flatMapDeep(
      stepsResultOfArtifactsByStep.map(s => {
        switch (s.data.stepExecutionStatus) {
          case ExecutionStatus.done:
            return s.data.artifactsResult.map(y => y.data.artifactStepResult.status)
          case ExecutionStatus.aborted:
            return s.data.artifactsResult.map(y => y.data.artifactStepResult.status)
          case ExecutionStatus.running:
            return [Status.failed]
          case ExecutionStatus.scheduled:
            return [Status.failed]
        }
      }),
    ),
  )
  if (didPassOrSkippedAsPassed(finalStepsStatus)) {
    return 0
  } else {
    return 1
  }
}

export const toFlowLogsContentKey = (flowId: string): string => `flow-logs-content-${flowId}`

export const MISSING_FLOW_ID_ERROR = `flow-id was not found`
export const INVALIDATE_CACHE_HASH = '1'

type SupportedExecaCommandOptions = Omit<execa.Options, 'stderr' | 'stdout' | 'all' | 'stdin'> &
  Required<Pick<execa.Options, 'stdio'>> & { log: Log }

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

export async function getPackages({ log, repoPath }: { repoPath: string; log: Log }): Promise<Array<string>> {
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

export async function getGitRepoInfo(repoPath: string): Promise<GitRepoInfo> {
  const gitInfo = gitUrlParse(await gitRemoteOriginUrl(repoPath))
  const git = await nodegit.Repository.open(path.join(repoPath, '.git'))
  const commit = await git.getHeadCommit()
  return {
    auth: {
      username: '1',
      token: gitInfo.token,
    },
    commit: commit.sha(),
    repoName: gitInfo.name,
    repoNameWithOrgName: gitInfo.full_name,
  }
}
