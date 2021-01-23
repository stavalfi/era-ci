import { skipIfStepResultMissingOrFailedInCacheConstrain } from '@era-ci/constrains'
import { createStepExperimental, stepToString } from '@era-ci/core'
import { LocalSequentalTaskQueue } from '@era-ci/task-queues'
import { ExecutionStatus, Status } from '@era-ci/utils'
import Table, { CellOptions } from 'cli-table3'
import colors from 'colors/safe'
import _ from 'lodash'
import prettyMs from 'pretty-ms'
import { deserializeError, ErrorObject } from 'serialize-error'
import { JsonReport, jsonReporterCacheKey, jsonReporterStepName, stringToJsonReport } from './json-reporter'

//
// Fix colors not appearing in non-tty environments
//
colors.enable()

// note: this file is not tested (or can't even be tested?). modify with caution!!!

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

const RESULT_STATUS_COLORED = {
  [Status.passed]: good('Passed'),
  [Status.failed]: bad('Failed'),
  [Status.skippedAsPassed]: good('Skipped'),
  [Status.skippedAsFailed]: bad('Skipped'),
}

const EXECUTION_STATUS_COLORED = {
  [ExecutionStatus.running]: colors.magenta('running'),
  [ExecutionStatus.scheduled]: colors.cyan('scheduled'),
}

function generatePackagesStatusReport(jsonReport: JsonReport): string {
  const stepsName = jsonReport.steps.map(step => step.data.stepInfo.stepName)

  function getRows() {
    return jsonReport.stepsResultOfArtifactsByArtifact.slice().map(node => ({
      packageName: `${node.data.artifact.packageJson.name} (${node.data.artifact.packageHash})`,
      stepsStatus: node.data.stepsResult.slice().map(s => {
        if (
          s.data.artifactStepResult.executionStatus === ExecutionStatus.done ||
          s.data.artifactStepResult.executionStatus === ExecutionStatus.aborted
        ) {
          return RESULT_STATUS_COLORED[s.data.artifactStepResult.status]
        } else {
          return EXECUTION_STATUS_COLORED[s.data.artifactStepResult.executionStatus]
        }
      }),
      artifactStatus:
        node.data.artifactResult.executionStatus === ExecutionStatus.done ||
        node.data.artifactResult.executionStatus === ExecutionStatus.aborted
          ? RESULT_STATUS_COLORED[node.data.artifactResult.status]
          : EXECUTION_STATUS_COLORED[node.data.artifactResult.executionStatus],
      duration:
        node.data.artifactResult.executionStatus === ExecutionStatus.done ||
        node.data.artifactResult.executionStatus === ExecutionStatus.aborted
          ? prettyMs(node.data.artifactResult.durationMs)
          : undefined,
      notes: _.flatMapDeep([
        ...('notes' in node.data.artifactResult ? node.data.artifactResult.notes : []),
        ...node.data.stepsResult
          .slice()
          .map(r =>
            'notes' in r.data.artifactStepResult
              ? r.data.artifactStepResult.notes.map(note => `${r.data.stepInfo.displayName} - ${note}`)
              : [],
          ),
      ]),
    }))
  }

  const rows = getRows()

  const hasNotes = rows.some(row => row.notes.length > 0)

  const colums: TableRow = ['', ...stepsName, 'summary'].concat(hasNotes ? ['notes'] : []).map(content => ({
    vAlign: 'center',
    hAlign: 'center',
    content,
  }))

  const rowsInTableFormat = rows.flatMap(row => {
    return [
      [
        ...[
          row.packageName,
          ...row.stepsStatus,
          row.duration ? `${row.artifactStatus} (${row.duration})` : row.artifactStatus,
        ].map<CellOptions>((content, i) => ({
          rowSpan: Object.keys(row.notes).length || 1,
          vAlign: 'center',
          hAlign: i === 0 ? 'left' : 'center',
          content,
        })),
        ...row.notes.slice(0, 1).map(content => ({
          content,
        })),
      ],
      ...row.notes.slice(1).map(note => [note]),
    ]
  })

  const stepsDurations = [
    '',
    ...jsonReport.stepsResultOfArtifactsByStep
      .slice()
      .map(s => ('durationMs' in s.data.stepResult ? prettyMs(s.data.stepResult.durationMs) : '')),
  ].map<CellOptions>(content => ({
    rowSpan: 1,
    vAlign: 'center',
    hAlign: 'center',
    content,
  }))

  const packagesStatusTable = new Table({
    chars: DEFAULT_CHART,
    colWidths: colums.map((_, i) => (hasNotes && i === colums.length - 1 ? 100 : null)),
    wordWrap: true,
  })

  packagesStatusTable.push(colums, ...rowsInTableFormat)

  if (stepsDurations.some(s => s.content)) {
    packagesStatusTable.push(stepsDurations)
  }

  return packagesStatusTable.toString()
}

function formatErrors(errors: Array<ErrorObject>, stepDisplayName?: string) {
  return (
    errors
      ?.filter(Boolean)
      .map(deserializeError)
      .map(e => `step: "${stepDisplayName}" - ${e.stack || e}`) || []
  )
}

function generatePackagesErrorsReport(jsonReport: JsonReport): string {
  function getRows() {
    return jsonReport.stepsResultOfArtifactsByArtifact.slice().map(node => ({
      packageName: node.data.artifact.packageJson.name,
      errors: _.flatMapDeep([
        ...formatErrors('errors' in node.data.artifactResult ? node.data.artifactResult.errors : []),
        ...node.data.stepsResult
          .slice()
          .map(r =>
            formatErrors(
              'errors' in r.data.artifactStepResult ? r.data.artifactStepResult.errors : [],
              r.data.stepInfo.displayName,
            ),
          ),
      ]),
    }))
  }

  const rows = getRows().filter(row => row.errors.length > 0)

  const hasErrors = rows.some(row => row.errors.length > 0)

  if (!hasErrors) {
    return ''
  }

  let result = 'Errors in Packages:'
  for (const row of rows) {
    for (const error of row.errors) {
      result += '\n'
      result += `error in package: "${row.packageName}" - ${error}`
    }
  }

  return result
}

function generateStepsErrorsReport(jsonReport: JsonReport): string {
  function getRows() {
    return jsonReport.stepsResultOfArtifactsByStep.slice().map(node => ({
      stepName: stepToString({ stepInfo: node.data.stepInfo, steps: jsonReport.steps }),
      errors: formatErrors('errors' in node.data.stepResult ? node.data.stepResult.errors : []),
    }))
  }

  const rows = getRows().filter(r => r.errors.length > 0)

  const hasErrors = rows.some(row => row.errors.length > 0)

  if (!hasErrors) {
    return ''
  }

  let result = 'Errors in Packages:'
  for (const row of rows) {
    for (const error of row.errors) {
      result += '\n'
      result += `error in step: "${row.stepName}" - ${error}`
    }
  }

  return result
}

function generateSummaryReport(jsonReport: JsonReport): string {
  const flowId: TableRow = ['flow-id', jsonReport.flow.flowId].map(content => ({
    vAlign: 'center',
    hAlign: 'center',
    content,
  }))
  const repoHash: TableRow = ['repo-hash', jsonReport.flow.repoHash].map(content => ({
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
  const duration: false | TableRow =
    (jsonReport.flowResult.executionStatus === ExecutionStatus.done ||
      jsonReport.flowResult.executionStatus === ExecutionStatus.aborted) &&
    _.isNumber(jsonReport.flowResult.durationMs) &&
    ['duration', prettyMs(jsonReport.flowResult.durationMs)].map(content => ({
      vAlign: 'center',
      hAlign: 'center',
      content,
    }))

  const notes =
    jsonReport.flowResult.executionStatus === ExecutionStatus.done ||
    jsonReport.flowResult.executionStatus === ExecutionStatus.aborted
      ? jsonReport.flowResult.notes
      : []

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
        content:
          jsonReport.flowResult.executionStatus === ExecutionStatus.done ||
          jsonReport.flowResult.executionStatus === ExecutionStatus.aborted
            ? RESULT_STATUS_COLORED[jsonReport.flowResult.status]
            : EXECUTION_STATUS_COLORED[jsonReport.flowResult.executionStatus],
      },
      ...notes.slice(0, 1),
    ],
    ...notes.slice(1).map(note => [note]),
  ]

  const ciTable = new Table({
    chars: DEFAULT_CHART,
  })
  ciTable.push(flowId, repoHash, flowStartFlowDateUtc)
  if (duration) {
    ciTable.push(duration)
  }
  ciTable.push(...columns)
  return ciTable.toString()
}

export const cliTableReporter = createStepExperimental({
  stepName: 'cli-table-reporter',
  stepGroup: 'cli-table-reporter',
  taskQueueClass: LocalSequentalTaskQueue,
  run: options => ({
    stepConstrains: [
      skipIfStepResultMissingOrFailedInCacheConstrain({
        stepNameToSearchInCache: jsonReporterStepName,
        skipAsPassedIfStepNotExists: false,
      }),
    ],
    stepLogic: async () => {
      const jsonReporterStepId = options.steps.find(s => s.data.stepInfo.stepName === jsonReporterStepName)?.data
        .stepInfo.stepId
      if (!jsonReporterStepId) {
        throw new Error(`cli-table-reporter can't find json-reporter-step-id. is it part of the flow?`)
      }

      const jsonReportResult = await options.immutableCache.get({
        key: jsonReporterCacheKey({ flowId: options.flowId, stepId: jsonReporterStepId }),
        isBuffer: true,
        mapper: r => {
          if (typeof r === 'string') {
            return stringToJsonReport({ jsonReportAsString: r })
          } else {
            throw new Error(
              `invalid value in cache. expected the type to be: string, acutal-type: ${typeof r}. actual value: ${r}`,
            )
          }
        },
      })
      if (!jsonReportResult) {
        throw new Error(`can't find json-report in the cache. printing the report is aborted`)
      }

      options.log.info(`report:`)

      const packagesErrorsReport = generatePackagesErrorsReport(jsonReportResult.value)
      const stepsErrorsReport = generateStepsErrorsReport(jsonReportResult.value)
      const packagesStatusReport = generatePackagesStatusReport(jsonReportResult.value)
      const summaryReport = generateSummaryReport(jsonReportResult.value)

      if (packagesErrorsReport.split('\n').length > 15) {
        if (packagesErrorsReport) {
          options.log.noFormattingInfo(packagesErrorsReport)
        }
      }
      if (stepsErrorsReport.split('\n').length > 15) {
        if (stepsErrorsReport) {
          options.log.noFormattingInfo(stepsErrorsReport)
        }
      }

      if (jsonReportResult.value.artifacts.length > 0 && jsonReportResult.value.steps.length > 0) {
        options.log.noFormattingInfo(packagesStatusReport)
      }

      if (packagesErrorsReport.split('\n').length <= 15) {
        if (packagesErrorsReport) {
          options.log.noFormattingInfo(packagesErrorsReport)
        }
      }
      if (stepsErrorsReport.split('\n').length <= 15) {
        if (stepsErrorsReport) {
          options.log.noFormattingInfo(stepsErrorsReport)
        }
      }

      options.log.noFormattingInfo(summaryReport)
    },
  }),
})
