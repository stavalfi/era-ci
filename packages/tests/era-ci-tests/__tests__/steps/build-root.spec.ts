import { createTest } from '@era-ci/e2e-tests-infra'
import { buildRoot, installRoot } from '@era-ci/steps'
import { createLinearStepsGraph } from '@era-ci/steps-graph'
import { ExecutionStatus, Result, Status } from '@era-ci/utils'
import fs from 'fs'
import path from 'path'
import { DeepPartial } from 'ts-essentials'
import { taskWorkerTaskQueue } from '@era-ci/task-queues'
import chance from 'chance'

const { createRepo, getResources } = createTest()

test('should pass without notes', async () => {
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
      taskQueues: [
        taskWorkerTaskQueue({
          queueName: `queue-${chance().hash().slice(0, 8)}`,
          redis: {
            url: getResources().redisServerUrl,
          },
        }),
      ],
      steps: createLinearStepsGraph([
        installRoot({ isStepEnabled: true }),
        buildRoot({
          isStepEnabled: true,
          scriptName: 'build',
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

test.only('install failed so build should skip-as-failed', async () => {
  const { runCi, repoPath } = await createRepo({
    repo: {
      packages: [
        {
          name: 'a',
          version: '1.0.0',
        },
      ],
    },
    configurations: {
      taskQueues: [
        taskWorkerTaskQueue({
          queueName: `queue-${chance().hash().slice(0, 8)}`,
          redis: {
            url: getResources().redisServerUrl,
          },
        }),
      ],
      steps: createLinearStepsGraph([
        installRoot({ isStepEnabled: true }),
        buildRoot({
          isStepEnabled: true,
          scriptName: 'build',
        }),
      ]),
    },
  })

  // it will cause the install-step to fail
  await fs.promises.writeFile(path.join(repoPath, 'uncommited-new-file'), 'lalala', 'utf-8')

  const { jsonReport } = await runCi()

  expect(jsonReport.stepsResultOfArtifactsByArtifact[0].data.stepsResult[1].data.artifactStepResult).toMatchObject<
    DeepPartial<Result>
  >({
    executionStatus: ExecutionStatus.aborted,
    status: Status.skippedAsFailed,
    notes: [`step: "${jsonReport.steps[0].data.stepInfo.displayName}" failed in flow: this-flow`],
    errors: [],
  })
})
