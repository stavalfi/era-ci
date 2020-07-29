import {
  ExecutedStepsWithoutReport,
  Graph,
  PackageInfo,
  PackagesStepResult,
  JsonReport,
  StepName,
  StepStatus,
  Node,
  CombinedPackageStepReportResult,
  ExecutedSteps,
  StepsSummary,
} from '../types'
import { shouldFailCi, calculateCombinedStatus } from '../utils'
import { logger } from '@tahini/log'

const log = logger('json-report')

export function generateJsonReport({
  graph,
  durationUntilNowMs,
  steps,
}: {
  durationUntilNowMs: number
  graph: Graph<{ packageInfo: PackageInfo }>
  steps: ExecutedStepsWithoutReport
}): JsonReport {
  const reportDurationMs = 0
  log.verbose(`start to generate json-report`)

  const reportResult: PackagesStepResult<StepName.report> = {
    stepName: StepName.report,
    durationMs: reportDurationMs,
    packagesResult: graph.map(node => ({
      ...node,
      data: {
        ...node.data,
        stepResult: {
          durationMs: reportDurationMs,
          notes: [],
          status: StepStatus.passed,
          stepName: StepName.report,
        },
      },
    })),
    status: StepStatus.passed,
    notes: [],
    executionOrder: Object.keys(steps).length,
  }

  const allSteps: ExecutedSteps = { ...steps, [StepName.report]: reportResult }

  // make sure all the graphs are orders the same as `graph`
  Object.values(allSteps).forEach(value =>
    value.packagesResult
      .slice()
      .sort((a: Node<{}>, b: Node<{}>) => (a.index < b.index ? -1 : a.index > b.index ? 1 : 0)),
  )

  const finalGraph: JsonReport['graph'] = graph.map(node => {
    //@ts-ignore - typescript can't understand `key` is `StepName`
    const packageSteps: CombinedPackageStepReportResult = Object.fromEntries(
      Object.entries(allSteps).map(([key, stepResult]) => {
        return [key, stepResult.packagesResult[node.index].data]
      }),
    )
    const stepsSummary: StepsSummary = {
      durationMs: Object.values(packageSteps)
        .map(stepResult => stepResult.stepResult.durationMs)
        .reduce((acc, d) => acc + d, 0),
      notes: [],
      status: calculateCombinedStatus(Object.values(packageSteps).map(step => step.stepResult.status)),
    }

    const data: {
      packageInfo: PackageInfo
      stepsResult: CombinedPackageStepReportResult
      stepsSummary: StepsSummary
    } = {
      ...node.data,
      stepsResult: packageSteps,
      stepsSummary,
    }

    return {
      ...node,
      data,
    }
  })

  const shouldFailAfterInstall = shouldFailCi(allSteps)

  const summaryNotes = Object.entries(allSteps)
    .filter(([, stepsResult]) => [StepStatus.failed, StepStatus.skippedAsFailed].includes(stepsResult.status))
    .map(([stepName]) => `${stepName} - failed`)

  const summary: JsonReport['summary'] = {
    durationMs: durationUntilNowMs + reportDurationMs,
    notes: summaryNotes,
    status: shouldFailAfterInstall ? StepStatus.failed : StepStatus.passed,
  }

  log.verbose(`generated the json-report`)

  return {
    graph: finalGraph,
    steps: allSteps,
    summary,
  }
}
