import { createStep } from '@era-ci/core'
import { createTest, isDeepSubset } from '@era-ci/e2e-tests-infra'
import {
  buildRoot,
  installRoot,
  JsonReport,
  npmPublish,
  NpmScopeAccess,
  test as testStep,
  validatePackages,
} from '@era-ci/steps'
import { createLinearStepsGraph } from '@era-ci/steps-graph'
import { LocalSequentalTaskQueue, taskWorkerTaskQueue } from '@era-ci/task-queues'
import { ExecutionStatus, PackageJson, Status, TargetType } from '@era-ci/utils'
import chance from 'chance'
import execa from 'execa'
import { test, expect } from '@jest/globals'
import fs from 'fs'
import path from 'path'
import type { DeepPartial } from 'ts-essentials'

const { createRepo, getResources } = createTest()

test(`happy-flow - should pass`, async () => {
  const { runCi } = await createRepo({
    repo: {
      packages: [
        {
          name: 'a',
          version: '1.0.0',
          targetType: TargetType.npm,
        },
      ],
    },
    configurations: {
      steps: createLinearStepsGraph([
        npmPublish({
          isStepEnabled: true,
          npmScopeAccess: NpmScopeAccess.public,
          registry: getResources().npmRegistry.address,
          registryAuth: getResources().npmRegistry.auth,
        }),
      ]),
    },
  })
  const { published } = await runCi()

  expect(published.get('a')?.npm.versions).toEqual(['1.0.0'])
})

test('reproduce bug - wrong step statuses', async () => {
  const { runCi, toActualName } = await createRepo({
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
        npmPublish({
          isStepEnabled: false,
          npmScopeAccess: NpmScopeAccess.public,
          registry: 'wont-be-used',
          registryAuth: {
            email: '',
            password: '',
            username: '',
          },
        }),
      ]),
    },
  })
  const { jsonReport } = await runCi()

  const expectedJsonReport: DeepPartial<JsonReport> = {
    flowResult: {
      executionStatus: ExecutionStatus.done,
      status: Status.passed,
    },
    stepsResultOfArtifactsByStep: [
      {
        data: {
          stepInfo: {
            stepName: 'step1',
          },
          stepResult: {
            executionStatus: ExecutionStatus.done,
            status: Status.passed,
          },
          artifactsResult: [
            {
              data: {
                artifact: {
                  packageJson: {
                    name: toActualName('a'),
                  },
                },
                artifactStepResult: {
                  executionStatus: ExecutionStatus.done,
                  status: Status.passed,
                },
              },
            },
          ],
        },
      },
      {
        data: {
          stepInfo: {
            stepName: 'npm-publish',
          },
          stepResult: {
            executionStatus: ExecutionStatus.aborted,
            status: Status.skippedAsPassed,
          },
          artifactsResult: [
            {
              data: {
                artifact: {
                  packageJson: {
                    name: toActualName('a'),
                  },
                },
                artifactStepResult: {
                  executionStatus: ExecutionStatus.aborted,
                  status: Status.skippedAsPassed,
                },
              },
            },
          ],
        },
      },
    ],
  }

  expect(isDeepSubset(jsonReport, expectedJsonReport)).toBeTruthy()
})

test('reproduce bug - step is invoked multiple times', async () => {
  const { runCi } = await createRepo({
    repo: {
      packages: [
        {
          name: 'a',
          version: '1.0.0',
          targetType: TargetType.npm,
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
        validatePackages(),
        installRoot({ isStepEnabled: true }),
        buildRoot({ isStepEnabled: true, scriptName: 'build' }),
        testStep({ scriptName: 'test', isStepEnabled: true }),
        npmPublish({
          isStepEnabled: true,
          npmScopeAccess: NpmScopeAccess.public,
          registry: getResources().npmRegistry.address,
          registryAuth: getResources().npmRegistry.auth,
        }),
      ]),
    },
  })
  const { jsonReport } = await runCi()

  const expectedJsonReport: DeepPartial<JsonReport> = {
    flowResult: {
      executionStatus: ExecutionStatus.done,
      status: Status.passed,
    },
  }

  expect(isDeepSubset(jsonReport, expectedJsonReport)).toBeTruthy()
})

test(`single run - if a depends on b, a.package.json.dep.b.version should be the version of b which is published rigth now`, async () => {
  const { runCi, repoPath, toActualName } = await createRepo({
    repo: {
      packages: [
        {
          name: 'b',
          version: '1.0.0',
          targetType: TargetType.npm,
        },
        {
          name: 'a',
          version: '1.0.0',
          targetType: TargetType.npm,
          dependencies: {
            b: '1.0.0',
          },
        },
      ],
    },
    configurations: {
      steps: createLinearStepsGraph([
        npmPublish({
          isStepEnabled: true,
          npmScopeAccess: NpmScopeAccess.public,
          registry: getResources().npmRegistry.address,
          registryAuth: getResources().npmRegistry.auth,
        }),
      ]),
    },
  })

  const flow1 = await runCi()

  expect(flow1.published.get('a')?.npm.versions).toEqual(['1.0.0'])
  expect(flow1.published.get('b')?.npm.versions).toEqual(['1.0.0'])

  const result1 = await execa.command(
    `npm view ${toActualName('a')} --json --registry ${getResources().npmRegistry.address}`,
    {
      cwd: repoPath,
    },
  )

  const aDeps1 = JSON.parse(result1.stdout).dependencies

  expect(aDeps1[toActualName('b')]).toEqual('1.0.0')
})

// TODO: need to implement :)
test.skip(`two runs - if a depends on b, a.package.json.dep.b.version should be the version of b which is published rigth now`, async () => {
  const { runCi, repoPath, toActualName } = await createRepo({
    repo: {
      packages: [
        {
          name: 'b',
          version: '1.0.0',
          targetType: TargetType.npm,
        },
        {
          name: 'a',
          version: '1.0.0',
          targetType: TargetType.npm,
          dependencies: {
            b: '1.0.0',
          },
        },
      ],
    },
    configurations: {
      steps: createLinearStepsGraph([
        npmPublish({
          isStepEnabled: true,
          npmScopeAccess: NpmScopeAccess.public,
          registry: getResources().npmRegistry.address,
          registryAuth: getResources().npmRegistry.auth,
        }),
      ]),
    },
  })

  await runCi()

  await execa.command(`echo hi > a.txt && git add --all && git commit -am wip`, { cwd: repoPath, shell: true })

  const flow2 = await runCi()

  expect(flow2.published.get('a')?.npm.versions).toEqual(['1.0.0', '1.0.1'])
  expect(flow2.published.get('b')?.npm.versions).toEqual(['1.0.0', '1.0.1'])

  const result2 = await execa.command(
    `npm view ${toActualName('a')} --json --registry ${getResources().npmRegistry.address}`,
    {
      cwd: repoPath,
    },
  )

  const aDeps2 = JSON.parse(result2.stdout).dependencies

  expect(aDeps2[toActualName('b')]).toEqual('1.0.1') // <<-- this is the purpose of this test

  // ensure we don't mutate the repository
  const aPackageJson: PackageJson = JSON.parse(
    await fs.promises.readFile(path.join(repoPath, 'packages', toActualName('a'), 'package.json'), 'utf-8'),
  )
  expect(aPackageJson.dependencies?.[toActualName('b')]).toEqual('1.0.0')
})
