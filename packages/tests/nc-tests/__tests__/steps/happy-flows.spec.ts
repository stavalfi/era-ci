import { createStepExperimental } from '@tahini/core'
import { createTest } from '@tahini/e2e-tests-infra'
import { createLinearStepsGraph } from '@tahini/steps-graph'
import { LocalSequentalTaskQueue } from '@tahini/task-queues'

const { createRepo, sleep } = createTest()

test('ensure onArtifact is called at most once', async () => {
  const onArtifact = jest.fn(() => Promise.resolve())

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
            onArtifact,
          }),
        })(),
      ]),
    },
  })

  const { passed } = await runCi()

  expect(passed).toBeTruthy()
  expect(onArtifact).toHaveBeenCalledTimes(1)
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
        createStepExperimental({
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
