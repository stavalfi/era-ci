import { skipIfRootPackageJsonMissingScriptConstrain } from '@era-ci/constrains'
import { createStepExperimental } from '@era-ci/core'
import { LocalSequentalTaskQueue } from '@era-ci/task-queues'
import { execaCommand } from '@era-ci/utils'

export const buildRoot = createStepExperimental<LocalSequentalTaskQueue, { scriptName: string }>({
  stepName: 'build-root',
  stepGroup: 'build',
  taskQueueClass: LocalSequentalTaskQueue,
  run: ({ stepConfigurations, log, repoPath }) => ({
    stepConstrains: [
      skipIfRootPackageJsonMissingScriptConstrain({
        scriptName: stepConfigurations.scriptName,
      }),
    ],
    stepLogic: async () => {
      await execaCommand(`yarn run ${stepConfigurations.scriptName}`, {
        log,
        cwd: repoPath,
        stdio: 'inherit',
      })
    },
  }),
})
