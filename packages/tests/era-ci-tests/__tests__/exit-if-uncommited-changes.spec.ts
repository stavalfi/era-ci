import { createStep } from '@era-ci/core'
import { createTest } from '@era-ci/e2e-tests-infra'
import { createLinearStepsGraph } from '@era-ci/steps-graph'
import { LocalSequentalTaskQueue } from '@era-ci/task-queues'
import { expect, test } from '@jest/globals'
import fs from 'fs'
import path from 'path'

const { createRepo } = createTest()

test('exit early if there are untracked files and ensure any step did not run', async () => {
  const fn = jest.fn()

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
      steps: createLinearStepsGraph([
        createStep({
          stepName: 'step1',
          stepGroup: 'step1',
          taskQueueClass: LocalSequentalTaskQueue,
          run: async () => ({
            stepLogic: fn,
          }),
        })(),
      ]),
    },
  })

  await fs.promises.writeFile(path.join(repoPath, 'new-untracked-file'), 'lala', 'utf-8')

  const { passed } = await runCi()

  expect(passed).toBeFalsy()
  expect(fn).not.toBeCalled()
})

test('exit early if there are mondified uncommited files and ensure any step did not run', async () => {
  const fn = jest.fn()

  const { runCi, repoPath, toActualName } = await createRepo({
    repo: {
      packages: [
        {
          name: 'a',
          version: '1.0.0',
          additionalFiles: {
            file1: 'lala',
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
            stepLogic: () => {
              throw new Error(`we should not be here!!!`)
            },
          }),
        })(),
      ]),
    },
  })

  await fs.promises.writeFile(path.join(repoPath, 'packages', toActualName('a'), 'file1'), 'change123', 'utf-8')

  const { passed } = await runCi()

  expect(passed).toBeFalsy()
  expect(fn).not.toBeCalled()
})
