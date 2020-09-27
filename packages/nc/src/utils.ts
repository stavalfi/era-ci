import execa from 'execa'
import _ from 'lodash'
import path from 'path'
import { Log } from './create-logger'
import { Step, Status, ExecutionStatus, StepInfo, StepsResultOfArtifacts } from './create-step'
import { Graph } from './types'

export const didPassOrSkippedAsPassed = (status: Status) => [Status.passed, Status.skippedAsPassed].includes(status)

export function calculateCombinedStatus(statuses: Status[]): Status {
  if (statuses.length === 0) {
    return Status.skippedAsPassed
  }
  if (statuses.includes(Status.failed)) {
    return Status.failed
  }
  if (statuses.includes(Status.skippedAsFailed)) {
    return Status.skippedAsFailed
  }
  if (statuses.includes(Status.skippedAsPassed)) {
    return Status.skippedAsPassed
  }
  return Status.passed
}

export function getStepsAsGraph(steps: Step[]): Graph<{ stepInfo: StepInfo; runStep: Step['runStep'] }> {
  return steps.map((step, i, array) => ({
    index: i,
    data: {
      stepInfo: {
        stepName: step.stepName,
        stepId: `${step.stepName}-${i}`,
      },
      runStep: step.runStep,
      ExecutionStatus: ExecutionStatus.scheduled,
    },
    childrenIndexes: i === 0 ? [] : [i - 1],
    parentsIndexes: i === array.length - 1 ? [] : [i - 1],
  }))
}

export function getExitCode(stepsResultOfArtifacts: StepsResultOfArtifacts<unknown>): number {
  const finalStepsStatus = calculateCombinedStatus(
    _.flatMapDeep(
      stepsResultOfArtifacts.map(s => {
        switch (s.data.stepExecutionStatus) {
          case ExecutionStatus.done:
            return s.data.stepExecutionStatus === ExecutionStatus.done
              ? s.data.artifactsResult.map(y => y.data.artifactStepResult.status)
              : []
          case ExecutionStatus.aborted:
            return [Status.failed]
          case ExecutionStatus.running:
            return []
          case ExecutionStatus.scheduled:
            return []
        }
      }),
    ),
  )
  if ([Status.passed, Status.skippedAsPassed].includes(finalStepsStatus)) {
    return 0
  } else {
    return 1
  }
}

export const toFlowLogsContentKey = (flowId: string) => `flow-logs-content-${flowId}`

export const MISSING_FLOW_ID_ERROR = `flow-id was not found`
export const INVALIDATE_CACHE_HASH = '1'

type SupportedExecaCommandOptions = Omit<execa.Options, 'stderr' | 'stdout' | 'all' | 'stdin'> &
  Required<Pick<execa.Options, 'stdio'>> & { log: Log }

export async function execaCommand<Options extends SupportedExecaCommandOptions>(
  command: string | [string, ...string[]],
  options: Options['stdio'] extends 'inherit' ? SupportedExecaCommandOptions : Options,
): Promise<execa.ExecaReturnValue<string>> {
  const execaOptions = {
    ..._.omit(options, ['logLevel']),
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

export async function getPackages({ log, repoPath }: { repoPath: string; log: Log }): Promise<string[]> {
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
