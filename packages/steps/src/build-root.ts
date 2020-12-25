import { skipIfRootPackageJsonMissingScriptConstrain } from '@tahini/constrains'
import { createStepExperimental } from '@tahini/core'
import { LocalSequentalTaskQueue } from '@tahini/task-queues'
import { execaCommand } from '@tahini/utils'

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
