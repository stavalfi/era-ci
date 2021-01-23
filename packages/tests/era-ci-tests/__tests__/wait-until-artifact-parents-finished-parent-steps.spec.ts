import { createStepExperimental, getResult } from '@era-ci/core'
import { createTest } from '@era-ci/e2e-tests-infra'
import { createLinearStepsGraph } from '@era-ci/steps-graph'
import { LocalSequentalTaskQueue } from '@era-ci/task-queues'
import { ExecutionStatus, Status } from '@era-ci/utils'
import expect from 'expect'
import { ExecutionActionTypes } from '../../../core/dist/src/steps-execution/actions'

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
          stepGroup: 'parent-step',
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

test('waitUntilArtifactParentsFinishedParentSteps=false - ensure we do not wait', async () => {
  const { runCi, toActualName } = await createRepo(toActualName => ({
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
                await sleep(3000)
              }
              return { executionStatus: ExecutionStatus.done, status: Status.passed }
            },
          }),
        })(),
        createStepExperimental({
          stepName: 'child-step',
          stepGroup: 'child-step',
          taskQueueClass: LocalSequentalTaskQueue,
          run: () => ({
            waitUntilArtifactParentsFinishedParentSteps: false,
            onArtifact: () => Promise.resolve(),
          }),
        })(),
      ]),
    },
  }))

  const { flowEvents } = await runCi()

  const mapped = flowEvents.map(e => {
    if (e.event.type === ExecutionActionTypes.artifactStep) {
      return `${e.event.type}--${e.event.payload.step.data.stepInfo.stepName}--${e.event.payload.artifact.data.artifact.packageJson.name}--${e.event.payload.artifactStepResult.executionStatus}`
    }
    return ''
  })

  const indexes = [
    mapped.findIndex(
      e =>
        e ===
        `${ExecutionActionTypes.artifactStep}--child-step--${toActualName('child-artifact')}--${
          ExecutionStatus.running
        }`,
    ),
    mapped.findIndex(
      e =>
        e ===
        `${ExecutionActionTypes.artifactStep}--parent-step--${toActualName('parent-artifact')}--${
          ExecutionStatus.done
        }`,
    ),
  ]

  expect(indexes).toEqual(indexes.filter(i => i > -1).sort((a, b) => a - b))
})
