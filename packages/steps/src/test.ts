import {
  skipIfArtifactPackageJsonMissingScriptConstrain,
  skipIfArtifactStepResultMissingOrFailedInCacheConstrain,
  skipIfArtifactStepResultMissingOrPassedInCacheConstrain,
} from '@tahini/artifact-step-constrains'
import { createStep, RunStrategy, UserRunStepOptions } from '@tahini/core'
import { LocalSequentalTaskQueue } from '@tahini/task-queues'
import { execaCommand, ExecutionStatus, Status } from '@tahini/utils'
import _ from 'lodash'

export const test = createStep<
  LocalSequentalTaskQueue,
  {
    testScriptName: string
    beforeAll?: (
      options: Omit<UserRunStepOptions<LocalSequentalTaskQueue, void>, 'stepConfigurations'>,
    ) => Promise<void | unknown>
    afterAll?: (
      options: Omit<UserRunStepOptions<LocalSequentalTaskQueue, void>, 'stepConfigurations'>,
    ) => Promise<void | unknown>
  }
>({
  stepName: 'test',
  taskQueueClass: LocalSequentalTaskQueue,
  constrains: {
    onArtifact: [
      skipIfArtifactPackageJsonMissingScriptConstrain({
        scriptName: 'test',
      }),
      skipIfArtifactStepResultMissingOrFailedInCacheConstrain({
        stepNameToSearchInCache: 'test',
        skipAsFailedIfStepNotFoundInCache: false,
        skipAsPassedIfStepNotExists: true, // this setting doesn't make sense here but we must specify it
      }),
      skipIfArtifactStepResultMissingOrPassedInCacheConstrain({
        stepNameToSearchInCache: 'test',
        skipAsFailedIfStepNotFoundInCache: false,
        skipAsPassedIfStepNotExists: true, // this setting doesn't make sense here but we must specify it
      }),
    ],
  },
  run: {
    runStrategy: RunStrategy.perArtifact,
    beforeAll: async options => {
      if (options.stepConfigurations.beforeAll) {
        await options.stepConfigurations.beforeAll(_.omit(options, 'stepConfigurations'))
      }
    },
    runStepOnArtifact: async ({ currentArtifact, stepConfigurations, log }) => {
      await execaCommand(`yarn run ${stepConfigurations.testScriptName}`, {
        cwd: currentArtifact.data.artifact.packagePath,
        stdio: 'inherit',
        log,
      })
      return { errors: [], notes: [], executionStatus: ExecutionStatus.done, status: Status.passed }
    },
    afterAll: async options => {
      if (options.stepConfigurations.afterAll) {
        await options.stepConfigurations.afterAll(_.omit(options, 'stepConfigurations'))
      }
    },
  },
})
