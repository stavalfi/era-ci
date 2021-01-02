import {
  skipIfRootPackageJsonMissingScriptConstrain,
  skipIfStepResultMissingOrFailedInCacheConstrain,
  skipIfStepResultMissingOrPassedInCacheConstrain,
} from '@era-ci/constrains'
import { createStepExperimental } from '@era-ci/core'
import { LocalSequentalTaskQueue } from '@era-ci/task-queues'
import { execaCommand } from '@era-ci/utils'

export const lintRoot = createStepExperimental<LocalSequentalTaskQueue, { scriptName: string }>({
  stepName: 'lint-root',
  stepGroup: 'lint',
  taskQueueClass: LocalSequentalTaskQueue,
  run: ({ repoPath, log, stepConfigurations }) => ({
    stepConstrains: [
      skipIfRootPackageJsonMissingScriptConstrain({
        scriptName: stepConfigurations.scriptName,
      }),
      skipIfStepResultMissingOrPassedInCacheConstrain({
        stepNameToSearchInCache: 'lint-root',
        skipAsPassedIfStepNotExists: true,
      }),
      skipIfStepResultMissingOrFailedInCacheConstrain({
        stepNameToSearchInCache: 'lint-root',
        skipAsPassedIfStepNotExists: true,
      }),
    ],
    stepLogic: async () => {
      await execaCommand(`yarn run ${stepConfigurations.scriptName}`, {
        cwd: repoPath,
        stdio: 'inherit',
        log,
      })
    },
  }),
})
