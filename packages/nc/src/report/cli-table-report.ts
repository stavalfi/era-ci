import Table, { CellOptions } from 'cli-table3'
import colors from 'colors/safe'
import prettyMs from 'pretty-ms'
import { JsonReport, StepName, StepStatus } from '../types'

// todo: this file is not tested (or can't be tested). modify with caution!!!

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

const STATUSES = {
  [StepStatus.passed]: good('Passed'),
  [StepStatus.failed]: bad('Failed'),
  [StepStatus.skippedAsPassed]: good('Skipped'),
  [StepStatus.skippedAsFailed]: bad('Skipped'),
  [StepStatus.skippedAsFailedBecauseLastStepFailed]: bad('Skipped'),
}

function generatePackagesStatusReport(jsonReport: JsonReport): string {
  const orderedSteps = [StepName.install, StepName.build, StepName.test, StepName.publish, StepName.deployment].filter(
    // @ts-ignore - ts can't handle the basics :S
    (stepName) => jsonReport.steps[stepName],
  )

  const rows = jsonReport.graph.map((node) => {
    const stepsStatus = Object.fromEntries(
      Object.entries(node.data.stepsResult)
        .filter(([stepName, stepResult]) => stepName !== StepName.report && stepResult)
        .map(([stepName, stepResult]) => [stepName, STATUSES[stepResult!.status]]),
    )
    return {
      packageName: node.data.artifact.packageJson.name as string,
      stepsStatusOrdered: orderedSteps.map((stepName) => stepsStatus[stepName]),
      summaryStatus: STATUSES[node.data.stepsSummary.status],
      duration: prettyMs(node.data.stepsSummary.durationMs),
      notes: Object.entries(node.data.stepsResult)
        .filter(([, stepResult]) => stepResult)
        .flatMap(([stepName, stepResult]) => stepResult!.notes.map((node) => `${stepName} - ${node}`)),
    }
  })

  const hasNotes = rows.some((row) => row.notes.length > 0)

  const colums: TableRow = ['', ...orderedSteps, 'duration', 'summary']
    .concat(hasNotes ? ['notes'] : [])
    .map((content) => ({
      vAlign: 'center',
      hAlign: 'center',
      content,
    }))

  const rowsInTableFormat = rows.flatMap((row) => {
    return [
      [
        ...[row.packageName, ...row.stepsStatusOrdered, row.duration, row.summaryStatus].map<CellOptions>(
          (content) => ({
            rowSpan: Object.keys(row.notes).length || 1,
            vAlign: 'center',
            hAlign: 'center',
            content,
          }),
        ),
        ...row.notes.slice(0, 1),
      ],
      ...row.notes.slice(1).map((note) => [note]),
    ]
  })

  const stepsDurations = [
    '',
    ...orderedSteps.map((stepName) =>
      // @ts-ignore - ts can't handle the basics :S
      prettyMs(jsonReport.steps[stepName].durationMs),
    ),
  ].map<CellOptions>((content) => ({
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
  const flowId: TableRow = ['flow-id', jsonReport.flow.flowId].map((content) => ({
    vAlign: 'center',
    hAlign: 'center',
    content,
  }))
  const flowStartFlowDateUtc: TableRow = ['start', jsonReport.flow.startFlowDateUtc].map((content) => ({
    vAlign: 'center',
    hAlign: 'center',
    content,
  }))
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
        content: STATUSES[jsonReport.summary.status],
      },
      {
        rowSpan: notes.length || 1,
        vAlign: 'center',
        hAlign: 'center',
        content: prettyMs(jsonReport.summary.durationMs),
      },
      ...notes.slice(0, 1),
    ],
    ...notes.slice(1).map((note) => [note]),
  ]

  const ciTable = new Table({
    chars: DEFAULT_CHART,
  })
  ciTable.push(flowId, flowStartFlowDateUtc, ...columns)
  return ciTable.toString()
}

export function generateCliTableReport(jsonReport: JsonReport): string {
  const packagesStatusReport = generatePackagesStatusReport(jsonReport)

  const summaryReport = generateSummaryReport(jsonReport)

  return `${packagesStatusReport}\n${summaryReport}`
}
