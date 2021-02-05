import { createStep } from '@era-ci/core'
import { createTest } from '@era-ci/e2e-tests-infra'
import { createLinearStepsGraph } from '@era-ci/steps-graph'
import { LocalSequentalTaskQueue } from '@era-ci/task-queues'
import expect from 'expect'
import sinon from 'sinon'

const { createRepo, sleep } = createTest()

test('ensure onArtifact is called at most once', async () => {
  const onArtifact = sinon.fake.resolves(undefined)

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

test('ensure onArtifact is called on child-step while parent-step did not finish all artifacts', async () => {
  const callsOrder: string[] = []
  const { runCi } = await createRepo({
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
        createStep({
          stepName: 'step1',
          stepGroup: 'step1',
          taskQueueClass: LocalSequentalTaskQueue,
          run: () => ({
            onArtifact: async ({ artifact }) => {
              callsOrder.push(`step1-${artifact.index}`)
              if (artifact.index === 0) {
                await sleep(1000)
              }
            },
          }),
        })(),
        createStep({
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
