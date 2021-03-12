import { skipAsPassedIfStepResultPassedInCacheConstrain } from '@era-ci/constrains'
import { createStep } from '@era-ci/core'
import { createTest, isDeepSubset } from '@era-ci/e2e-tests-infra'
import { createLinearStepsGraph } from '@era-ci/steps-graph'
import { LocalSequentalTaskQueue } from '@era-ci/task-queues'
import { ExecutionStatus, Status } from '@era-ci/utils/src'
import { expect, test } from '@jest/globals'
import fs from 'fs'
import path from 'path'
import execa from 'execa'

const { createRepo } = createTest()

test('yarn1 - run flow, move the package, then in second flow, the step is skipped-as-passed', async () => {
  const { runCi, repoPath, toActualName } = await createRepo({
    repo: {
      packages: [
        {
          name: 'a',
          version: '1.0.0',
        },
        {
          name: 'b',
          version: '1.0.0',
          dependencies: {
            a: '1.0.0',
          },
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
            stepLogic: () => Promise.resolve(),
            stepConstrains: [
              skipAsPassedIfStepResultPassedInCacheConstrain({
                stepNameToSearchInCache: 'step1',
              }),
            ],
          }),
        })(),
      ]),
    },
  })

  await runCi()

  await fs.promises.rename(
    path.join(repoPath, 'packages', toActualName('a')),
    path.join(repoPath, 'packages', toActualName('a') + '-new-dir'),
  )
  await execa.command(`git add --all && git commit -m wip && git push`, {
    cwd: repoPath,
    shell: true,
  })

  const { jsonReport } = await runCi()

  expect(
    isDeepSubset(jsonReport, {
      flowResult: {
        executionStatus: ExecutionStatus.aborted,
        status: Status.skippedAsPassed,
      },
    }),
  ).toBeTruthy()
})
