import { createStepExperimental } from '@tahini/core'
import { createTest } from '@tahini/e2e-tests-infra'
import { createLinearStepsGraph } from '@tahini/steps-graph'
import { LocalSequentalTaskQueue } from '@tahini/task-queues'

const { createRepo } = createTest()

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

// test('ensure onArtifact is called on child-step while parent-step did not finish all artifacts', async () => {
//   const { runCi } = await createRepo({
//     repo: {
//       packages: [
//         {
//           name: 'a',
//           version: '1.0.0',
//         },
//         {
//           name: 'b',
//           version: '1.0.0',
//         },
//       ],
//     },
//     configurations: {
//       steps: createLinearStepsGraph([
//         createStepExperimental({
//           stepName: 'step1',
//           taskQueueClass: LocalSequentalTaskQueue,
//           run: () => ({
//             onArtifact,
//           }),
//         })(),
//         createStepExperimental({
//           stepName: 'step2',
//           taskQueueClass: LocalSequentalTaskQueue,
//           run: () => ({
//             onArtifact,
//           }),
//         })(),
//       ]),
//     },
//   })

//   const { passed } = await runCi()

//   expect(passed).toBeTruthy()
//   expect(onArtifact).toHaveBeenCalledTimes(1)
// })
