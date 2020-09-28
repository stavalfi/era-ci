import Table, { CellOptions } from 'cli-table3'
import colors from 'colors/safe'
import prettyMs from 'pretty-ms'
import { createStep, ExecutionStatus, Status } from '../create-step'
import { JsonReport, jsonReporterStepName } from './json-reporter'

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
  [Status.passed]: good('Passed'),
  [Status.failed]: bad('Failed'),
  [Status.skippedAsPassed]: good('Skipped'),
  [Status.skippedAsFailed]: bad('Skipped'),
}

const STEP_EXECUTION_STATUS_COLORED = {
  [ExecutionStatus.aborted]: colors.red('aborted'),
  [ExecutionStatus.running]: colors.magenta('running'),
  [ExecutionStatus.scheduled]: colors.cyan('scheduled'),
}

function generatePackagesStatusReport(jsonReport: JsonReport): string {
  const stepsName = jsonReport.steps.map(step => step.data.stepInfo.stepName)
  const rows = jsonReport.stepsResultOfArtifactsByArtifact.map(node => {
    const data = node.data
    if (data.artifactExecutionStatus === ExecutionStatus.done) {
      return {
        packageName: data.artifact.packageJson.name as string,
        stepsStatus: jsonReport.steps.map(
          (_, i) => STEP_RESULT_STATUS_COLORED[data.stepsResult[i].data.artifactStepResult.status],
        ),
        artifactStatus: STEP_RESULT_STATUS_COLORED[data.artifactResult.status],
        duration: prettyMs(data.artifactResult.durationMs),
        notes: data.artifactResult.notes,
      }
    } else {
      return {
        packageName: data.artifact.packageJson.name as string,
        stepsStatus: jsonReport.steps.map(() => STEP_EXECUTION_STATUS_COLORED[data.artifactExecutionStatus]),
        artifactStatus: STEP_EXECUTION_STATUS_COLORED[data.artifactExecutionStatus],
        duration: '',
        notes: [],
      }
    }
  })

  const hasNotes = rows.some(row => row.notes.length > 0)

  const colums: TableRow = ['', ...stepsName, 'duration', 'summary'].concat(hasNotes ? ['notes'] : []).map(content => ({
    vAlign: 'center',
    hAlign: 'center',
    content,
  }))

  const rowsInTableFormat = rows.flatMap(row => {
    return [
      [
        ...[row.packageName, ...row.stepsStatus, row.duration, row.artifactStatus].map<CellOptions>(content => ({
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
    ...jsonReport.stepsResultOfArtifactsByStep.map(s =>
      s.data.stepExecutionStatus === ExecutionStatus.done ? prettyMs(s.data.stepResult.durationMs) : '',
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
  const notes = jsonReport.flowResult.notes
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
        content: STEP_RESULT_STATUS_COLORED[jsonReport.flowResult.status],
      },
      {
        rowSpan: notes.length || 1,
        vAlign: 'center',
        hAlign: 'center',
        content: prettyMs(jsonReport.flowResult.durationMs),
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

export type CliTableReporterConfiguration = {
  jsonReporterCacheKey: (options: { flowId: string; stepId: string }) => string
  stringToJsonReport: (options: { jsonReportAsString: string }) => JsonReport
}

export const cliTableReporter = createStep<CliTableReporterConfiguration>({
  stepName: 'cli-table-reporter',
  runStepOnRoot: async ({ cache, flowId, stepConfigurations, log, steps }) => {
    const jsonReporterStepId = steps.find(s => s.data.stepInfo.stepName === jsonReporterStepName)?.data.stepInfo.stepId
    if (!jsonReporterStepId) {
      throw new Error(`cli-table-reporter can't find json-reporter-step-id. is it part of the flow?`)
    }
    const jsonReportResult = await cache.get(
      stepConfigurations.jsonReporterCacheKey({ flowId, stepId: jsonReporterStepId }),
      r => {
        if (typeof r === 'string') {
          return stepConfigurations.stringToJsonReport({ jsonReportAsString: r })
        } else {
          throw new Error(
            `invalid value in cache. expected the type to be: string, acutal-type: ${typeof r}. actual value: ${r}`,
          )
        }
      },
    )
    if (!jsonReportResult) {
      throw new Error(`can't find json-report in the cache. printing the report is aborted`)
    }

    const packagesStatusReport = generatePackagesStatusReport(jsonReportResult.value)
    const summaryReport = generateSummaryReport(jsonReportResult.value)

    log.noFormattingInfo(packagesStatusReport)
    log.noFormattingInfo(summaryReport)

    return {
      notes: [],
      status: Status.passed,
    }
  },
})
