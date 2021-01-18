import { createStepExperimental, getResult } from '@era-ci/core'
import { createRepo, createTest, test } from '@era-ci/e2e-tests-infra'
import { createLinearStepsGraph } from '@era-ci/steps-graph'
import { LocalSequentalTaskQueue } from '@era-ci/task-queues'
import { ExecutionStatus, Status } from '@era-ci/utils'
import expect from 'expect'

createTest(test)

test('waitUntilArtifactParentsFinishedParentSteps=true - ensure it does not do nothing when there is only a single step and single artifact', async t => {
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

test('waitUntilArtifactParentsFinishedParentSteps=false - ensure it does not do nothing when there is only a single step and single artifact', async t => {
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

test('waitUntilArtifactParentsFinishedParentSteps=true - ensure it does not do nothing when there is only a single step', async t => {
  const { runCi } = await createRepo(t, {
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
          stepGroup: 'step1',
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

test('waitUntilArtifactParentsFinishedParentSteps=false - ensure it does not do nothing when there is only a single step', async t => {
  const { runCi } = await createRepo(t, {
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
          stepGroup: 'step1',
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

test('waitUntilArtifactParentsFinishedParentSteps=true - ensure we wait', async t => {
  expect.assertions(2)

  const { runCi } = await createRepo(t, toActualName => ({
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
          stepGroup: 'parent-step',
          taskQueueClass: LocalSequentalTaskQueue,
          run: () => ({
            onArtifact: async ({ artifact }) => {
              if (artifact.data.artifact.packageJson.name === toActualName('parent-artifact')) {
                await t.context.sleep(3000)
              }
              return { executionStatus: ExecutionStatus.done, status: Status.passed }
            },
          }),
        })(),
        createStepExperimental({
          stepName: 'child-step',
          stepGroup: 'child-step',
          taskQueueClass: LocalSequentalTaskQueue,
          run: ({ getState, steps, artifacts }) => ({
            waitUntilArtifactParentsFinishedParentSteps: true,
            onArtifact: async ({ artifact }) => {
              if (artifact.data.artifact.packageJson.name === toActualName('child-artifact')) {
                expect(
                  getResult({
                    state: getState(),
                    steps,
                    artifacts,
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

test('waitUntilArtifactParentsFinishedParentSteps=false - ensure we do not wait', async t => {
  expect.assertions(2)

  const { runCi } = await createRepo(t, toActualName => ({
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
          stepGroup: 'parent-step',
          taskQueueClass: LocalSequentalTaskQueue,
          run: () => ({
            onArtifact: async ({ artifact }) => {
              if (artifact.data.artifact.packageJson.name === toActualName('parent-artifact')) {
                await t.context.sleep(3000)
              }
              return { executionStatus: ExecutionStatus.done, status: Status.passed }
            },
          }),
        })(),
        createStepExperimental({
          stepName: 'child-step',
          stepGroup: 'child-step',
          taskQueueClass: LocalSequentalTaskQueue,
          run: ({ getState, steps, artifacts }) => ({
            waitUntilArtifactParentsFinishedParentSteps: false,
            onArtifact: async ({ artifact }) => {
              if (artifact.data.artifact.packageJson.name === toActualName('child-artifact')) {
                expect(
                  getResult({
                    state: getState(),
                    steps,
                    artifacts,
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
