import { createStep, TaskQueueBase } from '@era-ci/core'
import { createTest } from '@era-ci/e2e-tests-infra'
import { createLinearStepsGraph } from '@era-ci/steps-graph'
import { ExecutionStatus, Status } from '@era-ci/utils'
import { EventEmitter } from 'events'
import expect from 'expect'

const { createRepo } = createTest()

test('no steps and no task-queues in config is considered as valid', async () => {
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
      taskQueues: [],
      steps: [],
    },
    dontAddReportSteps: true,
  })

  const { passed } = await runCi()

  expect(passed).toBeTruthy()
})

test('should throw error if user forgot to declare a task-queue which one of the steps needs', async () => {
  class MissingTaskQueue implements TaskQueueBase<void, void> {
    public readonly eventEmitter = new EventEmitter()
    async cleanup() {
      //
    }
  }

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
      taskQueues: [], // we "forgot" to declare LocalSequentalTaskQueue so we expect an error.
      steps: createLinearStepsGraph([
        createStep({
          stepName: 'step1',
          stepGroup: 'step1',
          taskQueueClass: MissingTaskQueue,
          run: async () => ({
            onArtifact: async () => ({ executionStatus: ExecutionStatus.done, status: Status.passed }),
          }),
        })(),
      ]),
    },
  })

  const { flowLogs, passed } = await runCi()

  expect(flowLogs).toEqual(
    expect.stringContaining(
      `can't find task-queue: "${MissingTaskQueue.name}" for step: "step1" needs. did you forgot to declare the task-queue in the configuration file?`,
    ),
  )
  expect(passed).toBeFalsy()
})
