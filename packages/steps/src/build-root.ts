import { skipIfRootPackageJsonMissingScriptConstrain } from '@tahini/constrains'
import { ConstrainResultType, createStepExperimental, StepEventType, StepInfo, StepInputEvents } from '@tahini/core'
import { LocalSequentalTaskQueue } from '@tahini/task-queues'
import { Artifact, execaCommand, ExecutionStatus, Node, Status } from '@tahini/utils'
import { merge, Observable } from 'rxjs'
import { first } from 'rxjs/operators'

async function waitParentSteps(options: {
  stepInputEvents$: Observable<StepInputEvents[StepEventType]>
  currentStepInfo: Node<{ stepInfo: StepInfo }>
  currentArtifact?: Node<{ artifact: Artifact }>
}) {
  await merge(
    ...options.currentStepInfo.parentsIndexes.map(i =>
      options.stepInputEvents$.pipe(
        first(e => {
          if (options.currentArtifact) {
            return (
              e.type === StepEventType.artifactStep &&
              e.artifactStepResult.executionStatus === ExecutionStatus.done &&
              e.artifact.index === options.currentArtifact.index &&
              e.step.index === i
            )
          } else {
            return (
              e.type === StepEventType.step &&
              e.stepResult.executionStatus === ExecutionStatus.done &&
              e.step.index === i
            )
          }
        }),
      ),
    ),
  ).toPromise()
}

export const buildRoot = createStepExperimental<LocalSequentalTaskQueue, { scriptName: string }>({
  stepName: 'build-root',
  taskQueueClass: LocalSequentalTaskQueue,
  run: async ({ stepConfigurations, log, repoPath }) => ({
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
