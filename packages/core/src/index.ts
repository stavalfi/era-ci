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
export {
  skipIfRootPackageJsonMissingScriptConstrain,
  skipIfStepIsDisabledConstrain,
  skipIfStepResultNotPassedConstrain,
} from './step-constrains'
export {
  skipIfArtifactPackageJsonMissingScriptConstrain,
  skipIfArtifactStepResultMissingOrFailedInCacheConstrain,
  skipIfArtifactStepResultMissingOrPassedInCacheConstrain,
} from './artifact-step-constrains'
export { createLinearStepsGraph } from './create-linear-steps-graph'
export { CreateLogger, Log, Logger, LogLevel, createLogger } from './create-logger'
export {
  createStep,
  RunStrategy,
  Step,
  StepInfo,
  stepToString,
  AbortStepResultOfArtifacts,
  AbortStepsResultOfArtifact,
  DoneStepResultOfArtifacts,
  DoneStepsResultOfArtifact,
  RunningStepResultOfArtifacts,
  RunningStepsResultOfArtifact,
  ScheduledStepResultOfArtifacts,
  ScheduledStepsResultOfArtifact,
  StepResultOfArtifacts,
  StepsResultOfArtifact,
  StepsResultOfArtifactsByArtifact,
  StepsResultOfArtifactsByStep,
  UserRunStepOptions,
  toStepsResultOfArtifactsByArtifact,
} from './create-step'
export { createStepConstrain, StepConstrain, StepConstrainResult } from './create-step-constrain'
export {
  AbortedTask,
  CreateTaskQueue,
  createTaskQueue,
  DoneTask,
  EventEmitterEvents,
  RunningTask,
  ScheduledTask,
  TaskInfo,
  TaskQueueBase,
  TaskQueueEventEmitter,
  TaskQueueOptions,
  toTaskEvent$,
  TaskTimeoutEventEmitter,
} from './create-task-queue'
export { createImmutableCache } from './immutable-cache'
export { RedisConfiguration, redisConnection } from './redis-connection'
export { localSequentalTaskQueue, LocalSequentalTaskQueue } from './task-queues'

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
