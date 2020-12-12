import { skipIfRootPackageJsonMissingScriptConstrain } from '@tahini/constrains'
import { ConstrainResultType, createStepExperimental, StepEventType } from '@tahini/core'
import { LocalSequentalTaskQueue } from '@tahini/task-queues'
import { execaCommand, ExecutionStatus, Status } from '@tahini/utils'

export const buildRoot = createStepExperimental({
  stepName: 'build-root',
  taskQueueClass: LocalSequentalTaskQueue,
  run: async options => {
    const constrainsResult = await options.runConstrains([
      skipIfRootPackageJsonMissingScriptConstrain({
        scriptName: 'build',
      }),
    ])

    if (constrainsResult.combinedResultType === ConstrainResultType.shouldSkip) {
      return {
        type: StepEventType.step,
        stepResult: constrainsResult.combinedResult,
      }
    }

    await execaCommand('yarn build', {
      log: options.log,
      cwd: options.repoPath,
      stdio: 'inherit',
    })

    return {
      type: StepEventType.step,
      stepResult: {
        executionStatus: ExecutionStatus.done,
        status: Status.passed,
      },
    }
  },
})
