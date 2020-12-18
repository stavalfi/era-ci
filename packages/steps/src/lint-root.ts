import { skipIfRootPackageJsonMissingScriptConstrain } from '@tahini/constrains'
import { createStepExperimental } from '@tahini/core'
import { LocalSequentalTaskQueue } from '@tahini/task-queues'
import { execaCommand } from '@tahini/utils'

export const lintRoot = createStepExperimental<LocalSequentalTaskQueue, { scriptName: string }>({
  stepName: 'lint-root',
  taskQueueClass: LocalSequentalTaskQueue,
  run: ({ repoPath, log, stepConfigurations }) => ({
    stepConstrains: [
      skipIfRootPackageJsonMissingScriptConstrain({
        scriptName: stepConfigurations.scriptName,
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
