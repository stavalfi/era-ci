import { skipIfRootPackageJsonMissingScriptConstrain } from '@tahini/constrains'
import { ConstrainResultType, createStepExperimental, StepEventType } from '@tahini/core'
import { LocalSequentalTaskQueue } from '@tahini/task-queues'
import { execaCommand, ExecutionStatus, Status } from '@tahini/utils'

export const lintRoot = createStepExperimental<LocalSequentalTaskQueue, { scriptName: string }>({
  stepName: 'lint-root',
  taskQueueClass: LocalSequentalTaskQueue,
  run: async ({ repoPath, log, runConstrains, stepConfigurations }) => {
    const constrainsResult = await runConstrains([
      skipIfRootPackageJsonMissingScriptConstrain({
        scriptName: stepConfigurations.scriptName,
      }),
    ])

    if (constrainsResult.combinedResultType === ConstrainResultType.shouldSkip) {
      return {
        type: StepEventType.step,
        stepResult: constrainsResult.combinedResult,
      }
    }

    await execaCommand(`yarn run ${stepConfigurations.scriptName}`, {
      cwd: repoPath,
      stdio: 'inherit',
      log,
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
