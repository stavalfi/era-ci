import { createStep, RunStrategy, TaskQueueBase } from '@tahini/core'
import { createTest } from '@tahini/e2e-tests-infra'
import { createLinearStepsGraph } from '@tahini/steps-graph'
import { ExecutionStatus, Status } from '@tahini/utils'
import { EventEmitter } from 'events'

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
  class MissingTaskQueue implements TaskQueueBase<void> {
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
          taskQueueClass: MissingTaskQueue,
          run: {
            runStrategy: RunStrategy.perArtifact,
            runStepOnArtifact: async () => {
              return { errors: [], notes: [], executionStatus: ExecutionStatus.done, status: Status.passed }
            },
          },
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
