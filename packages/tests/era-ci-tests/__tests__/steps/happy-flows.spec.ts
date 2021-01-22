import { createStepExperimental } from '@era-ci/core'
import { createRepo, createTest, test } from '@era-ci/e2e-tests-infra'
import { createLinearStepsGraph } from '@era-ci/steps-graph'
import { LocalSequentalTaskQueue } from '@era-ci/task-queues'
import expect from 'expect'
import sinon from 'sinon'

createTest(test)

test('ensure onArtifact is called at most once', async t => {
  t.timeout(50 * 1000)

  const onArtifact = sinon.fake.resolves(undefined)

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
            onArtifact,
          }),
        })(),
      ]),
    },
  })

  const { passed } = await runCi()

  expect(passed).toBeTruthy()
  expect(onArtifact.calledOnce).toBeTruthy()
})

test('ensure onArtifact is called on child-step while parent-step did not finish all artifacts', async t => {
  t.timeout(50 * 1000)

  const callsOrder: string[] = []
  const { runCi } = await createRepo(t, {
    repo: {
      packages: [
        {
          name: 'a',
          version: '1.0.0',
        },
        {
          name: 'b',
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
            onArtifact: async ({ artifact }) => {
              callsOrder.push(`step1-${artifact.index}`)
              if (artifact.index === 0) {
                await t.context.sleep(1000)
              }
            },
          }),
        })(),
        createStepExperimental({
          stepName: 'step2',
          stepGroup: 'step2',
          taskQueueClass: LocalSequentalTaskQueue,
          run: () => ({
            onArtifact: async ({ artifact }) => {
              callsOrder.push(`step2-${artifact.index}`)
            },
          }),
        })(),
      ]),
    },
  })

  await runCi()

  expect(callsOrder).toEqual(['step1-0', 'step1-1', 'step2-1', 'step2-0'])
})
