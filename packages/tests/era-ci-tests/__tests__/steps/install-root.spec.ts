import { createRepo, createTest, DeepPartial, isDeepSubset, test } from '@era-ci/e2e-tests-infra'
import { installRoot, JsonReport, validatePackages } from '@era-ci/steps'
import { createLinearStepsGraph } from '@era-ci/steps-graph'
import { ExecutionStatus, Status } from '@era-ci/utils'
import expect from 'expect'

createTest(test)

test('install-step should pass', async t => {
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
      steps: createLinearStepsGraph([validatePackages(), installRoot({ isStepEnabled: true })]),
    },
  })
  const { jsonReport } = await runCi()

  const expectedJsonReport: DeepPartial<JsonReport> = {
    flowResult: {
      executionStatus: ExecutionStatus.done,
      status: Status.passed,
    },
  }

  expect(isDeepSubset(t, jsonReport, expectedJsonReport)).toBeTruthy()
})

test('install-step should abort-as-passed because it depends on other step which is not defined: validatePackages', async t => {
  const { runCi, toActualName } = await createRepo(t, {
    repo: {
      packages: [
        {
          name: 'a',
          version: '1.0.0',
        },
      ],
    },
    configurations: {
      steps: createLinearStepsGraph([installRoot({ isStepEnabled: true })]),
    },
  })
  const { jsonReport } = await runCi()

  const expectedJsonReport: DeepPartial<JsonReport> = {
    flowResult: {
      errors: [],
      notes: [],
      executionStatus: ExecutionStatus.aborted,
      status: Status.skippedAsPassed,
    },
    stepsResultOfArtifactsByStep: [
      {
        data: {
          stepExecutionStatus: ExecutionStatus.aborted,
          stepInfo: {
            stepName: 'install-root',
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
                  errors: [],
                  notes: [],
                },
              },
            },
          ],
        },
      },
    ],
  }

  expect(isDeepSubset(t, jsonReport, expectedJsonReport)).toBeTruthy()
})
