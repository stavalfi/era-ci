import Table, { CellOptions } from 'cli-table3'
import colors from 'colors/safe'
import _ from 'lodash'
import prettyMs from 'pretty-ms'
import { deserializeError } from 'serialize-error'
import { createStep, ExecutionStatus, Status, stepToString } from '../create-step'
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
    switch (data.artifactResult.executionStatus) {
      case ExecutionStatus.done:
        return {
          packageName: data.artifact.packageJson.name,
          stepsStatus: jsonReport.steps.map(
            (_, i) => STEP_RESULT_STATUS_COLORED[data.stepsResult[i].data.artifactStepResult.status],
          ),
          artifactStatus: STEP_RESULT_STATUS_COLORED[data.artifactResult.status],
          duration: prettyMs(data.artifactResult.durationMs),
          notes: [
            ...data.artifactResult.notes,
            ..._.flatten(
              data.stepsResult.map(s => {
                return s.data.artifactStepResult.notes.map(
                  n => `${stepToString({ stepInfo: s.data.stepInfo, steps: jsonReport.steps })} - ${n}`,
                )
              }),
            ),
          ],
        }
      case ExecutionStatus.aborted:
        return {
          packageName: data.artifact.packageJson.name,
          stepsStatus: jsonReport.steps.map(
            (_, i) => STEP_RESULT_STATUS_COLORED[data.stepsResult[i].data.artifactStepResult.status],
          ),
          artifactStatus: STEP_RESULT_STATUS_COLORED[data.artifactResult.status],
          duration: prettyMs(data.artifactResult.durationMs),
          notes: [
            ...data.artifactResult.notes,
            ..._.flatten(
              data.stepsResult.map(s => {
                return s.data.artifactStepResult.notes.map(
                  n => `${stepToString({ stepInfo: s.data.stepInfo, steps: jsonReport.steps })} - ${n}`,
                )
              }),
            ),
          ],
        }
      case ExecutionStatus.running:
      case ExecutionStatus.scheduled:
        return {
          packageName: data.artifact.packageJson.name,
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
      s.data.stepExecutionStatus === ExecutionStatus.done || s.data.stepExecutionStatus === ExecutionStatus.aborted
        ? prettyMs(s.data.stepResult.durationMs)
        : '',
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

function generatePackagesErrorsReport(jsonReport: JsonReport): string {
  const rows = jsonReport.stepsResultOfArtifactsByArtifact
    .map(node => {
      const data = node.data
      switch (data.artifactExecutionStatus) {
        case ExecutionStatus.done:
          return {
            packageName: data.artifact.packageJson.name,
            errors: _.flatten([
              ...(data.artifactResult.error ? [`${deserializeError(data.artifactResult.error)}`] : []),
              ...data.stepsResult.map(r =>
                r.data.artifactStepResult.error ? [`${deserializeError(r.data.artifactStepResult.error)}`] : [],
              ),
            ]),
          }
        case ExecutionStatus.aborted:
          return {
            packageName: data.artifact.packageJson.name,
            errors: _.flatten([
              ...(data.artifactResult.error ? [`${deserializeError(data.artifactResult.error)}`] : []),
              ...data.stepsResult.map(r =>
                r.data.artifactStepResult.error ? [`${deserializeError(r.data.artifactStepResult.error)}`] : [],
              ),
            ]),
          }
        case ExecutionStatus.running:
        case ExecutionStatus.scheduled:
          return {
            packageName: data.artifact.packageJson.name,
            errors: [],
          }
      }
    })
    .filter(r => r.errors.length > 0)

  const hasErrors = rows.some(row => row.errors.length > 0)

  if (!hasErrors) {
    return ''
  }

  const colums: TableRow = [''].concat(hasErrors ? ['errors'] : []).map(content => ({
    vAlign: 'center',
    hAlign: 'center',
    content,
  }))

  const rowsInTableFormat = rows.flatMap(row => {
    return [
      [
        ...[row.packageName].map<CellOptions>(content => ({
          rowSpan: Object.keys(row.errors).length || 1,
          vAlign: 'center',
          hAlign: 'center',
          content,
        })),
        ...row.errors.slice(0, 1),
      ],
      ...row.errors.slice(1).map(error => [error]),
    ]
  })

  const packagesErrorsTable = new Table({
    chars: DEFAULT_CHART,
  })

  packagesErrorsTable.push(colums, ...rowsInTableFormat)

  return packagesErrorsTable.toString()
}

function generateStepsErrorsReport(jsonReport: JsonReport): string {
  const rows = jsonReport.stepsResultOfArtifactsByStep
    .map(node => {
      const data = node.data
      if (data.stepExecutionStatus === ExecutionStatus.done || data.stepExecutionStatus === ExecutionStatus.aborted) {
        return {
          stepName: stepToString({ stepInfo: data.stepInfo, steps: jsonReport.steps }),
          errors: data.stepResult.error ? [`${deserializeError(data.stepResult.error)}`] : [],
        }
      } else {
        return {
          stepName: data.stepInfo.stepName,
          errors: [],
        }
      }
    })
    .filter(r => r.errors.length > 0)

  const hasErrors = rows.some(row => row.errors.length > 0)

  if (!hasErrors) {
    return ''
  }

  const colums: TableRow = [''].concat(hasErrors ? ['errors'] : []).map(content => ({
    vAlign: 'center',
    hAlign: 'center',
    content,
  }))

  const rowsInTableFormat = rows.flatMap(row => {
    return [
      [
        ...[row.stepName].map<CellOptions>(content => ({
          rowSpan: Object.keys(row.errors).length || 1,
          vAlign: 'center',
          hAlign: 'center',
          content,
        })),
        ...row.errors.slice(0, 1),
      ],
      ...row.errors.slice(1).map(error => [error]),
    ]
  })

  const stepsErrorsTable = new Table({
    chars: DEFAULT_CHART,
  })

  stepsErrorsTable.push(colums, ...rowsInTableFormat)

  return stepsErrorsTable.toString()
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
  const duration: TableRow = ['duration', prettyMs(jsonReport.flowResult.durationMs)].map(content => ({
    vAlign: 'center',
    hAlign: 'center',
    content,
  }))
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
      ...notes.slice(0, 1),
    ],
    ...notes.slice(1).map(note => [note]),
  ]

  const ciTable = new Table({
    chars: DEFAULT_CHART,
  })
  ciTable.push(flowId, flowStartFlowDateUtc, duration, ...columns)
  return ciTable.toString()
}

export type CliTableReporterConfiguration = {
  jsonReporterCacheKey: (options: { flowId: string; stepId: string }) => string
  stringToJsonReport: (options: { jsonReportAsString: string }) => JsonReport
}

export const cliTableReporter = createStep<CliTableReporterConfiguration>({
  stepName: 'cli-table-reporter',
  canRunStepOnArtifact: {
    options: {
      runIfPackageResultsInCache: true,
      runIfSomeDirectParentStepFailedOnPackage: true,
    },
  },
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
    const packagesErrorsReport = generatePackagesErrorsReport(jsonReportResult.value)
    const stepsErrorsReport = generateStepsErrorsReport(jsonReportResult.value)
    const summaryReport = generateSummaryReport(jsonReportResult.value)

    log.noFormattingInfo(packagesStatusReport)
    if (packagesErrorsReport) {
      log.noFormattingInfo(packagesErrorsReport)
    }
    if (stepsErrorsReport) {
      log.noFormattingInfo(stepsErrorsReport)
    }
    log.noFormattingInfo(summaryReport)

    return {
      notes: [],
      status: Status.passed,
    }
  },
})
