import { createStep } from '@era-ci/core'
import { createTest } from '@era-ci/e2e-tests-infra'
import { createLinearStepsGraph } from '@era-ci/steps-graph'
import { LocalSequentalTaskQueue } from '@era-ci/task-queues'
import { ExecutionStatus, Status } from '@era-ci/utils'
import { expect, test } from '@jest/globals'
import _ from 'lodash'

const { createRepo } = createTest()

test('no packages, no steps', async () => {
  const { runCi } = await createRepo({
    repo: {
      packages: [],
    },
    configurations: {
      steps: [],
    },
    dontAddReportSteps: true,
  })
  const flows = await Promise.all([runCi(), runCi(), runCi(), runCi(), runCi(), runCi()])

  for (const result of flows) {
    expect(result.passed).toBeTruthy()
  }
})

test('multiple packages, single step', async () => {
  const { runCi } = await createRepo({
    repo: {
      packages: _.range(0, 5).map(i => ({
        name: `a${i}`,
        version: '1.0.0',
      })),
    },
    configurations: {
      steps: createLinearStepsGraph([
        createStep({
          stepName: 'step1',
          stepGroup: 'step1',
          taskQueueClass: LocalSequentalTaskQueue,
          run: async () => ({
            onArtifact: async () => {
              return { executionStatus: ExecutionStatus.done, status: Status.passed }
            },
          }),
        })(),
      ]),
    },
  })
  const flows = await Promise.all([runCi(), runCi(), runCi(), runCi(), runCi(), runCi()])

  for (const result of flows) {
    expect(result.passed).toBeTruthy()
  }
})

test('multiple packages, multiple steps', async () => {
  const { runCi } = await createRepo({
    repo: {
      packages: _.range(0, 5).map(i => ({
        name: `a${i}`,
        version: '1.0.0',
      })),
    },
    configurations: {
      steps: createLinearStepsGraph(
        _.range(0, 5).map(i =>
          createStep({
            stepName: `step${i}`,
            stepGroup: `step${i}`,
            taskQueueClass: LocalSequentalTaskQueue,
            run: async () => ({
              onArtifact: async () => {
                return { executionStatus: ExecutionStatus.done, status: Status.passed }
              },
            }),
          })(),
        ),
      ),
    },
  })
  const flows = await Promise.all([runCi(), runCi(), runCi(), runCi(), runCi(), runCi()])

  for (const result of flows) {
    expect(result.passed).toBeTruthy()
  }
})
