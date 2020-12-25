import { createStepExperimental } from '@tahini/core'
import { createTest } from '@tahini/e2e-tests-infra'
import { createLinearStepsGraph } from '@tahini/steps-graph'
import { LocalSequentalTaskQueue } from '@tahini/task-queues'
import { ExecutionStatus, Status } from '@tahini/utils'

const { createRepo, sleep } = createTest()

test('waitUntilArtifactParentsFinishedParentSteps=true - ensure it does not do nothing when there is only a single step and single artifact', async () => {
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
            waitUntilArtifactParentsFinishedParentSteps: true,
            onArtifact: async () => {
              return { executionStatus: ExecutionStatus.done, status: Status.passed }
            },
          }),
        })(),
      ]),
    },
  })

  const { passed } = await runCi()
  expect(passed).toBeTruthy()
})

test('waitUntilArtifactParentsFinishedParentSteps=false - ensure it does not do nothing when there is only a single step and single artifact', async () => {
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
            waitUntilArtifactParentsFinishedParentSteps: false,
            onArtifact: async () => {
              return { executionStatus: ExecutionStatus.done, status: Status.passed }
            },
          }),
        })(),
      ]),
    },
  })

  const { passed } = await runCi()
  expect(passed).toBeTruthy()
})

test('waitUntilArtifactParentsFinishedParentSteps=true - ensure it does not do nothing when there is only a single step', async () => {
  const { runCi } = await createRepo({
    repo: {
      packages: [
        {
          name: 'parent-artifact',
          version: '1.0.0',
        },
        {
          name: 'child-artifact',
          version: '2.0.0',
          dependencies: {
            'parent-artifact': '1.0.0',
          },
        },
      ],
    },
    configurations: {
      steps: createLinearStepsGraph([
        createStepExperimental({
          stepName: 'step1',
          taskQueueClass: LocalSequentalTaskQueue,
          run: () => ({
            waitUntilArtifactParentsFinishedParentSteps: true,
            onArtifact: async () => {
              return { executionStatus: ExecutionStatus.done, status: Status.passed }
            },
          }),
        })(),
      ]),
    },
  })

  const { passed } = await runCi()
  expect(passed).toBeTruthy()
})

test('waitUntilArtifactParentsFinishedParentSteps=false - ensure it does not do nothing when there is only a single step', async () => {
  const { runCi } = await createRepo({
    repo: {
      packages: [
        {
          name: 'parent-artifact',
          version: '1.0.0',
        },
        {
          name: 'child-artifact',
          version: '2.0.0',
          dependencies: {
            'parent-artifact': '1.0.0',
          },
        },
      ],
    },
    configurations: {
      steps: createLinearStepsGraph([
        createStepExperimental({
          stepName: 'step1',
          taskQueueClass: LocalSequentalTaskQueue,
          run: () => ({
            waitUntilArtifactParentsFinishedParentSteps: false,
            onArtifact: async () => {
              return { executionStatus: ExecutionStatus.done, status: Status.passed }
            },
          }),
        })(),
      ]),
    },
  })

  const { passed } = await runCi()
  expect(passed).toBeTruthy()
})

test('waitUntilArtifactParentsFinishedParentSteps=true - ensure we wait', async () => {
  expect.assertions(2)

  const { runCi } = await createRepo(toActualName => ({
    repo: {
      packages: [
        {
          name: 'parent-artifact',
          version: '1.0.0',
        },
        {
          name: 'child-artifact',
          version: '2.0.0',
          dependencies: {
            'parent-artifact': '1.0.0',
          },
        },
      ],
    },
    configurations: {
      steps: createLinearStepsGraph([
        createStepExperimental({
          stepName: 'parent-step',
          taskQueueClass: LocalSequentalTaskQueue,
          run: () => ({
            onArtifact: async ({ artifact }) => {
              if (artifact.data.artifact.packageJson.name === toActualName('parent-artifact')) {
                await sleep(3000)
              }
              return { executionStatus: ExecutionStatus.done, status: Status.passed }
            },
          }),
        })(),
        createStepExperimental({
          stepName: 'child-step',
          taskQueueClass: LocalSequentalTaskQueue,
          run: ({ getState, steps }) => ({
            waitUntilArtifactParentsFinishedParentSteps: true,
            onArtifact: async ({ artifact }) => {
              if (artifact.data.artifact.packageJson.name === toActualName('child-artifact')) {
                expect(
                  getState().getResult({
                    artifactName: toActualName('parent-artifact'),
                    stepId: steps.find(s => s.data.stepInfo.stepName === 'parent-step')?.data.stepInfo.stepId!,
                  }).executionStatus,
                ).toEqual(ExecutionStatus.done)
              }
            },
          }),
        })(),
      ]),
    },
  }))

  const { passed } = await runCi()
  expect(passed).toBeTruthy()
})

test('waitUntilArtifactParentsFinishedParentSteps=false - ensure we do not wait', async () => {
  expect.assertions(2)

  const { runCi } = await createRepo(toActualName => ({
    repo: {
      packages: [
        {
          name: 'parent-artifact',
          version: '1.0.0',
        },
        {
          name: 'child-artifact',
          version: '2.0.0',
          dependencies: {
            'parent-artifact': '1.0.0',
          },
        },
      ],
    },
    configurations: {
      steps: createLinearStepsGraph([
        createStepExperimental({
          stepName: 'parent-step',
          taskQueueClass: LocalSequentalTaskQueue,
          run: () => ({
            onArtifact: async ({ artifact }) => {
              if (artifact.data.artifact.packageJson.name === toActualName('parent-artifact')) {
                await sleep(3000)
              }
              return { executionStatus: ExecutionStatus.done, status: Status.passed }
            },
          }),
        })(),
        createStepExperimental({
          stepName: 'child-step',
          taskQueueClass: LocalSequentalTaskQueue,
          run: ({ getState, steps }) => ({
            waitUntilArtifactParentsFinishedParentSteps: false,
            onArtifact: async ({ artifact }) => {
              if (artifact.data.artifact.packageJson.name === toActualName('child-artifact')) {
                expect(
                  getState().getResult({
                    artifactName: toActualName('parent-artifact'),
                    stepId: steps.find(s => s.data.stepInfo.stepName === 'parent-step')?.data.stepInfo.stepId!,
                  }).executionStatus,
                ).not.toEqual(ExecutionStatus.done)
              }
            },
          }),
        })(),
      ]),
    },
  }))

  const { passed } = await runCi()
  expect(passed).toBeTruthy()
})
