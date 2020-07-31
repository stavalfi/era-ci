import chalk from 'chalk'
import Table, { CellOptions } from 'cli-table3'
import randomColor from 'randomcolor'
import { JsonReport, StepName, StepStatus } from '../types'
import prettyMs from 'pretty-ms'

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

const goodColor = randomColor({ hue: 'green', luminosity: 'light' })
const badColor = randomColor({ hue: 'red', luminosity: 'bright' })

const good = (word: string) => chalk.hex(goodColor)(word)
const bad = (word: string) => chalk.hex(badColor)(word)

const STATUSES = {
  [StepStatus.passed]: good('Passed'),
  [StepStatus.failed]: bad('Failed'),
  [StepStatus.skippedAsPassed]: good('Skipped'),
  [StepStatus.skippedAsFailed]: bad('Skipped'),
  [StepStatus.skippedAsFailedBecauseLastStepFailed]: bad('Skipped'),
}

function generatePackagesStatusReport(jsonReport: JsonReport): string {
  const orderedSteps = [StepName.install, StepName.build, StepName.test, StepName.publish].filter(
    // @ts-ignore - ts can't handle the basics :S
    stepName => jsonReport.steps[stepName],
  )

  const rows = jsonReport.graph.map(node => {
    const stepsStatus = Object.fromEntries(
      Object.entries(node.data.stepsResult)
        .filter(([stepName, stepResult]) => stepName !== StepName.report && stepResult)
        .map(([stepName, stepResult]) => [stepName, STATUSES[stepResult!.status]]),
    )
    return {
      packageName: node.data.artifact.packageJson.name as string,
      stepsStatusOrdered: orderedSteps.map(stepName => stepsStatus[stepName]),
      summaryStatus: STATUSES[node.data.stepsSummary.status],
      duration: prettyMs(node.data.stepsSummary.durationMs),
      notes: Object.entries(node.data.stepsResult)
        .filter(([, stepResult]) => stepResult)
        .flatMap(([stepName, stepResult]) => stepResult!.notes.map(node => `${stepName} - ${node}`)),
    }
  })

  const colums: TableRow = ['', ...orderedSteps, 'duration', 'summary', 'notes'].map(content => ({
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
  const formattedReasons = jsonReport.summary.notes.map(reason => `* ${reason}`)

  const columns: TableRow[] = [
    [
      {
        rowSpan: formattedReasons?.length || 1,
        vAlign: 'center',
        hAlign: 'center',
        content: 'CI Summary',
      },
      {
        rowSpan: formattedReasons?.length || 1,
        vAlign: 'center',
        hAlign: 'center',
        content: STATUSES[jsonReport.summary.status],
      },
      {
        rowSpan: formattedReasons?.length || 1,
        vAlign: 'center',
        hAlign: 'center',
        content: prettyMs(jsonReport.summary.durationMs),
      },
      ...formattedReasons.slice(0, 1),
    ],
    ...formattedReasons.slice(1).map(reason => [reason]),
  ]

  const ciTable = new Table({
    chars: DEFAULT_CHART,
  })
  ciTable.push(...columns)
  return ciTable.toString()
}

export function generateCliTableReport(jsonReport: JsonReport): string {
  const packagesStatusReport = generatePackagesStatusReport(jsonReport)

  const summaryReport = generateSummaryReport(jsonReport)

  return `${packagesStatusReport}\n${summaryReport}`
}
