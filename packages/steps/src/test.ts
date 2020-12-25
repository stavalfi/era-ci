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
  scriptName: string
  beforeAll?: (
    options: Omit<UserRunStepOptions<LocalSequentalTaskQueue, TestConfigurations>, 'stepConfigurations'>,
  ) => Promise<unknown>
  afterAll?: (
    options: Omit<UserRunStepOptions<LocalSequentalTaskQueue, TestConfigurations>, 'stepConfigurations'>,
  ) => Promise<unknown>
}

export const test = createStepExperimental<LocalSequentalTaskQueue, TestConfigurations>({
  stepName: 'test',
  stepGroup: 'test',
  taskQueueClass: LocalSequentalTaskQueue,
  run: options => ({
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
          skipAsFailedIfStepResultNotFoundInCache: false,
        }),
      artifact =>
        skipIfArtifactStepResultMissingOrPassedInCacheConstrain({
          currentArtifact: artifact,
          stepNameToSearchInCache: 'test',
          skipAsFailedIfStepResultNotFoundInCache: false,
        }),
    ],
    onBeforeArtifacts: async () => {
      if (options.stepConfigurations.beforeAll) {
        await options.stepConfigurations.beforeAll(_.omit(options, 'stepConfigurations'))
      }
    },
    onArtifact: async ({ artifact }) => {
      await execaCommand(`yarn run ${options.stepConfigurations.scriptName}`, {
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
