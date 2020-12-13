import {
  skipIfArtifactPackageJsonMissingScriptConstrain,
  skipIfArtifactStepResultMissingOrFailedInCacheConstrain,
  skipIfArtifactStepResultMissingOrPassedInCacheConstrain,
  skipIfStepResultNotPassedConstrain,
} from '@tahini/constrains'
import { createStepExperimental, UserRunStepOptions } from '@tahini/core'
import { LocalSequentalTaskQueue } from '@tahini/task-queues'
import { execaCommand } from '@tahini/utils'
import _ from 'lodash'

export type TestConfigurations = {
  testScriptName: string
  beforeAll?: (
    options: Omit<UserRunStepOptions<LocalSequentalTaskQueue, TestConfigurations>, 'stepConfigurations'>,
  ) => Promise<void>
  afterAll?: (
    options: Omit<UserRunStepOptions<LocalSequentalTaskQueue, TestConfigurations>, 'stepConfigurations'>,
  ) => Promise<void>
}

export const test = createStepExperimental<LocalSequentalTaskQueue, TestConfigurations>({
  stepName: 'test',
  taskQueueClass: LocalSequentalTaskQueue,
  run: async options => ({
    stepConstrains: [
      skipIfStepResultNotPassedConstrain({
        stepName: 'install-root',
      }),
    ],
    artifactConstrains: [
      artifact => skipIfArtifactPackageJsonMissingScriptConstrain({ currentArtifact: artifact, scriptName: 'test' }),
      artifact =>
        skipIfArtifactStepResultMissingOrFailedInCacheConstrain({
          currentArtifact: artifact,
          stepNameToSearchInCache: 'test',
          skipAsFailedIfStepNotFoundInCache: false,
          skipAsPassedIfStepNotExists: true, // this setting doesn't make sense here but we must specify it
        }),
      artifact =>
        skipIfArtifactStepResultMissingOrPassedInCacheConstrain({
          currentArtifact: artifact,
          stepNameToSearchInCache: 'test',
          skipAsFailedIfStepNotFoundInCache: false,
          skipAsPassedIfStepNotExists: true, // this setting doesn't make sense here but we must specify it
        }),
    ],
    onBeforeArtifacts: async () => {
      if (options.stepConfigurations.beforeAll) {
        await options.stepConfigurations.beforeAll(_.omit(options, 'stepConfigurations'))
      }
    },
    onArtifact: async ({ artifact }) => {
      await execaCommand(`yarn run ${options.stepConfigurations.testScriptName}`, {
        cwd: artifact.data.artifact.packagePath,
        stdio: 'inherit',
        log: options.log,
      })
    },
    onAfterArtifacts: async () => {
      if (options.stepConfigurations.afterAll) {
        await options.stepConfigurations.afterAll(_.omit(options, 'stepConfigurations'))
      }
    },
  }),
})
