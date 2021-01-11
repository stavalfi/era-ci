import { ConstrainResultBase, ConstrainResultType, createConstrain, createStepExperimental } from '@era-ci/core'
import { createRepo, createTest, test } from '@era-ci/e2e-tests-infra'
import { createLinearStepsGraph, createTreeStepsGraph } from '@era-ci/steps-graph'
import { LocalSequentalTaskQueue } from '@era-ci/task-queues'
import expect from 'expect'
import sinon from 'sinon'

createTest(test)

test.only('ensure constrain is called at most once', async t => {
  t.log('stav1')
  const constrain = sinon.fake.resolves({
    resultType: ConstrainResultType.ignoreThisConstrain,
    result: {
      errors: [],
      notes: [],
    },
  })

  const { runCi } = await createRepo(t, {
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
  expect(constrain.calledOnce).toBeTruthy()
})

test('reproduce bug: ensure constrain is called at most once', async t => {
  const sleepMs = 3_000

  const constrain = sinon.fake(
    async (): Promise<ConstrainResultBase> => {
      await t.context.sleep(sleepMs)
      return {
        resultType: ConstrainResultType.ignoreThisConstrain,
        result: {
          errors: [],
          notes: [],
        },
      }
    },
  )

  const { runCi } = await createRepo(t, {
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
              onArtifact: () => t.context.sleep(sleepMs / 2),
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
  expect(constrain.calledOnce).toBeTruthy()
})
