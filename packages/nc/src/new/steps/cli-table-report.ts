import Table, { CellOptions } from 'cli-table3'
import colors from 'colors/safe'
import prettyMs from 'pretty-ms'
import { createStep } from '../create-step'
import { StepExecutionStatus, StepStatus } from '../types'
import { JsonReport } from './json-report'

// note: this file is not tested (or can't be tested). modify with caution!!!

type TableRow = Table.HorizontalTableRow | Table.VerticalTableRow | Table.CrossTableRow

const DEFAULT_CHART = {
  top: '─',
  'top-mid': '┬',
  'top-left': '┌',
  'top-right': '┐',
  bottom: '─',
  'bottom-mid': '┴',
  'bottom-left': '└',
  'bottom-right': '┘',
  left: '│',
  'left-mid': '│',
  mid: '─',
  'mid-mid': '┼',
  right: '│',
  'right-mid': '│',
  middle: '│',
}

const good = (word: string) => colors.green(word)
const bad = (word: string) => colors.red(word)

const STEP_RESULT_STATUS_COLORED = {
  [StepStatus.passed]: good('Passed'),
  [StepStatus.failed]: bad('Failed'),
  [StepStatus.skippedAsPassed]: good('Skipped'),
  [StepStatus.skippedAsFailed]: bad('Skipped'),
}

const STEP_EXECUTION_STATUS_COLORED = {
  [StepExecutionStatus.aborted]: colors.bgCyan('aborted'),
  [StepExecutionStatus.running]: colors.rainbow('running'),
  [StepExecutionStatus.scheduled]: colors.america('scheduled'),
}

function generatePackagesStatusReport(jsonReport: JsonReport): string {
  const orderedSteps = jsonReport.steps.map(step => step.data.stepInfo.stepName)

  const rows = jsonReport.artifacts.map(node => {
    const stepsStatus = node.data.stepsResult.map(stepNode =>
      stepNode.data.stepExecutionStatus === StepExecutionStatus.done
        ? STEP_RESULT_STATUS_COLORED[stepNode.data.stepResult.status]
        : STEP_EXECUTION_STATUS_COLORED[stepNode.data.stepExecutionStatus],
    )

    return {
      packageName: node.data.artifact.packageJson.name as string,
      stepsStatusOrdered: stepsStatus,
      summaryStatus: STEP_RESULT_STATUS_COLORED[node.data.stepsSummary.status],
      duration: prettyMs(node.data.stepsSummary.durationMs),
      notes: node.data.stepsResult.flatMap(stepNode =>
        stepNode.data.stepExecutionStatus === StepExecutionStatus.done
          ? stepNode.data.stepResult.notes.map(node => `${stepNode.data.stepInfo.stepName} - ${node}`)
          : [],
      ),
    }
  })

  const hasNotes = rows.some(row => row.notes.length > 0)

  const colums: TableRow = ['', ...orderedSteps, 'duration', 'summary']
    .concat(hasNotes ? ['notes'] : [])
    .map(content => ({
      vAlign: 'center',
      hAlign: 'center',
      content,
    }))

  const rowsInTableFormat = rows.flatMap(row => {
    return [
      [
        ...[row.packageName, ...row.stepsStatusOrdered, row.duration, row.summaryStatus].map<CellOptions>(content => ({
          rowSpan: Object.keys(row.notes).length || 1,
          vAlign: 'center',
          hAlign: 'center',
          content,
        })),
        ...row.notes.slice(0, 1),
      ],
      ...row.notes.slice(1).map(note => [note]),
    ]
  })

  const stepsDurations = [
    '',
    ...orderedSteps.map(stepName =>
      // @ts-ignore - ts can't handle the basics :S
      prettyMs(jsonReport.steps[stepName].durationMs),
    ),
  ].map<CellOptions>(content => ({
    rowSpan: 1,
    vAlign: 'center',
    hAlign: 'center',
    content,
  }))

  const packagesStatusTable = new Table({
    chars: DEFAULT_CHART,
  })

  packagesStatusTable.push(colums, ...rowsInTableFormat, stepsDurations)

  return packagesStatusTable.toString()
}

function generateSummaryReport(jsonReport: JsonReport): string {
  const flowId: TableRow = ['flow-id', jsonReport.flow.flowId].map(content => ({
    vAlign: 'center',
    hAlign: 'center',
    content,
  }))
  const flowStartFlowDateUtc: TableRow = ['start', new Date(jsonReport.flow.startFlowMs).toUTCString()].map(
    content => ({
      vAlign: 'center',
      hAlign: 'center',
      content,
    }),
  )
  const notes = jsonReport.summary.notes
  const columns: TableRow[] = [
    [
      {
        rowSpan: notes.length || 1,
        vAlign: 'center',
        hAlign: 'center',
        content: 'CI Summary',
      },
      {
        rowSpan: notes.length || 1,
        vAlign: 'center',
        hAlign: 'center',
        content: STEP_RESULT_STATUS_COLORED[jsonReport.summary.status],
      },
      {
        rowSpan: notes.length || 1,
        vAlign: 'center',
        hAlign: 'center',
        content: prettyMs(jsonReport.summary.durationMs),
      },
      ...notes.slice(0, 1),
    ],
    ...notes.slice(1).map(note => [note]),
  ]

  const ciTable = new Table({
    chars: DEFAULT_CHART,
  })
  ciTable.push(flowId, flowStartFlowDateUtc, ...columns)
  return ciTable.toString()
}

export type CliTableReportConfiguration = {
  jsonReportCacheKey: (options: { flowId: string; stepId: string }) => string
  stringToJsonReport: (options: { jsonReportAsString: string }) => JsonReport
}

export const cliTableReport = createStep<CliTableReportConfiguration>({
  stepName: 'cli-table-report',
  runStepOnRoot: async ({ cache, flowId, stepId, stepConfigurations, log }) => {
    const jsonReport = await cache.get(stepConfigurations.jsonReportCacheKey({ flowId, stepId }), r => {
      if (typeof r === 'string') {
        return stepConfigurations.stringToJsonReport({ jsonReportAsString: r })
      } else {
        throw new Error(
          `invalid value in cache. expected the type to be: string, acutal-type: ${typeof r}. actual value: ${r}`,
        )
      }
    })
    if (!jsonReport) {
      throw new Error(`can't find json-report in the cache. printing the report is aborted`)
    }

    const packagesStatusReport = generatePackagesStatusReport(jsonReport)
    const summaryReport = generateSummaryReport(jsonReport)

    log.noFormattingInfo(packagesStatusReport)
    log.noFormattingInfo(summaryReport)

    return {
      status: StepStatus.passed,
    }
  },
})
