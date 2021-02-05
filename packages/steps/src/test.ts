import {
  skipIfArtifactPackageJsonMissingScriptConstrain,
  skipIfArtifactStepResultMissingOrFailedInCacheConstrain,
  skipIfArtifactStepResultMissingOrPassedInCacheConstrain,
  skipIfStepIsDisabledConstrain,
  skipIfStepResultMissingOrFailedInCacheConstrain,
} from '@era-ci/constrains'
import { createStepExperimental, toTaskEvent$ } from '@era-ci/core'
import { TaskWorkerTaskQueue } from '@era-ci/task-queues'
import {
  calculateCombinedStatus,
  calculateExecutionStatus,
  ExecutionStatus,
  lastValueFrom,
  Status,
} from '@era-ci/utils'
import _ from 'lodash'
import glob from 'tiny-glob'

export type TestConfigurations = {
  isStepEnabled: boolean
  scriptName: string
  splitTestsToMultipleVms?:
    | false
    | {
        relativeGlobToSearchTestFiles: string // using https://github.com/terkelg/tiny-glob
        totalWorkers: number
        startIndexingFromZero: boolean
        env: {
          // for more info: https://www.npmjs.com/package/ci-parallel-vars
          totalVmsEnvKeyName: string
          indexKeyEnvName: string
        }
      }
  workerBeforeAll?: {
    shellCommand: string
    cwd: string
    processEnv?: NodeJS.ProcessEnv
  }
}

export const test = createStepExperimental<TaskWorkerTaskQueue, TestConfigurations>({
  stepName: 'test',
  stepGroup: 'test',
  taskQueueClass: TaskWorkerTaskQueue,
  run: options => ({
    globalConstrains: [skipIfStepIsDisabledConstrain()],
    stepConstrains: [
      skipIfStepResultMissingOrFailedInCacheConstrain({
        stepNameToSearchInCache: 'install-root',
        skipAsPassedIfStepNotExists: true,
      }),
    ],
    artifactConstrains: [
      artifact =>
        skipIfArtifactPackageJsonMissingScriptConstrain({
          currentArtifact: artifact,
          scriptName: options.stepConfigurations.scriptName,
        }),
      artifact =>
        skipIfArtifactStepResultMissingOrFailedInCacheConstrain({
          currentArtifact: artifact,
          stepNameToSearchInCache: 'test',
        }),
      artifact =>
        skipIfArtifactStepResultMissingOrPassedInCacheConstrain({
          currentArtifact: artifact,
          stepNameToSearchInCache: 'test',
        }),
    ],
    onArtifact: async ({ artifact }) => {
      const { workerBeforeAll, splitTestsToMultipleVms } = options.stepConfigurations

      if (!splitTestsToMultipleVms) {
        const [task] = options.taskQueue.addTasksToQueue([
          {
            group: workerBeforeAll && {
              groupId: `${options.flowId}-${options.currentStepInfo.data.stepInfo.stepId}`,
              beforeAll: workerBeforeAll,
            },
            taskName: `${artifact.data.artifact.packageJson.name}---tests`,
            task: {
              shellCommand: `yarn run ${options.stepConfigurations.scriptName}`,
              cwd: artifact.data.artifact.packagePath,
            },
          },
        ])
        const taskResult = await lastValueFrom(
          toTaskEvent$(task.taskId, {
            eventEmitter: options.taskQueue.eventEmitter,
            throwOnTaskNotPassed: false,
          }),
        )

        switch (taskResult.taskExecutionStatus) {
          case ExecutionStatus.scheduled:
          case ExecutionStatus.running:
            throw new Error(`we can't be here15`)
          case ExecutionStatus.aborted:
            return taskResult.taskResult
          case ExecutionStatus.done: {
            return taskResult.taskResult
          }
        }
      } else {
        const testFilesPaths = await glob(splitTestsToMultipleVms.relativeGlobToSearchTestFiles, {
          filesOnly: true,
          absolute: true,
          cwd: artifact.data.artifact.packagePath,
        })

        if (testFilesPaths.length === 0) {
          return {
            executionStatus: ExecutionStatus.aborted,
            status: Status.skippedAsPassed,
            notes: [
              `could not find any test file using glob: "${splitTestsToMultipleVms.relativeGlobToSearchTestFiles}" under folder: "${artifact.data.artifact.relativePackagePath}"`,
            ],
          }
        }

        if (splitTestsToMultipleVms.totalWorkers < 1 || !_.isInteger(splitTestsToMultipleVms.totalWorkers)) {
          throw new Error(
            `illegal value for totalWorkers: ${splitTestsToMultipleVms.totalWorkers}. must be integer >= 1`,
          )
        }

        const testGroups = _.chunk(
          testFilesPaths,
          Math.ceil(testFilesPaths.length / splitTestsToMultipleVms.totalWorkers),
        )

        options.log.info(
          `running tests for package: "${artifact.data.artifact.packageJson.name}" by splitting them to ${testGroups.length} vms. each vm will run ${testGroups[0].length} test files`,
        )

        const tasks = options.taskQueue.addTasksToQueue(
          testGroups.map((testGroup, i) => {
            const taskIndex = splitTestsToMultipleVms.startIndexingFromZero ? i : i + 1
            return {
              group: workerBeforeAll && {
                groupId: `${options.flowId}-${options.currentStepInfo.data.stepInfo.stepId}`,
                beforeAll: workerBeforeAll,
              },
              taskName: `${
                artifact.data.artifact.packageJson.name
              }---tests-${taskIndex.toString()}/${testGroups.length.toString()}`,
              task: {
                shellCommand: `echo "sub-task ${taskIndex}/${testGroups.length}" && yarn run ${
                  options.stepConfigurations.scriptName
                } ${testGroup.join(' ')}`,
                cwd: artifact.data.artifact.packagePath,
                processEnv: {
                  [splitTestsToMultipleVms.env.totalVmsEnvKeyName]: testGroups.length.toString(),
                  [splitTestsToMultipleVms.env.indexKeyEnvName]: taskIndex.toString(),
                },
              },
            }
          }),
        )

        const tasksResult = await Promise.all(
          tasks.map(task =>
            lastValueFrom(
              toTaskEvent$(task.taskId, {
                eventEmitter: options.taskQueue.eventEmitter,
                throwOnTaskNotPassed: false,
              }),
            ),
          ),
        ).then(tasksResult =>
          tasksResult.map(taskResult => {
            if (
              taskResult.taskExecutionStatus !== ExecutionStatus.done &&
              taskResult.taskExecutionStatus !== ExecutionStatus.aborted
            ) {
              throw new Error(`we can't be here`)
            } else {
              return taskResult
            }
          }),
        )

        if (tasksResult.some(taskResult => taskResult.taskResult.status)) {
          const executionStatus = calculateExecutionStatus(
            tasksResult.map(taskResult => taskResult.taskExecutionStatus),
          )
          const status = calculateCombinedStatus(tasksResult.map(taskResult => taskResult.taskResult.status))
          return {
            executionStatus,
            status,
            notes: _.flattenDeep(tasksResult.map(taskResult => taskResult.taskResult.notes)),
            errors: _.flattenDeep(tasksResult.map(taskResult => taskResult.taskResult.errors)),
          }
        }
      }
    },
  }),
})
