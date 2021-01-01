import { ConstrainResultBase, ConstrainResultType, createConstrain, createStepExperimental } from '@era-ci/core'
import { createTest } from '@era-ci/e2e-tests-infra'
import { createLinearStepsGraph, createTreeStepsGraph } from '@era-ci/steps-graph'
import { LocalSequentalTaskQueue } from '@era-ci/task-queues'

const { createRepo, sleep } = createTest()

test('ensure constrain is called at most once', async () => {
  const constrain = jest.fn(
    async (): Promise<ConstrainResultBase> => ({
      resultType: ConstrainResultType.ignoreThisConstrain,
      result: {
        errors: [],
        notes: [],
      },
    }),
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
      steps: createLinearStepsGraph([
        createStepExperimental({
          stepName: 'step1',
          stepGroup: 'step1',
          taskQueueClass: LocalSequentalTaskQueue,
          run: () => ({
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
  expect(constrain).toHaveBeenCalledTimes(1)
})

test('reproduce bug: ensure constrain is called at most once', async () => {
  const sleepMs = 3_000
  const impl = async (): Promise<ConstrainResultBase> => {
    await sleep(sleepMs)
    return {
      resultType: ConstrainResultType.ignoreThisConstrain,
      result: {
        errors: [],
        notes: [],
      },
    }
  }
  const constrain = jest
    .fn()
    .mockImplementationOnce(impl)
    .mockRejectedValueOnce(new Error(`function has been called too many times`))

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
          step: createStepExperimental({
            stepName: 'step1',
            stepGroup: 'step1',
            taskQueueClass: LocalSequentalTaskQueue,
            run: () => ({
              onArtifact: () => sleep(sleepMs / 2),
            }),
          })(),
          children: [],
        },
        {
          step: createStepExperimental({
            stepName: 'step2',
            stepGroup: 'step2',
            taskQueueClass: LocalSequentalTaskQueue,
            run: () => ({
              onArtifact: () => Promise.resolve(),
            }),
          })(),
          children: [2],
        },
        {
          step: createStepExperimental({
            stepName: 'step3',
            stepGroup: 'step3',
            taskQueueClass: LocalSequentalTaskQueue,
            run: () => ({
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
  expect(constrain).toHaveBeenCalledTimes(1)
})
