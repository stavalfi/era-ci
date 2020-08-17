import { logger, logReport } from '@tahini/log'
import execa from 'execa'
import fse from 'fs-extra'
import isIp from 'is-ip'
import _ from 'lodash'
import { IPackageJson } from 'package-json-type'
import path from 'path'
import { getPackageInfo } from './package-info'
import { calculatePackagesHash } from './packages-hash'
import { generateCliTableReport } from './report/cli-table-report'
import { generateJsonReport } from './report/json-report'
import {
  Artifact,
  Cleanup,
  Graph,
  JsonReport,
  PackagesStepResult,
  Protocol,
  ServerInfo,
  StepName,
  StepStatus,
  TargetsInfo,
  TargetType,
  Cache,
} from './types'

const log = logger('utils')

export function getTargetTypeByKey(targetTypeKey: string): TargetType {
  switch (targetTypeKey) {
    case 'npm':
      return TargetType.npm
    case 'docker':
      return TargetType.docker
  }
  throw new Error(`unsupported target: ${targetTypeKey}`)
}

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
  if (statuses.includes(StepStatus.skippedAsFailedBecauseLastStepFailed)) {
    return StepStatus.skippedAsFailedBecauseLastStepFailed
  }
  if (statuses.includes(StepStatus.skippedAsPassed)) {
    return StepStatus.skippedAsPassed
  }
  return StepStatus.passed
}

export function shouldFailCi(
  steps: {
    [stepName in StepName]?: PackagesStepResult<stepName>
  },
): boolean {
  return Object.values(steps)
    .filter(step => step)
    .some(step =>
      [StepStatus.skippedAsFailed, StepStatus.failed, StepStatus.skippedAsFailedBecauseLastStepFailed].includes(
        step!.status,
      ),
    )
}

export async function getPackages(repoPath: string): Promise<string[]> {
  const result = await execa.command('yarn workspaces --json info', {
    cwd: repoPath,
  })
  const workspacesInfo: { location: string }[] = JSON.parse(JSON.parse(result.stdout).data)
  return Object.values(workspacesInfo)
    .map(workspaceInfo => workspaceInfo.location)
    .map(relativePackagePath => path.join(repoPath, relativePackagePath))
}

export async function getOrderedGraph<DeploymentClient>({
  artifacts,
  repoPath,
  targetsInfo,
}: {
  repoPath: string
  artifacts: {
    packagePath: string
    packageJson: IPackageJson
    packageName: string | undefined
    targetType: TargetType | undefined
  }[]
  targetsInfo?: TargetsInfo<DeploymentClient>
}): Promise<Graph<{ artifact: Artifact }>> {
  log.verbose('calculate hash of every package and check which packages changed since their last publish')
  const orderedGraph = await calculatePackagesHash(
    repoPath,
    artifacts.map(({ packagePath }) => packagePath),
  )
  const result = await Promise.all(
    orderedGraph.map(async node => ({
      ...node,
      data: {
        artifact: await getPackageInfo({
          targetType: artifacts.find(({ packagePath }) => node.data.packagePath === packagePath)
            ?.targetType as TargetType,
          packageHash: node.data.packageHash,
          packagePath: node.data.packagePath,
          packageJson: node.data.packageJson,
          relativePackagePath: node.data.relativePackagePath,
          targetsInfo,
        }),
      },
    })),
  )
  log.verbose(
    `${orderedGraph.length} packages: ${orderedGraph.map(node => `"${node.data.packageJson.name}"`).join(', ')}`,
  )
  result.forEach(node => {
    log.verbose(
      `${node.data.artifact.relativePackagePath} (${node.data.artifact.packageJson.name}): ${JSON.stringify(
        {
          ..._.omit(node.data, ['artifact.packageJson']),
          packageJsonVersion: node.data.artifact.packageJson.version,
        },
        null,
        2,
      )}`,
    )
  })

  return result
}

export function toServerInfo({ protocol, host, port }: { protocol?: string; host: string; port?: number }): ServerInfo {
  const paramsToString = JSON.stringify({ protocol, host, port }, null, 2)
  if (protocol && protocol !== 'http' && protocol !== 'https') {
    throw new Error(`protocol is not supported: ${protocol}. params: ${paramsToString}`)
  }
  if (isIp.v6(host)) {
    throw new Error(`ipv6 is not supported: ${host}. params: ${paramsToString}`)
  }
  const selectedProtocol: Protocol | undefined = host.includes('://')
    ? (host.split('://')[0] as Protocol)
    : (protocol as Protocol)
  const hostWithoutProtocol = host.replace(`${selectedProtocol}://`, '')
  if (host.includes(':')) {
    const combined = hostWithoutProtocol.split(':')
    return {
      protocol: selectedProtocol,
      host: combined[0],
      port: Number(combined[1]),
    }
  } else {
    const selectedPort = port || (selectedProtocol === 'http' ? 80 : selectedProtocol === 'https' ? 443 : undefined)
    if (selectedPort === undefined) {
      throw new Error(`cant find the port in: ${paramsToString}`)
    }
    return {
      protocol: selectedProtocol,
      host: hostWithoutProtocol,
      port: selectedPort,
    }
  }
}

export async function install({
  executionOrder,
  repoPath,
  graph,
}: {
  repoPath: string
  executionOrder: number
  graph: Graph<{ artifact: Artifact }>
}): Promise<PackagesStepResult<StepName.install>> {
  const startMs = Date.now()
  log.info(`installing...`)

  // @ts-ignore
  if (!(await fse.exists(path.join(repoPath, 'yarn.lock')))) {
    const durationMs = Date.now() - startMs
    return {
      stepName: StepName.install,
      durationMs,
      notes: [`project must have yarn.lock file in the root folder of the repository`],
      status: StepStatus.failed,
      packagesResult: graph.map(node => ({
        ...node,
        data: {
          ...node.data,
          stepResult: {
            durationMs: durationMs,
            notes: [],
            status: StepStatus.failed,
            stepName: StepName.install,
          },
        },
      })),
      executionOrder,
    }
  }

  const result = await execa.command('yarn install', {
    cwd: repoPath,
    stdio: 'inherit',
    reject: false,
  })

  const durationMs = Date.now() - startMs

  return {
    stepName: StepName.install,
    durationMs,
    notes: result.failed ? ['failed to install'] : [],
    status: result.failed ? StepStatus.failed : StepStatus.passed,
    packagesResult: graph.map(node => ({
      ...node,
      data: {
        ...node.data,
        stepResult: {
          durationMs: durationMs,
          notes: [],
          status: result.failed ? StepStatus.failed : StepStatus.passed,
          stepName: StepName.install,
        },
      },
    })),
    executionOrder,
  }
}

export async function build({
  executionOrder,
  repoPath,
  graph,
}: {
  repoPath: string
  executionOrder: number
  graph: Graph<{ artifact: Artifact }>
}): Promise<PackagesStepResult<StepName.build>> {
  const startMs = Date.now()
  log.info(`building...`)

  const rootPackageJson: IPackageJson = await fse.readJson(path.join(repoPath, 'package.json'))

  if (rootPackageJson.scripts && 'build' in rootPackageJson.scripts && rootPackageJson.scripts.build) {
    const result = await execa.command('yarn build', {
      cwd: repoPath,
      stdio: 'inherit',
      reject: false,
    })

    const durationMs = Date.now() - startMs

    return {
      stepName: StepName.build,
      durationMs,
      notes: result.failed ? ['failed to run build-script in root package.json'] : [],
      status: result.failed ? StepStatus.failed : StepStatus.passed,
      executionOrder,
      packagesResult: graph.map(node => ({
        ...node,
        data: {
          ...node.data,
          stepResult: {
            durationMs: durationMs,
            notes: [],
            status: result.failed ? StepStatus.failed : StepStatus.passed,
            stepName: StepName.build,
          },
        },
      })),
    }
  } else {
    const durationMs = Date.now() - startMs

    return {
      stepName: StepName.build,
      durationMs: Date.now() - startMs,
      notes: ['no build-script in root package.json'],
      status: StepStatus.skippedAsPassed,
      packagesResult: graph.map(node => ({
        ...node,
        data: {
          ...node.data,
          stepResult: {
            durationMs: durationMs,
            notes: [],
            status: StepStatus.skippedAsPassed,
            stepName: StepName.build,
          },
        },
      })),
      executionOrder,
    }
  }
}

export async function cleanup(cleanups: Cleanup[]): Promise<void> {
  await Promise.all(
    cleanups.map(func =>
      func().catch(() => {
        // ignore errors
      }),
    ),
  )
}

export async function reportAndExitCi({
  jsonReport,
  cache,
  cleanups,
}: {
  jsonReport: JsonReport
  cleanups: Cleanup[]
  cache: Cache
}): Promise<void> {
  await cache.flow.setFlowResult(jsonReport)
  logReport(generateCliTableReport(jsonReport))
  await cleanup(cleanups)
  if (
    [StepStatus.failed, StepStatus.skippedAsFailed, StepStatus.skippedAsFailedBecauseLastStepFailed].includes(
      jsonReport.summary.status,
    )
  ) {
    process.exitCode = 1
  }
}

type RunStep = (
  stepsResults: {
    [stepName in StepName]?: stepName extends StepName.report ? never : PackagesStepResult<stepName>
  },
) => false | undefined | Promise<false | undefined | PackagesStepResult<StepName>>

export async function runSteps({
  flowId,
  startFlowDateUtc,
  startMs,
  runSteps,
  graph,
}: {
  flowId: string
  startFlowDateUtc: string
  startMs: number
  graph: Graph<{ artifact: Artifact }>
  runSteps: { stopPipelineOnFailure: boolean; runStep: RunStep }[]
}): Promise<JsonReport> {
  const result = await runSteps.reduce(
    async (accPromise, { runStep, stopPipelineOnFailure }) => {
      const { stepsResultUntilNow, exit } = await accPromise
      if (exit) {
        return accPromise
      } else {
        const stepResult = await runStep(stepsResultUntilNow)
        if (!stepResult) {
          return {
            stepsResultUntilNow,
            exit: true,
          }
        }
        const updated = {
          ...stepsResultUntilNow,
          [stepResult.stepName]: stepResult,
        }
        return {
          stepsResultUntilNow: updated,
          exit: stopPipelineOnFailure ? shouldFailCi(updated) : false,
        }
      }
    },
    Promise.resolve({
      stepsResultUntilNow: {},
      exit: false,
    }),
  )

  const report = generateJsonReport({
    flowId,
    startFlowDateUtc,
    durationUntilNowMs: Date.now() - startMs,
    steps: result.stepsResultUntilNow,
    graph,
  })

  return report
}
