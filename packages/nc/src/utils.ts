import { logger, logReport } from '@tahini/log'
import execa from 'execa'
import fse from 'fs-extra'
import isIp from 'is-ip'
import _ from 'lodash'
import { IPackageJson } from 'package-json-type'
import path from 'path'
import { getPackageInfo } from './package-info'
import { calculatePackagesHash } from './packages-hash'
import {
  Cache,
  ExecutedSteps,
  ExecutedStepsWithoutReport,
  Graph,
  PackageInfo,
  PackagesStepResult,
  Protocol,
  ServerInfo,
  StepName,
  StepStatus,
  TargetType,
  Cleanup,
} from './types'
import { generateJsonReport } from './report/json-report'
import { generateCliTableReport } from './report/cli-table-report'

const log = logger('utils')

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
  if (statuses.includes(StepStatus.passed)) {
    return StepStatus.passed
  }
  return StepStatus.skippedAsPassed
}

export function shouldFailCi(steps: ExecutedStepsWithoutReport | ExecutedSteps): boolean {
  return Object.values(steps).some(step => [StepStatus.skippedAsFailed, StepStatus.failed].includes(step.status))
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

export async function getOrderedGraph({
  packagesInfo,
  repoPath,
  dockerOrganizationName,
  cache,
  dockerRegistry,
  npmRegistry,
}: {
  repoPath: string
  packagesInfo: {
    packagePath: string
    packageJson: IPackageJson
    packageName: string | undefined
    targetType: TargetType | undefined
  }[]
  npmRegistry: ServerInfo
  dockerRegistry: ServerInfo
  dockerOrganizationName: string
  cache: Cache
}): Promise<Graph<{ packageInfo: PackageInfo }>> {
  log.verbose('calculate hash of every package and check which packages changed since their last publish')
  const orderedGraph = await calculatePackagesHash(
    repoPath,
    packagesInfo.map(({ packagePath }) => packagePath),
  )
  const result = await Promise.all(
    orderedGraph.map(async node => ({
      ...node,
      data: {
        packageInfo: await getPackageInfo({
          dockerRegistry,
          npmRegistry,
          targetType: packagesInfo.find(({ packagePath }) => node.data.packagePath === packagePath)
            ?.targetType as TargetType,
          dockerOrganizationName,
          packageHash: node.data.packageHash,
          packagePath: node.data.packagePath,
          relativePackagePath: node.data.relativePackagePath,
          cache,
        }),
      },
    })),
  )
  log.verbose(
    `${orderedGraph.length} packages: ${orderedGraph.map(node => `"${node.data.packageJson.name}"`).join(', ')}`,
  )
  result.forEach(node => {
    log.verbose(
      `${node.data.packageInfo.relativePackagePath} (${node.data.packageInfo.packageJson.name}): ${JSON.stringify(
        {
          ..._.omit(node.data, ['packageJson']),
          packageJsonVersion: node.data.packageInfo.packageJson.version,
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
  graph: Graph<{ packageInfo: PackageInfo }>
}): Promise<PackagesStepResult<StepName.install>> {
  const startMs = Date.now()
  log.info(`installing...`)

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
  graph: Graph<{ packageInfo: PackageInfo }>
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

export async function exitCi({ shouldFail, cleanups }: { shouldFail: boolean; cleanups: Cleanup[] }): Promise<void> {
  await Promise.all(cleanups.map(func => func().catch(() => {})))
  if (shouldFail) {
    process.exitCode = 1
  }
}

export async function reportAndExitCi({
  startMs,
  graph,
  steps,
  shouldFail,
  cleanups,
}: {
  startMs: number
  steps: ExecutedStepsWithoutReport | ExecutedSteps
  shouldFail: boolean
  graph: Graph<{ packageInfo: PackageInfo }>
  cleanups: Cleanup[]
}): Promise<void> {
  const report = generateJsonReport({
    durationUntilNowMs: Date.now() - startMs,
    steps,
    graph,
  })
  logReport(generateCliTableReport(report))
  await exitCi({ shouldFail, cleanups })
}
