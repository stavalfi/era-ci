import execa from 'execa'
import _ from 'lodash'
import path from 'path'
import { Log } from './create-logger'
import { ExecutionStatus, Status, Step, StepInfo, StepsResultOfArtifactsByStep } from './create-step'
import { Graph, UnionArrayValues } from './types'

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
  if (executionStatuses.includes(ExecutionStatus.running)) {
    return ExecutionStatus.running
  }

  if (executionStatuses.includes(ExecutionStatus.scheduled)) {
    return ExecutionStatus.scheduled
  }

  if (executionStatuses.every(e => e === ExecutionStatus.done)) {
    return ExecutionStatus.done
  }

  return ExecutionStatus.aborted
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
    parentsIndexes: i === 0 ? [] : [i - 1],
    childrenIndexes: i === array.length - 1 ? [] : [i - 1],
  }))
}

export function getExitCode(stepsResultOfArtifactsByStep: StepsResultOfArtifactsByStep): number {
  const finalStepsStatus = calculateCombinedStatus(
    _.flatten(
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
