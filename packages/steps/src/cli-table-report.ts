import { skipIfStepResultNotPassedConstrain } from '@era-ci/constrains'
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
  [ExecutionStatus.aborted]: colors.red('aborted'),
  [ExecutionStatus.running]: colors.magenta('running'),
  [ExecutionStatus.scheduled]: colors.cyan('scheduled'),
}

function generatePackagesStatusReport(jsonReport: JsonReport): string {
  const stepsName = jsonReport.steps.map(step => step.data.stepInfo.stepName)

  function getRows() {
    switch (jsonReport.flowExecutionStatus) {
      case ExecutionStatus.done:
        return jsonReport.stepsResultOfArtifactsByArtifact.map(node => {
          return {
            packageName: node.data.artifact.packageJson.name,
            stepsStatus: jsonReport.steps.map(
              (_, i) => RESULT_STATUS_COLORED[node.data.stepsResult[i].data.artifactStepResult.status],
            ),
            artifactStatus: RESULT_STATUS_COLORED[node.data.artifactResult.status],
            duration: prettyMs(node.data.artifactResult.durationMs),
            notes: [
              ...node.data.artifactResult.notes,
              ..._.flatMapDeep(
                (() => {
                  // both of the cases are identical but needed beacuse of https://github.com/microsoft/TypeScript/issues/7294
                  switch (node.data.artifactExecutionStatus) {
                    case ExecutionStatus.done:
                      return node.data.stepsResult.map(s => {
                        return s.data.artifactStepResult.notes.map(
                          n => `${stepToString({ stepInfo: s.data.stepInfo, steps: jsonReport.steps })} - ${n}`,
                        )
                      })
                    case ExecutionStatus.aborted:
                      return node.data.stepsResult.map(s => {
                        return s.data.artifactStepResult.notes.map(
                          n => `${stepToString({ stepInfo: s.data.stepInfo, steps: jsonReport.steps })} - ${n}`,
                        )
                      })
                  }
                })(),
              ),
            ],
          }
        })
      case ExecutionStatus.aborted:
        return jsonReport.stepsResultOfArtifactsByArtifact.map(node => {
          return {
            packageName: node.data.artifact.packageJson.name,
            stepsStatus: jsonReport.steps.map(
              (_, i) => RESULT_STATUS_COLORED[node.data.stepsResult[i].data.artifactStepResult.status],
            ),
            artifactStatus: RESULT_STATUS_COLORED[node.data.artifactResult.status],
            duration: prettyMs(node.data.artifactResult.durationMs),
            notes: [
              ...node.data.artifactResult.notes,
              ..._.flatMapDeep(
                (() => {
                  // both of the cases are identical but needed beacuse of https://github.com/microsoft/TypeScript/issues/7294
                  switch (node.data.artifactExecutionStatus) {
                    case ExecutionStatus.aborted:
                      return node.data.stepsResult.map(s => {
                        return s.data.artifactStepResult.notes.map(
                          n => `${stepToString({ stepInfo: s.data.stepInfo, steps: jsonReport.steps })} - ${n}`,
                        )
                      })
                  }
                })(),
              ),
            ],
          }
        })
      case ExecutionStatus.running:
        return jsonReport.stepsResultOfArtifactsByArtifact.map(node => {
          switch (node.data.artifactExecutionStatus) {
            case ExecutionStatus.done:
              return {
                packageName: node.data.artifact.packageJson.name,
                stepsStatus: node.data.stepsResult.map(s => RESULT_STATUS_COLORED[s.data.artifactStepResult.status]),
                artifactStatus: RESULT_STATUS_COLORED[node.data.artifactResult.status],
                duration: prettyMs(node.data.artifactResult.durationMs),
                notes: node.data.artifactResult.notes,
              }
            case ExecutionStatus.aborted:
              return {
                packageName: node.data.artifact.packageJson.name,
                stepsStatus: node.data.stepsResult.map(s => RESULT_STATUS_COLORED[s.data.artifactStepResult.status]),
                artifactStatus: RESULT_STATUS_COLORED[node.data.artifactResult.status],
                duration: prettyMs(node.data.artifactResult.durationMs),
                notes: node.data.artifactResult.notes,
              }
            case ExecutionStatus.running:
              return {
                packageName: node.data.artifact.packageJson.name,
                stepsStatus: node.data.stepsResult.map(s => {
                  if (
                    s.data.artifactStepResult.executionStatus === ExecutionStatus.done ||
                    s.data.artifactStepResult.executionStatus === ExecutionStatus.aborted
                  ) {
                    return RESULT_STATUS_COLORED[s.data.artifactStepResult.status]
                  } else {
                    return EXECUTION_STATUS_COLORED[s.data.artifactStepResult.executionStatus]
                  }
                }),
                artifactStatus: EXECUTION_STATUS_COLORED[node.data.artifactResult.executionStatus],
                duration: '-',
                notes: [],
              }
            case ExecutionStatus.scheduled:
              return {
                packageName: node.data.artifact.packageJson.name,
                stepsStatus: node.data.stepsResult.map(
                  s => EXECUTION_STATUS_COLORED[s.data.artifactStepResult.executionStatus],
                ),
                artifactStatus: EXECUTION_STATUS_COLORED[node.data.artifactResult.executionStatus],
                duration: '-',
                notes: [],
              }
          }
        })
      case ExecutionStatus.scheduled:
        return jsonReport.stepsResultOfArtifactsByArtifact.map(node => {
          return {
            packageName: node.data.artifact.packageJson.name,
            stepsStatus: node.data.stepsResult.map(
              s => EXECUTION_STATUS_COLORED[s.data.artifactStepResult.executionStatus],
            ),
            artifactStatus: EXECUTION_STATUS_COLORED[node.data.artifactResult.executionStatus],
            duration: '-',
            notes: [],
          }
        })
    }
  }

  const rows = getRows()

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
        ...row.notes.slice(0, 1).map(content => ({
          content,
          style: {},
        })),
      ],
      ...row.notes.slice(1).map(note => [note]),
    ]
  })

  const stepsDurations = [
    '',
    ...((): string[] => {
      switch (jsonReport.flowExecutionStatus) {
        case ExecutionStatus.done:
          return jsonReport.stepsResultOfArtifactsByStep.map(s => prettyMs(s.data.stepResult.durationMs))
        case ExecutionStatus.aborted:
          return jsonReport.stepsResultOfArtifactsByStep.map(s => prettyMs(s.data.stepResult.durationMs ?? 0))
        case ExecutionStatus.running:
          return jsonReport.stepsResultOfArtifactsByStep.map(() => '')
        case ExecutionStatus.scheduled:
          return jsonReport.stepsResultOfArtifactsByStep.map(() => '')
      }
    })(),
  ].map<CellOptions>(content => ({
    rowSpan: 1,
    vAlign: 'center',
    hAlign: 'center',
    content,
  }))

  const packagesStatusTable = new Table({
    chars: DEFAULT_CHART,
    colWidths: colums.map((_, i) => (i < colums.length - 1 ? null : 100)),
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
    switch (jsonReport.flowExecutionStatus) {
      case ExecutionStatus.done:
        return jsonReport.stepsResultOfArtifactsByArtifact.map(node => {
          return {
            packageName: node.data.artifact.packageJson.name,
            errors: _.flatMapDeep([
              ...formatErrors(node.data.artifactResult.errors),
              ...(() => {
                switch (node.data.artifactExecutionStatus) {
                  case ExecutionStatus.done:
                    return node.data.stepsResult.map(r =>
                      formatErrors(r.data.artifactStepResult.errors, r.data.stepInfo.displayName),
                    )
                  case ExecutionStatus.aborted:
                    return node.data.stepsResult.map(r =>
                      formatErrors(r.data.artifactStepResult.errors, r.data.stepInfo.displayName),
                    )
                }
              })(),
            ]),
          }
        })
      case ExecutionStatus.aborted:
        return jsonReport.stepsResultOfArtifactsByArtifact.map(node => {
          return {
            packageName: node.data.artifact.packageJson.name,
            errors: _.flatMapDeep([
              ...formatErrors(node.data.artifactResult.errors),
              ...(() => {
                switch (node.data.artifactExecutionStatus) {
                  case ExecutionStatus.aborted:
                    return node.data.stepsResult.map(r =>
                      formatErrors(r.data.artifactStepResult.errors, r.data.stepInfo.displayName),
                    )
                }
              })(),
            ]),
          }
        })
      case ExecutionStatus.running:
        return jsonReport.stepsResultOfArtifactsByArtifact.map(node => {
          switch (node.data.artifactExecutionStatus) {
            case ExecutionStatus.done:
              return {
                packageName: node.data.artifact.packageJson.name,
                errors: _.flatMapDeep([
                  ...formatErrors(node.data.artifactResult.errors),
                  ...node.data.stepsResult.map(r =>
                    formatErrors(r.data.artifactStepResult.errors, r.data.stepInfo.displayName),
                  ),
                ]),
              }
            case ExecutionStatus.aborted:
              return {
                packageName: node.data.artifact.packageJson.name,
                errors: _.flatMapDeep([
                  ...formatErrors(node.data.artifactResult.errors),
                  ...node.data.stepsResult.map(r =>
                    formatErrors(r.data.artifactStepResult.errors, r.data.stepInfo.displayName),
                  ),
                ]),
              }
            case ExecutionStatus.running:
              return {
                packageName: node.data.artifact.packageJson.name,
                errors: _.flatMapDeep([
                  ...node.data.stepsResult.map(r =>
                    r.data.artifactStepResult.executionStatus === ExecutionStatus.done ||
                    r.data.artifactStepResult.executionStatus === ExecutionStatus.aborted
                      ? formatErrors(r.data.artifactStepResult.errors, r.data.stepInfo.displayName)
                      : [],
                  ),
                ]),
              }
            case ExecutionStatus.scheduled:
              return {
                packageName: node.data.artifact.packageJson.name,
                errors: [],
              }
          }
        })
      case ExecutionStatus.scheduled:
        return jsonReport.stepsResultOfArtifactsByArtifact.map(node => {
          return {
            packageName: node.data.artifact.packageJson.name,
            errors: [],
          }
        })
    }
  }

  const rows = getRows().filter(row => row.errors.length > 0)

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
  function getRows() {
    switch (jsonReport.flowExecutionStatus) {
      case ExecutionStatus.done:
        return jsonReport.stepsResultOfArtifactsByStep.map(node => {
          return {
            stepName: stepToString({ stepInfo: node.data.stepInfo, steps: jsonReport.steps }),
            errors: formatErrors(node.data.stepResult.errors),
          }
        })
      case ExecutionStatus.aborted:
        return jsonReport.stepsResultOfArtifactsByStep.map(node => {
          return {
            stepName: stepToString({ stepInfo: node.data.stepInfo, steps: jsonReport.steps }),
            errors: formatErrors(node.data.stepResult.errors),
          }
        })
      case ExecutionStatus.running:
        return jsonReport.stepsResultOfArtifactsByStep.map(node => {
          return {
            stepName: node.data.stepInfo.stepName,
            errors: [],
          }
        })
      case ExecutionStatus.scheduled:
        return jsonReport.stepsResultOfArtifactsByStep.map(node => {
          return {
            stepName: node.data.stepInfo.stepName,
            errors: [],
          }
        })
    }
  }

  const rows = getRows().filter(r => r.errors.length > 0)

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
      skipIfStepResultNotPassedConstrain({
        stepName: jsonReporterStepName,
      }),
    ],
    stepLogic: async () => {
      const jsonReporterStepId = options.steps.find(s => s.data.stepInfo.stepName === jsonReporterStepName)?.data
        .stepInfo.stepId
      if (!jsonReporterStepId) {
        throw new Error(`cli-table-reporter can't find json-reporter-step-id. is it part of the flow?`)
      }
      const jsonReportResult = await options.immutableCache.get(
        jsonReporterCacheKey({ flowId: options.flowId, stepId: jsonReporterStepId }),
        r => {
          if (typeof r === 'string') {
            return stringToJsonReport({ jsonReportAsString: r })
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

      if (jsonReportResult.value.artifacts.length > 0 && jsonReportResult.value.steps.length > 0) {
        options.log.noFormattingInfo(packagesStatusReport)
      }
      if (packagesErrorsReport) {
        options.log.noFormattingInfo(packagesErrorsReport)
      }
      if (stepsErrorsReport) {
        options.log.noFormattingInfo(stepsErrorsReport)
      }
      options.log.noFormattingInfo(summaryReport)
    },
  }),
})
