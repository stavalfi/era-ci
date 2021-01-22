import { createStepExperimental, TaskQueueBase } from '@era-ci/core'
import { createRepo, createTest, test } from '@era-ci/e2e-tests-infra'
import { createLinearStepsGraph } from '@era-ci/steps-graph'
import { ExecutionStatus, Status } from '@era-ci/utils'
import { EventEmitter } from 'events'
import expect from 'expect'

createTest(test)

test('no steps and no task-queues in config is considered as valid', async t => {
  t.timeout(50 * 1000)

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
      taskQueues: [],
      steps: [],
    },
    dontAddReportSteps: true,
  })

  const { passed } = await runCi()

  expect(passed).toBeTruthy()
})

test('should throw error if user forgot to declare a task-queue which one of the steps needs', async t => {
  t.timeout(50 * 1000)

  class MissingTaskQueue implements TaskQueueBase<void, void> {
    public readonly eventEmitter = new EventEmitter()
    async cleanup() {
      //
    }
  }

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
      taskQueues: [], // we "forgot" to declare LocalSequentalTaskQueue so we expect an error.
      steps: createLinearStepsGraph([
        createStepExperimental({
          stepName: 'step1',
          stepGroup: 'step1',
          taskQueueClass: MissingTaskQueue,
          run: () => ({
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
