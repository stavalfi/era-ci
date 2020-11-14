import _ from 'lodash'
import {
  skipIfArtifactPackageJsonMissingScriptConstrain,
  skipIfArtifactStepResultMissingOrFailedInCacheConstrain,
  skipIfArtifactStepResultMissingOrPassedInCacheConstrain,
} from '../artifact-step-constrains'
import { createStep, RunStrategy, UserRunStepOptions } from '../create-step'
import { LocalSequentalTaskQueue, LocalSequentalTaskQueueName } from '../task-queues'
import { ExecutionStatus, Status } from '../types'
import { execaCommand } from '../utils'

export const test = createStep<
  LocalSequentalTaskQueueName,
  void,
  LocalSequentalTaskQueue,
  {
    testScriptName: string
    beforeAll?: (
      options: Omit<
        UserRunStepOptions<LocalSequentalTaskQueueName, void, LocalSequentalTaskQueue, never>,
        'stepConfigurations'
      >,
    ) => Promise<void | unknown>
    afterAll?: (
      options: Omit<
        UserRunStepOptions<LocalSequentalTaskQueueName, void, LocalSequentalTaskQueue, never>,
        'stepConfigurations'
      >,
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
      }),
      skipIfArtifactStepResultMissingOrPassedInCacheConstrain({
        stepNameToSearchInCache: 'test',
        skipAsFailedIfStepNotFoundInCache: false,
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
