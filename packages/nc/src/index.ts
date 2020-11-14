#!/usr/bin/env node --unhandled-rejections=strict

/// <reference path="../../../declarations.d.ts" />

// `require('source-map-support').install()` MUST be the first (executed) line in the project!!!
// eslint-disable-next-line @typescript-eslint/no-var-requires
// require('source-map-support').install()
//
import { startCli } from './configuration/cli'

export { ci } from './ci-logic'
export { Config, config } from './configuration'
export {
  ArtifactInStepConstrain,
  ArtifactInStepConstrainResult,
  createArtifactStepConstrain,
} from './create-artifact-step-constrain'
export {
  CreateKeyValueStoreConnection,
  createKeyValueStoreConnection,
  KeyValueStoreConnection,
} from './create-key-value-store-connection'
export { createLinearStepsGraph } from './create-linear-steps-graph'
export { CreateLogger, Log, Logger, LogLevel } from './create-logger'
export { createStep, RunStrategy, Step, StepInfo } from './create-step'
export { createStepConstrain, StepConstrain, StepConstrainResult } from './create-step-constrain'
export {
  AbortTask,
  CreateTaskQueue,
  createTaskQueue,
  DoneTask,
  EventEmitterEvents,
  RunningTask,
  ScheduledTask,
  TaskInfo,
  TaskQueueBase,
  TaskQueueEventEmitter,
} from './create-task-queue'
export { createImmutableCache } from './immutable-cache'
export { RedisConfiguration, redisConnection } from './redis-connection'
export {
  build,
  buildFullDockerImageName,
  cliTableReporter,
  dockerPublish,
  getDockerImageLabelsAndTags,
  install,
  JsonReport,
  jsonReporter,
  jsonReporterCacheKey,
  jsonReportToString,
  k8sGcloudDeployment,
  lint,
  npmPublish,
  npmRegistryLogin,
  NpmScopeAccess,
  stringToJsonReport,
  TargetType,
  test,
  validatePackages,
} from './steps'
export {
  ExampleTaskQueue,
  exampleTaskQueue,
  ExampleTaskQueueName,
  localSequentalTaskQueue,
  LocalSequentalTaskQueue,
  LocalSequentalTaskQueueName,
} from './task-queues'
export { Artifact, ConstrainResult, ExecutionStatus, Graph, PackageJson, Status } from './types'
export { execaCommand } from './utils'
export { LoggerConfiguration, winstonLogger } from './winston-logger'

async function main() {
  try {
    await startCli(process.argv)
  } finally {
    // eslint-disable-next-line no-process-env
    if (process.env.NC_TEST_MODE) {
      // jest don't show last two console logs so we add this as a workaround
      // so we can see the *actual* two last console logs.
      // eslint-disable-next-line no-console
      console.log('---------------------------')
      // eslint-disable-next-line no-console
      console.log('---------------------------')
    }
  }
}

if (require.main === module) {
  main()
}
