import { skipIfRootPackageJsonMissingScriptConstrain } from '@tahini/constrains'
import { ConstrainResultType, createStepExperimental, runConstrains, StepResultEventType } from '@tahini/core'
import { LocalSequentalTaskQueue } from '@tahini/task-queues'
import { execaCommand, ExecutionStatus, Status } from '@tahini/utils'
import { of } from 'rxjs'

export const buildRoot = createStepExperimental({
  stepName: 'build-root',
  taskQueueClass: LocalSequentalTaskQueue,
  run: async options => {
    const constrainsResult = await runConstrains({
      options,
      stepConstrains: [
        skipIfRootPackageJsonMissingScriptConstrain({
          scriptName: 'build',
        }),
      ],
    })

    if (constrainsResult.combinedResultType === ConstrainResultType.shouldSkip) {
      return of({
        type: StepResultEventType.stepResult,
        stepResult: constrainsResult.stepConstrainsResult.combinedResult,
      })
    }

    await execaCommand('yarn build', {
      log: options.log,
      cwd: options.repoPath,
      stdio: 'inherit',
    })

    return of({
      type: StepResultEventType.stepResult,
      stepResult: {
        executionStatus: ExecutionStatus.done,
        status: Status.passed,
      },
    })
  },
})
