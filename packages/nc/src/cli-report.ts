import Table from 'cli-table3'
import { Graph, PackageInfo, TestsResult, PublishResult, Node } from './types'
import chalk from 'chalk'
import randomColor from 'randomcolor'
import { shouldFailBuild } from './utils'

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

const goodColor = randomColor({ hue: 'green' })
const badColor = randomColor({ hue: 'red' })
const skippedColor = randomColor({ hue: 'pink' })

const good = (word: string) => chalk.hex(goodColor)(word)
const bad = (word: string) => chalk.hex(badColor)(word)
const skipped = chalk.hex(skippedColor)('Skipped')

const STATUS = {
  package: {
    tests: {
      passed: good('Passed'),
      failed: bad('Failed'),
      skipped: skipped,
    },
    publish: {
      published: (newVersion: string) => good(newVersion),
      failed: bad('Failed'),
      skipped: skipped,
    },
    summary: {
      ok: good('Ok'),
      failed: bad('Failed'),
    },
  },
  ci: {
    passed: good('Passed'),
    failed: bad('Failed'),
  },
}

function getTestsString(node: Node<PackageInfo & { testsResult: TestsResult }>): string {
  if (node.data.testsResult.skipped) {
    return STATUS.package.tests.skipped
  } else {
    return node.data.testsResult.passed ? STATUS.package.tests.passed : STATUS.package.tests.failed
  }
}

function getTestsNote(node: Node<PackageInfo & { testsResult: TestsResult }>): string | undefined {
  if (node.data.testsResult.skipped) {
    return node.data.testsResult.skipped.reason
  }
}

function getPublishString(node: Node<PackageInfo & { publishResult: PublishResult }>): string {
  if (node.data.publishResult.skipped) {
    return STATUS.package.publish.skipped
  } else {
    return 'asVersion' in node.data.publishResult.published
      ? STATUS.package.publish.published(node.data.publishResult.published.asVersion)
      : STATUS.package.publish.failed
  }
}

function getPublishNote(node: Node<PackageInfo & { publishResult: PublishResult }>): string | undefined {
  if (node.data.publishResult.skipped) {
    return node.data.publishResult.skipped.reason
  }
}

function getSummaryString({
  node,
  shouldPublish,
}: {
  node: Node<PackageInfo & { testsResult: TestsResult; publishResult?: PublishResult }>
  shouldPublish: boolean
}): string {
  function isTestsOk() {
    if ('passed' in node.data.testsResult) {
      return node.data.testsResult.passed
    } else {
      return true
    }
  }
  function isPublishOk() {
    if (!shouldPublish) {
      return true
    }
    if (node.data.publishResult?.skipped) {
      return true
    }
    if (node.data.publishResult?.published) {
      return 'asVersion' in node.data.publishResult.published
    } else {
      return true
    }
  }
  return isTestsOk() && isPublishOk() ? STATUS.package.summary.ok : STATUS.package.summary.failed
}

function generatePackagesStatusReport({
  graph,
  shouldPublish,
}: {
  graph: Graph<PackageInfo & { testsResult: TestsResult; publishResult: PublishResult }>
  shouldPublish: boolean
}): string {
  const rows = graph.map(node => {
    return {
      packageName: node.data.packageJson.name as string,
      testsResult: getTestsString(node),
      publishResult: getPublishString(node),
      summary: getSummaryString({ node, shouldPublish }),
      notes: {
        ...(getTestsNote(node) && { test: getTestsNote(node) }),
        ...(getPublishNote(node) && { publish: getPublishNote(node) }),
      },
    }
  })

  const anyHasNotes = rows.some(row => Object.keys(row.notes).length > 0)

  const colums: Table.HorizontalTableRow | Table.VerticalTableRow | Table.CrossTableRow = [
    '',
    'test',
    'publish',
    'summary',
    ...(anyHasNotes ? ['notes'] : []),
  ].map(content => ({
    vAlign: 'center',
    hAlign: 'center',
    content,
  }))

  const rowsInTableFormat: (Table.HorizontalTableRow | Table.VerticalTableRow | Table.CrossTableRow)[] = rows.flatMap<
    Table.HorizontalTableRow | Table.VerticalTableRow | Table.CrossTableRow
  >(row => {
    const notes = Object.entries(row.notes).map(([key, value]) => ({
      content: `${key} - ${value}`,
    }))
    return [
      [
        ...[row.packageName, row.testsResult, row.publishResult, row.summary].map(content => ({
          rowSpan: Object.keys(row.notes).length || 1,
          vAlign: 'center',
          hAlign: 'center',
          content,
        })),
        ...notes.slice(0, 1),
      ],
      ...notes.slice(1).map(note => [note]),
    ]
  })

  const packagesStatusTable = new Table({
    chars: DEFAULT_CHART,
  })
  packagesStatusTable.push(colums, ...rowsInTableFormat)

  return packagesStatusTable.toString()
}

function generateCiStatusReport(
  graph: Graph<PackageInfo & { testsResult: TestsResult; publishResult: PublishResult }>,
): string {
  const { failBuild, reasons } = shouldFailBuild(graph)

  const formattedReasons = reasons.map(reason => `* ${reason}`)

  const columns: (Table.HorizontalTableRow | Table.VerticalTableRow | Table.CrossTableRow)[] = [
    [
      {
        rowSpan: formattedReasons?.length || 1,
        vAlign: 'center',
        hAlign: 'center',
        content: 'Ci',
      },
      {
        rowSpan: formattedReasons?.length || 1,
        vAlign: 'center',
        hAlign: 'center',
        content: failBuild ? STATUS.ci.failed : STATUS.ci.passed,
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

export function generateReport({
  graph,
  shouldPublish,
}: {
  graph: Graph<PackageInfo & { testsResult: TestsResult; publishResult: PublishResult }>
  shouldPublish: boolean
}): string {
  const packagesStatusReport = generatePackagesStatusReport({
    graph,
    shouldPublish,
  })

  const ciReport = generateCiStatusReport(graph)

  return `${packagesStatusReport}\n${ciReport}`
}
