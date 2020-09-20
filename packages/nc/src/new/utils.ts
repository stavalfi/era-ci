import execa from 'execa'
import _ from 'lodash'
import path from 'path'
import urlParse from 'url-parse'
import { Log } from './create-logger'
import { StepExecutionStatus, StepStatus } from './create-step'
import { RunStep, Step, StepNodeData, StepResultOfAllPackages, Graph, Protocol, ServerInfo } from './types'

export const didPassOrSkippedAsPassed = (stepStatus: StepStatus) =>
  [StepStatus.passed, StepStatus.skippedAsPassed].includes(stepStatus)

export function calculateCombinedStatus(statuses: StepStatus[]): StepStatus {
  if (statuses.length === 0) {
    return StepStatus.skippedAsPassed
  }
  if (statuses.includes(StepStatus.failed)) {
    return StepStatus.failed
  }
  if (statuses.includes(StepStatus.skippedAsFailed)) {
    return StepStatus.skippedAsFailed
  }
  if (statuses.includes(StepStatus.skippedAsPassed)) {
    return StepStatus.skippedAsPassed
  }
  return StepStatus.passed
}

function isProtocolSupported(protocol: string): protocol is Protocol {
  return Object.values(Protocol).includes(protocol as Protocol)
}

function getPort(procotol: Protocol, port: number | string): number {
  if (port === 0) {
    return port
  }
  return Number(port) || (procotol === Protocol.http ? 80 : 443)
}

export function getServerInfoFromRegistryAddress(registryAddress: string): ServerInfo {
  const parsed = urlParse(registryAddress)
  const protocol = parsed.protocol.replace(':', '')
  const protocolError = (protocol: string) => {
    const allowedProtocols = Object.values(Protocol).join(' or ')
    return new Error(
      `url must contain protocol: "${allowedProtocols}". received protocol: "${protocol}" -->> "${registryAddress}"`,
    )
  }
  if (!isProtocolSupported(protocol)) {
    throw protocolError(protocol)
  }
  return {
    host: parsed.hostname,
    port: getPort(protocol, parsed.port),
    protocol: protocol,
  }
}

export function getStepsAsGraph(steps: Step[]): Graph<StepNodeData<StepResultOfAllPackages> & { runStep: RunStep }> {
  return steps.map((step, i, array) => ({
    index: i,
    data: {
      stepInfo: {
        stepName: step.stepName,
        stepId: `${step.stepName}-${i}`,
      },
      runStep: step.runStep,
      stepExecutionStatus: StepExecutionStatus.scheduled,
    },
    childrenIndexes: i === 0 ? [] : [i - 1],
    parentsIndexes: i === array.length - 1 ? [] : [i - 1],
  }))
}

export function getExitCode(steps: Graph<StepNodeData<StepResultOfAllPackages>>): number {
  const finalStepsStatus = calculateCombinedStatus(
    steps.map(n =>
      n.data.stepExecutionStatus === StepExecutionStatus.done
        ? n.data.stepResult.stepSummary.status
        : StepStatus.failed,
    ),
  )

  if ([StepStatus.passed, StepStatus.skippedAsPassed].includes(finalStepsStatus)) {
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
