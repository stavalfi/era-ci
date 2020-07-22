import { PublishResult, Step, StepResult, TestsResult, StepResultWithStepName } from '../types'

export enum ReportResultLabel {
  ok = 'ok',
  skipped = 'skipped',
  failed = 'failed',
}

export type ReportStepResult = StepResult & {
  resultLabel: ReportResultLabel
  notes: string[]
}

export type ReportStepResultWithStepName<ReportStep, PackageResult = {}> = ReportStepResult &
  StepResultWithStepName<Step, PackageResult>

export type Report = {
  steps: [
    ReportStepResultWithStepName<Step.install>,
    ReportStepResultWithStepName<Step.build>,
    ReportStepResultWithStepName<Step.test, TestsResult & ReportStepResult>,
    ReportStepResultWithStepName<Step.publish, PublishResult & ReportStepResult>,
    ReportStepResultWithStepName<Step.report>,
  ]
  summary: ReportStepResult
}
