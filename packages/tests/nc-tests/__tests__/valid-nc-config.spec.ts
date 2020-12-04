import { createStep, RunStrategy } from '@tahini/core'
import { createTest } from '@tahini/e2e-tests-infra'
import { ExecutionStatus, Status } from '@tahini/utils'
import { LocalSequentalTaskQueue } from '@tahini/task-queues'
import { createLinearStepsGraph } from '@tahini/steps-graph'

const { createRepo } = createTest()

test('no steps and no task-queues in config is considered as valid', async () => {
  const { runCi } = await createRepo({
    packages: [
      {
        name: 'a',
        version: '1.0.0',
      },
    ],
  })

  const { passed } = await runCi(
    {
      taskQueues: [],
      steps: [],
    },
    {
      dontAddReportSteps: true,
    },
  )

  expect(passed).toBeTruthy()
})

test('should throw error if user forgot to declare a task-queue which one of the steps needs', async () => {
  const { runCi } = await createRepo({
    packages: [
      {
        name: 'a',
        version: '1.0.0',
      },
    ],
  })

  const { flowLogs, passed } = await runCi({
    taskQueues: [], // we "forgot" to declare LocalSequentalTaskQueue
    steps: createLinearStepsGraph([
      createStep({
        stepName: 'step1',
        taskQueueClass: LocalSequentalTaskQueue,
        run: {
          runStrategy: RunStrategy.perArtifact,
          runStepOnArtifact: async () => {
            return { errors: [], notes: [], executionStatus: ExecutionStatus.done, status: Status.passed }
          },
        },
      })(),
    ]),
  })

  expect(flowLogs).toEqual(
    expect.stringContaining(
      `can't find task-queue: "${LocalSequentalTaskQueue.name}" for step: "step1" needs. did you forgot to declare the task-queue in the configuration file?`,
    ),
  )
  expect(passed).toBeFalsy()
})
