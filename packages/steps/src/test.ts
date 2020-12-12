import {
  skipIfArtifactPackageJsonMissingScriptConstrain,
  skipIfArtifactStepResultMissingOrFailedInCacheConstrain,
  skipIfArtifactStepResultMissingOrPassedInCacheConstrain,
  skipIfStepResultNotPassedConstrain,
} from '@tahini/constrains'
import {
  ConstrainResultType,
  createStepExperimental,
  StepEventType,
  StepInputEvents,
  StepOutputEvents,
  UserRunStepOptions,
} from '@tahini/core'
import { LocalSequentalTaskQueue } from '@tahini/task-queues'
import { concatMapOnce, execaCommand, ExecutionStatus, Status } from '@tahini/utils'
import _ from 'lodash'
import { defer, EMPTY, of } from 'rxjs'
import { concatMapTo, mergeMap, onErrorResumeNext } from 'rxjs/operators'

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
  run: async options => {
    const constrainsResult = await options.runConstrains([
      skipIfStepResultNotPassedConstrain({
        stepName: 'install-root',
      }),
    ])

    if (constrainsResult.combinedResultType === ConstrainResultType.shouldSkip) {
      return of({
        type: StepEventType.step,
        stepResult: constrainsResult.combinedResult,
      })
    }

    return options.stepInputEvents$.pipe(
      concatMapOnce(
        e => e.type === StepEventType.artifactStep && e.artifactStepResult.executionStatus === ExecutionStatus.done,
        async () => {
          if (options.stepConfigurations.beforeAll) {
            await options.stepConfigurations.beforeAll(_.omit(options, 'stepConfigurations'))
          }
        },
      ),
      mergeMap<StepInputEvents[StepEventType], Promise<StepOutputEvents[StepEventType]>>(async e => {
        if (e.type === StepEventType.artifactStep && e.artifactStepResult.executionStatus === ExecutionStatus.done) {
          const constrainsResult = await options.runConstrains([
            skipIfArtifactPackageJsonMissingScriptConstrain({ currentArtifact: e.artifact, scriptName: 'test' }),
            skipIfArtifactStepResultMissingOrFailedInCacheConstrain({
              currentArtifact: e.artifact,
              stepNameToSearchInCache: 'test',
              skipAsFailedIfStepNotFoundInCache: false,
              skipAsPassedIfStepNotExists: true, // this setting doesn't make sense here but we must specify it
            }),
            skipIfArtifactStepResultMissingOrPassedInCacheConstrain({
              currentArtifact: e.artifact,
              stepNameToSearchInCache: 'test',
              skipAsFailedIfStepNotFoundInCache: false,
              skipAsPassedIfStepNotExists: true, // this setting doesn't make sense here but we must specify it
            }),
          ])

          if (constrainsResult.combinedResultType === ConstrainResultType.shouldSkip) {
            return {
              type: StepEventType.artifactStep,
              artifactName: e.artifact.data.artifact.packageJson.name,
              artifactStepResult: constrainsResult.combinedResult,
            }
          }

          await execaCommand(`yarn run ${options.stepConfigurations.testScriptName}`, {
            cwd: e.artifact.data.artifact.packagePath,
            stdio: 'inherit',
            log: options.log,
          })

          return {
            type: StepEventType.artifactStep,
            artifactName: e.artifact.data.artifact.packageJson.name,
            artifactStepResult: {
              executionStatus: ExecutionStatus.done,
              status: Status.passed,
            },
          }
        } else {
          return e
        }
      }),
      onErrorResumeNext(
        defer(async () => {
          if (options.stepConfigurations.afterAll) {
            await options.stepConfigurations.afterAll(_.omit(options, 'stepConfigurations'))
          }
        }).pipe(concatMapTo(EMPTY)),
      ),
    )
  },
})
