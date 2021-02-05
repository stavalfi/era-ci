import { ConstrainResultBase, ConstrainResultType, createConstrain, createStep } from '@era-ci/core'
import { createTest } from '@era-ci/e2e-tests-infra'
import { createLinearStepsGraph, createTreeStepsGraph } from '@era-ci/steps-graph'
import { LocalSequentalTaskQueue } from '@era-ci/task-queues'
import expect from 'expect'
import sinon from 'sinon'

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
