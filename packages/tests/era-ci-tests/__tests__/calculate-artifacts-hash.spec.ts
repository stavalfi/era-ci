import { createRepo, createTest, test } from '@era-ci/e2e-tests-infra'
import execa from 'execa'
import expect from 'expect'
import fs from 'fs'
import path from 'path'

createTest(test)

test('artifact-hash depends on root-hash so if root-hash changes, so the artifact-hash sould change as well', async t => {
  t.timeout(50 * 1000)

  const { runCi, repoPath } = await createRepo(t, {
    repo: {
      packages: [
        {
          name: 'a',
          version: '1.0.0',
        },
      ],
    },
  })
  const result1 = await runCi()

  await fs.promises.writeFile(path.join(repoPath, 'a.txt'), 'hi', 'utf-8')
  await execa.command(`git add --all && git commit -am wip`, { cwd: repoPath, shell: true })

  const result2 = await runCi()

  expect(result1.jsonReport.artifacts[0].data.artifact.packageHash).not.toEqual(
    result2.jsonReport.artifacts[0].data.artifact.packageHash,
  )
})

test('artifacts which has no relation dont have dependent hashes - if we change artifact1 content, artifact2 hash should not change', async t => {
  t.timeout(50 * 1000)

  const { runCi, repoPath } = await createRepo(t, {
    repo: {
      packages: [
        {
          name: 'a',
          version: '1.0.0',
        },
        {
          name: 'b',
          version: '1.0.0',
        },
      ],
    },
  })
  const result1 = await runCi()

  await fs.promises.writeFile(
    path.join(result1.jsonReport.artifacts[0].data.artifact.packagePath, 'additional-file-to-package-a.txt'),
    'hi',
    'utf-8',
  )
  await execa.command(`git add --all && git commit -am wip`, { cwd: repoPath, shell: true })

  const result2 = await runCi()

  // artifact a should have different hashes
  expect(result1.jsonReport.artifacts[0].data.artifact.packageHash).not.toEqual(
    result2.jsonReport.artifacts[0].data.artifact.packageHash,
  )

  // artifact a should have same hash
  expect(result1.jsonReport.artifacts[1].data.artifact.packageHash).toEqual(
    result2.jsonReport.artifacts[1].data.artifact.packageHash,
  )
})

test('artifact-hash depends on parent-artifact-hash so if parent-artifact-hash changes, so the artifact-hash sould change as well', async t => {
  t.timeout(50 * 1000)

  const { runCi, repoPath } = await createRepo(t, {
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
  })
  const result1 = await runCi()

  await fs.promises.writeFile(
    path.join(result1.jsonReport.artifacts[0].data.artifact.packagePath, 'additional-file-to-package-a.txt'),
    'hi',
    'utf-8',
  )
  await execa.command(`git add --all && git commit -am wip`, { cwd: repoPath, shell: true })

  const result2 = await runCi()

  expect(result1.jsonReport.artifacts[1].data.artifact.packageHash).not.toEqual(
    result2.jsonReport.artifacts[1].data.artifact.packageHash,
  )
})

test('reproduce bug - parent-indexes of monorepo artifacts should be only artifacts from monorepo (without external npm dependencies)', async t => {
  t.timeout(50 * 1000)

  const { runCi } = await createRepo(t, {
    repo: {
      packages: [
        {
          name: 'a',
          version: '1.0.0',
          dependencies: {
            'empty-npm-package': '*',
          },
        },
      ],
    },
  })

  const { jsonReport } = await runCi()

  expect(jsonReport.artifacts[0].parentsIndexes).toHaveLength(0)
})
