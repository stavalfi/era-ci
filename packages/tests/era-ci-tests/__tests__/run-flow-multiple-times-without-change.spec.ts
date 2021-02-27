import {
  skipAsPassedIfStepResultPassedInCacheConstrain,
  skipAsFailedIfStepResultFailedInCacheConstrain,
} from '@era-ci/constrains'
import { createStep } from '@era-ci/core'
import { createTest, isDeepSubset } from '@era-ci/e2e-tests-infra'
import { createLinearStepsGraph } from '@era-ci/steps-graph'
import { LocalSequentalTaskQueue } from '@era-ci/task-queues'
import { ExecutionStatus, Status } from '@era-ci/utils'
import { test, expect } from '@jest/globals'

const { createRepo } = createTest()

test('first flow will fail, second flow will pass, we expect the third flow be skipped as passed', async () => {
  let runsUntilNow = 0
  const { runCi } = await createRepo({
    repo: {
      packages: [
        {
          name: 'a22',
          version: '1.0.0',
        },
      ],
    },
    configurations: {
      steps: createLinearStepsGraph([
        createStep({
          stepName: 'step1',
          stepGroup: 'step1',
          taskQueueClass: LocalSequentalTaskQueue,
          run: async () => ({
            stepConstrains: [
              skipAsPassedIfStepResultPassedInCacheConstrain({
                stepNameToSearchInCache: 'step1',
              }),
            ],
            stepLogic: async () => {
              runsUntilNow++
              if (runsUntilNow === 1) {
                return { executionStatus: ExecutionStatus.done, status: Status.failed }
              }
              if (runsUntilNow === 2) {
                return { executionStatus: ExecutionStatus.done, status: Status.passed }
              }
              // we shouldn't be here. in the third time, we need to skip as passed.
              return { executionStatus: ExecutionStatus.done, status: Status.failed }
            },
          }),
        })(),
      ]),
    },
  })

  await runCi()
  await runCi()

  const result3 = await runCi()

  expect(
    isDeepSubset(result3, {
      jsonReport: {
        flowResult: {
          executionStatus: ExecutionStatus.aborted,
          status: Status.skippedAsPassed,
        },
        stepsResultOfArtifactsByStep: [
          {
            data: {
              artifactsResult: [
                {
                  data: {
                    artifactStepResult: {
                      executionStatus: ExecutionStatus.aborted,
                      status: Status.skippedAsPassed,
                    },
                  },
                },
              ],
            },
          },
        ],
      },
    }),
  ).toBeTruthy()
})

test('first flow will pass, second flow will fail, we expect the third flow be skipped as failed', async () => {
  let runsUntilNow = 0
  const { runCi } = await createRepo({
    repo: {
      packages: [
        {
          name: 'a',
          version: '1.0.0',
        },
      ],
    },
    configurations: {
      steps: createLinearStepsGraph([
        createStep({
          stepName: 'step1',
          stepGroup: 'step1',
          taskQueueClass: LocalSequentalTaskQueue,
          run: async () => ({
            stepConstrains: [
              skipAsFailedIfStepResultFailedInCacheConstrain({
                stepNameToSearchInCache: 'step1',
              }),
            ],
            stepLogic: async () => {
              runsUntilNow++
              if (runsUntilNow === 1) {
                return { executionStatus: ExecutionStatus.done, status: Status.passed }
              }
              if (runsUntilNow === 2) {
                return { executionStatus: ExecutionStatus.done, status: Status.failed }
              }
              // we shouldn't be here. in the third time, we need to skip as failed.
              return { executionStatus: ExecutionStatus.done, status: Status.passed }
            },
          }),
        })(),
      ]),
    },
  })

  await runCi()
  await runCi()

  const result3 = await runCi()

  expect(
    isDeepSubset(result3, {
      jsonReport: {
        flowResult: {
          executionStatus: ExecutionStatus.aborted,
          status: Status.skippedAsFailed,
        },
        stepsResultOfArtifactsByStep: [
          {
            data: {
              artifactsResult: [
                {
                  data: {
                    artifactStepResult: {
                      executionStatus: ExecutionStatus.aborted,
                      status: Status.skippedAsFailed,
                    },
                  },
                },
              ],
            },
          },
        ],
      },
    }),
  ).toBeTruthy()
})

test('reproduce bug: first flow will pass, second flow will skipped as passed, we expect the third flow be skipped as passed \
and show the flow-id of the first flow as a reason in the last two flows', async () => {
  let runsUntilNow = 0
  const { runCi } = await createRepo({
    repo: {
      packages: [
        {
          name: 'a',
          version: '1.0.0',
        },
      ],
    },
    configurations: {
      steps: createLinearStepsGraph([
        createStep({
          stepName: 'step1',
          stepGroup: 'step1',
          taskQueueClass: LocalSequentalTaskQueue,
          run: async () => ({
            stepConstrains: [
              skipAsPassedIfStepResultPassedInCacheConstrain({
                stepNameToSearchInCache: 'step1',
              }),
            ],
            stepLogic: async () => {
              runsUntilNow++
              if (runsUntilNow === 1) {
                return { executionStatus: ExecutionStatus.done, status: Status.passed }
              }
              // we shouldn't be here. in the third time, we need to skip as passed.
              return { executionStatus: ExecutionStatus.done, status: Status.failed }
            },
          }),
        })(),
      ]),
    },
  })

  const result1 = await runCi()
  const result2 = await runCi()
  const result3 = await runCi()

  expect(
    isDeepSubset(result2, {
      jsonReport: {
        flowResult: {
          executionStatus: ExecutionStatus.aborted,
          status: Status.skippedAsPassed,
        },
        stepsResultOfArtifactsByStep: [
          {
            data: {
              stepResult: {
                executionStatus: ExecutionStatus.aborted,
                status: Status.skippedAsPassed,
                notes: [`step: "step1" passed in flow: ${result1.flowId}`],
              },
            },
          },
        ],
      },
    }),
  ).toBeTruthy()

  expect(
    isDeepSubset(result3, {
      jsonReport: {
        flowResult: {
          executionStatus: ExecutionStatus.aborted,
          status: Status.skippedAsPassed,
        },
        stepsResultOfArtifactsByStep: [
          {
            data: {
              stepResult: {
                executionStatus: ExecutionStatus.aborted,
                status: Status.skippedAsPassed,
                notes: [`step: "step1" passed in flow: ${result1.flowId}`],
              },
            },
          },
        ],
      },
    }),
  ).toBeTruthy()
})
