import { createTest } from '@era-ci/e2e-tests-infra'
import { buildRoot, installRoot } from '@era-ci/steps'
import { createLinearStepsGraph } from '@era-ci/steps-graph'
import { taskWorkerTaskQueue } from '@era-ci/task-queues'
import { ExecutionStatus, Result, Status } from '@era-ci/utils'
import chance from 'chance'
import execa from 'execa'
import { DeepPartial } from 'ts-essentials'

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
      rootPackageJson: {
        scripts: {
          build: 'echo building...',
        },
      },
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

  expect(jsonReport.stepsResultOfArtifactsByStep[1].data.stepResult).toMatchObject<DeepPartial<Result>>({
    executionStatus: ExecutionStatus.done,
    status: Status.passed,
    notes: [],
    errors: [],
  })
})

test('install failed so build-step should skip-as-failed', async () => {
  const { runCi, repoPath } = await createRepo({
    repo: {
      packages: [
        {
          name: 'a',
          version: '1.0.0',
        },
      ],
      rootPackageJson: {
        scripts: {
          build: 'echo building...',
        },
      },
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

  // it will cause the install-step to fail because the yarn.lock will be modified in the CI
  await execa.command(`yarn add -W empty-npm-package && git checkout -- yarn.lock && git commit -am wip && git push`, {
    cwd: repoPath,
    shell: true,
  })

  const { jsonReport } = await runCi()

  expect(jsonReport.stepsResultOfArtifactsByStep[1].data.stepResult).toMatchObject<DeepPartial<Result>>({
    executionStatus: ExecutionStatus.aborted,
    status: Status.skippedAsFailed,
    notes: [`step: "${jsonReport.steps[0].data.stepInfo.displayName}" failed in this flow`],
    errors: [],
  })
})

test('reproduce bug: first-flow: install failed so build-step should skip-as-failed, second-flow: build-step should have a note that the install-step failed in this flow (also)', async () => {
  const { runCi, repoPath } = await createRepo({
    repo: {
      packages: [
        {
          name: 'a',
          version: '1.0.0',
        },
      ],
      rootPackageJson: {
        scripts: {
          build: 'echo building...',
        },
      },
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

  // it will cause the install-step to fail because the yarn.lock will be modified in the CI
  await execa.command(`yarn add -W empty-npm-package && git checkout -- yarn.lock && git commit -am wip && git push`, {
    cwd: repoPath,
    shell: true,
  })

  await runCi()

  // the last flow run "yarn install" so the yarn.lock was modified. we want to remove this change and reproduce the exact same error from the last flow
  await execa.command(`git checkout -- yarn.lock`, {
    cwd: repoPath,
    shell: true,
  })

  const { jsonReport } = await runCi()

  expect(jsonReport.stepsResultOfArtifactsByStep[1].data.stepResult).toMatchObject<DeepPartial<Result>>({
    executionStatus: ExecutionStatus.aborted,
    status: Status.skippedAsFailed,
    notes: [`step: "${jsonReport.steps[0].data.stepInfo.displayName}" failed in this and 1 more flows`],
    errors: [],
  })
})
