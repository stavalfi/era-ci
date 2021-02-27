import { createTest } from '@era-ci/e2e-tests-infra'
import { test as testStep } from '@era-ci/steps'
import { createLinearStepsGraph } from '@era-ci/steps-graph'
import { taskWorkerTaskQueue } from '@era-ci/task-queues'
import { ExecutionStatus, Result, Status } from '@era-ci/utils'
import chance from 'chance'
import { DeepPartial } from 'ts-essentials'

const { createRepo, getResources } = createTest()

test('run flow once - should pass without notes', async () => {
  const queueName = `queue-${chance().hash().slice(0, 8)}`
  const { runCi } = await createRepo({
    repo: {
      packages: [
        {
          name: 'a',
          version: '1.0.0',
          scripts: {
            test: `echo hi`,
          },
        },
      ],
    },
    configurations: {
      taskQueues: [
        taskWorkerTaskQueue({
          queueName,
          redis: {
            url: getResources().redisServerUrl,
          },
        }),
      ],
      steps: createLinearStepsGraph([
        testStep({
          isStepEnabled: true,
          scriptName: 'test',
        }),
      ]),
    },
  })

  const { jsonReport } = await runCi()

  expect(jsonReport.stepsResultOfArtifactsByArtifact[0].data.stepsResult[0].data.artifactStepResult).toMatchObject<
    DeepPartial<Result>
  >({
    executionStatus: ExecutionStatus.done,
    status: Status.passed,
    notes: [],
    errors: [],
  })
})

test('run flow twice - second time should skip-as-passed with a note that indicates that the tests already passed in first flow', async () => {
  const queueName = `queue-${chance().hash().slice(0, 8)}`
  const { runCi } = await createRepo({
    repo: {
      packages: [
        {
          name: 'a',
          version: '1.0.0',
          scripts: {
            test: `echo hi`,
          },
        },
      ],
    },
    configurations: {
      taskQueues: [
        taskWorkerTaskQueue({
          queueName,
          redis: {
            url: getResources().redisServerUrl,
          },
        }),
      ],
      steps: createLinearStepsGraph([
        testStep({
          isStepEnabled: true,
          scriptName: 'test',
        }),
      ]),
    },
  })

  const result1 = await runCi()

  const { jsonReport } = await runCi()

  expect(jsonReport.stepsResultOfArtifactsByArtifact[0].data.stepsResult[0].data.artifactStepResult).toMatchObject<
    DeepPartial<Result>
  >({
    executionStatus: ExecutionStatus.aborted,
    status: Status.skippedAsPassed,
    notes: [`step: "${jsonReport.steps[0].data.stepInfo.displayName}" passed in flow: ${result1.flowId}`],
    errors: [],
  })
})

test('run flow three times - third time should skip-as-passed with a note that indicates that the tests already passed in first flow', async () => {
  const queueName = `queue-${chance().hash().slice(0, 8)}`
  const { runCi } = await createRepo({
    repo: {
      packages: [
        {
          name: 'a',
          version: '1.0.0',
          scripts: {
            test: `echo hi`,
          },
        },
      ],
    },
    configurations: {
      taskQueues: [
        taskWorkerTaskQueue({
          queueName,
          redis: {
            url: getResources().redisServerUrl,
          },
        }),
      ],
      steps: createLinearStepsGraph([
        testStep({
          isStepEnabled: true,
          scriptName: 'test',
        }),
      ]),
    },
  })

  const result1 = await runCi()

  await runCi()

  const { jsonReport } = await runCi()

  expect(jsonReport.stepsResultOfArtifactsByArtifact[0].data.stepsResult[0].data.artifactStepResult).toMatchObject<
    DeepPartial<Result>
  >({
    executionStatus: ExecutionStatus.aborted,
    status: Status.skippedAsPassed,
    notes: [`step: "${jsonReport.steps[0].data.stepInfo.displayName}" passed in flow: ${result1.flowId}`],
    errors: [],
  })
})
