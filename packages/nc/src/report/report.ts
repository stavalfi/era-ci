import {
  Graph,
  PackageInfo,
  PublishResult,
  Step,
  StepStatus,
  TestsResult,
  StepResultWithStepName,
  StepResult,
} from '../types'
import { Report, ReportStepResultWithStepName, ReportResultLabel, ReportStepResult } from './types'

export function generateReport({
  buildResult,
  installatResult,
  graph,
  durationUntilNowMs,
  publishResult,
  testResult,
}: {
  durationUntilNowMs: number
  installatResult: StepResultWithStepName<Step.install>
  buildResult: StepResultWithStepName<Step.build>
  testResult: StepResultWithStepName<Step.test, TestsResult & StepResult>
  publishResult: StepResultWithStepName<Step.publish, PublishResult & StepResult>
  graph: Graph<PackageInfo>
}): Report {
  const startMs = Date.now()

  const installStep: ReportStepResultWithStepName<Step.install> = {
    ...installatResult,
    resultLabel: ReportResultLabel.failed,
    notes: [],
  }

  const buildStep: ReportStepResultWithStepName<Step.build> = {
    ...buildResult,
    resultLabel: ReportResultLabel.failed,
    notes: [],
  }

  const testStep: ReportStepResultWithStepName<Step.test, TestsResult & ReportStepResult> = {
    ...testResult,
    resultLabel: ReportResultLabel.failed,
    notes: [],
    packagesResult: testResult.packagesResult.map(result => ({
      ...result,
      resultLabel: ReportResultLabel.failed,
      notes: [],
    })),
  }

  const publishStep: ReportStepResultWithStepName<Step.publish, PublishResult & ReportStepResult> = {
    ...publishResult,
    resultLabel: ReportResultLabel.failed,
    notes: [],
    packagesResult: publishResult.packagesResult.map(result => ({
      ...result,
      resultLabel: ReportResultLabel.failed,
      notes: [],
    })),
  }

  const reportMs = Date.now() - startMs

  const reportStep: ReportStepResultWithStepName<Step.report> = {
    stepName: Step.report,
    durationMs: reportMs,
    resultLabel: ReportResultLabel.failed,
    notes: [],
    packagesResult: [],
    status: StepStatus.failed,
  }

  const summary: ReportStepResult = {
    durationMs: durationUntilNowMs + reportMs,
    notes: [],
    resultLabel: ReportResultLabel.failed,
    status: StepStatus.failed,
  }

  const report: Report = {
    steps: [installStep, buildStep, testStep, publishStep, reportStep],
    summary,
  }

  return report
}
