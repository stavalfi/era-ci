export enum StepStatus {
  passed = 'passed',
  skippedAsPassed = 'skipped-as-passed',
  skippedAsFailed = 'skipped-as-failed',
  failed = 'failed',
}

export enum StepExecutionStatus {
  scheduled = 'scheduled',
  running = 'running',
  done = 'done',
  aborted = 'aborted',
}
