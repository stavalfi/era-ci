import { ConstrainResultBase, ConstrainResultType, createConstrain, createStep } from '@era-ci/core'
import { createTest, isDeepSubset } from '@era-ci/e2e-tests-infra'
import { JsonReport } from '@era-ci/steps'
import { createLinearStepsGraph, createTreeStepsGraph } from '@era-ci/steps-graph'
import { LocalSequentalTaskQueue } from '@era-ci/task-queues'
import { AbortResult, ExecutionStatus, Status } from '@era-ci/utils'
import { test, expect } from '@jest/globals'
import sinon from 'sinon'
import type { DeepPartial } from 'ts-essentials'

const { createRepo, sleep } = createTest()

test('ensure constrain is called at most once', async () => {
  const constrain = sinon.fake.resolves({
    resultType: ConstrainResultType.ignoreThisConstrain,
    result: {
      errors: [],
      notes: [],
    },
  })

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
            artifactConstrains: [
              createConstrain({
                constrainName: 'test-constrain',
                constrain,
              }),
            ],
            onArtifact: () => Promise.resolve(),
          }),
        })(),
      ]),
    },
  })

  const { passed } = await runCi()

  expect(passed).toBeTruthy()
  expect(constrain.calledOnce).toBeTruthy()
})

test('reproduce bug: ensure constrain is called at most once', async () => {
  const sleepMs = 3_000

  const constrain = sinon.fake(
    async (): Promise<ConstrainResultBase> => {
      await sleep(sleepMs)
      return {
        resultType: ConstrainResultType.ignoreThisConstrain,
        result: {
          errors: [],
          notes: [],
        },
      }
    },
  )

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
      steps: createTreeStepsGraph([
        {
          step: createStep({
            stepName: 'step1',
            stepGroup: 'step1',
            taskQueueClass: LocalSequentalTaskQueue,
            run: async () => ({
              onArtifact: () => sleep(sleepMs / 2),
            }),
          })(),
          children: [],
        },
        {
          step: createStep({
            stepName: 'step2',
            stepGroup: 'step2',
            taskQueueClass: LocalSequentalTaskQueue,
            run: async () => ({
              onArtifact: () => Promise.resolve(),
            }),
          })(),
          children: [2],
        },
        {
          step: createStep({
            stepName: 'step3',
            stepGroup: 'step3',
            taskQueueClass: LocalSequentalTaskQueue,
            run: async () => ({
              artifactConstrains: [
                createConstrain({
                  constrainName: 'test-constrain',
                  constrain,
                }),
              ],
              onArtifact: () => Promise.resolve(),
            }),
          })(),
          children: [],
        },
      ]),
    },
  })

  const { passed } = await runCi()

  expect(passed).toBeTruthy()
  expect(constrain.calledOnce).toBeTruthy()
})

// REASON for this feature:
// if there are some constrains which identified a problem and choose to skip-as-passed,
// we prefer to "ignore" the results of the other constrains (even if they chose to skip-as-fail)
// USECASE: quay-docker-publish step is disabled and git repo is dirty,
// so it should skip as passed but because the git-repo is dirty, it will skip as failed.
test('if a step has multiple constains such that: one say to skip-as-passed but the others say skip-as-failed,\
 then we should ignore the skip-as-failed results entirly', async () => {
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
            onArtifact: () => Promise.reject('we can not be here...'),
            globalConstrains: [
              createConstrain({
                constrainName: 'constrain1',
                constrain: async () => ({
                  resultType: ConstrainResultType.shouldSkip,
                  result: {
                    executionStatus: ExecutionStatus.aborted,
                    status: Status.skippedAsPassed,
                    errors: [],
                    notes: ['we should see this note1'],
                  },
                }),
              })(),
              createConstrain({
                constrainName: 'constrain2',
                constrain: async () => ({
                  resultType: ConstrainResultType.ignoreThisConstrain,
                  result: {
                    errors: [],
                    notes: ['we should see this note2'],
                  },
                }),
              })(),
              createConstrain({
                constrainName: 'constrain3',
                constrain: async () => ({
                  resultType: ConstrainResultType.shouldSkip,
                  result: {
                    executionStatus: ExecutionStatus.aborted,
                    status: Status.skippedAsFailed,
                    errors: [],
                    notes: ['we should NOT see this note'],
                  },
                }),
              })(),
            ],
          }),
        })(),
      ]),
    },
  })

  const { jsonReport } = await runCi()

  const expectedJsonReport: DeepPartial<JsonReport> = {
    flowResult: {
      errors: [],
      notes: [],
      executionStatus: ExecutionStatus.aborted,
      status: Status.skippedAsPassed,
    },
    stepsResultOfArtifactsByStep: [
      {
        data: {
          stepInfo: {
            stepName: 'step1',
          },
          stepResult: {
            errors: [],
            notes: ['we should see this note1', 'we should see this note2'],
            executionStatus: ExecutionStatus.aborted,
            status: Status.skippedAsPassed,
          },
        },
      },
    ],
  }
  expect(isDeepSubset(jsonReport, expectedJsonReport)).toBeTruthy()

  const stepResult = jsonReport.stepsResultOfArtifactsByStep[0].data.stepResult as AbortResult<
    Status.skippedAsFailed | Status.skippedAsPassed | Status.failed
  >

  expect(stepResult.notes).toHaveLength(2)
})
