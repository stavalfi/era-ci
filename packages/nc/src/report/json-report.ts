import { logger } from '@tahini/log'
import {
  Artifact,
  Graph,
  JsonReport,
  Node,
  PackagesStepResult,
  StepName,
  StepsSummary,
  StepStatus,
  PackageStepResult,
} from '../types'
import { calculateCombinedStatus, shouldFailCi } from '../utils'

const log = logger('json-report')

export function generateJsonReport({
  flowId,
  startFlowDateUtc,
  graph,
  durationUntilNowMs,
  steps,
}: {
  flowId: string
  startFlowDateUtc: string
  durationUntilNowMs: number
  graph: Graph<{ artifact: Artifact }>
  steps: {
    [stepName in StepName]?: stepName extends StepName.report ? never : PackagesStepResult<stepName>
  }
}): JsonReport {
  const reportDurationMs = 0
  log.info(`start to generate json-report`)
  const reportResult: PackagesStepResult<StepName.report> = {
    stepName: StepName.report,
    durationMs: reportDurationMs,
    packagesResult: graph.map(node => ({
      ...node,
      data: {
        artifact: node.data.artifact,
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

  const allSteps = { ...steps, [StepName.report]: reportResult }

  // make sure all the graphs are orders the same as `graph`
  Object.values(allSteps).forEach(value =>
    value?.packagesResult
      .slice()
      .sort((a: Node<{}>, b: Node<{}>) => (a.index < b.index ? -1 : a.index > b.index ? 1 : 0)),
  )

  const finalGraph: JsonReport['graph'] = graph.map(node => {
    const packageSteps = Object.fromEntries(
      Object.entries(allSteps)
        .filter(([, stepResult]) => stepResult)
        .map(([key, stepResult]) => [key, stepResult!.packagesResult[node.index].data.stepResult]),
    )

    const stepsSummary: StepsSummary = {
      durationMs: Object.values(packageSteps)
        .map(stepResult => stepResult.durationMs)
        .reduce((acc, d) => acc + d, 0),
      notes: Object.values(packageSteps)
        .filter(step => step)
        .flatMap(step => step!.notes.map(note => `${step!.stepName} - ${note}`)),
      status: calculateCombinedStatus(Object.values(packageSteps).map(step => step.status)),
    }

    const data: {
      artifact: Artifact
      stepsResult: { [stepName in StepName]?: PackageStepResult[stepName] }
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
    .filter(([, stepResult]) => stepResult)
    .flatMap(([stepName, stepResult]) => stepResult!.notes.map(note => `${stepName} - ${note}`))

  const summary: JsonReport['summary'] = {
    durationMs: durationUntilNowMs + reportDurationMs,
    notes: summaryNotes,
    status: shouldFailAfterInstall ? StepStatus.failed : StepStatus.passed,
  }

  log.verbose(`generated the json-report`)
  return {
    flow: {
      flowId,
      startFlowDateUtc,
    },
    graph: finalGraph,
    steps: allSteps,
    summary,
  }
}
