import { expect, test } from '@jest/globals'
import chance from 'chance'
import execa from 'execa'
import { newEnv } from '../../prepare-test'
import { runDockerImage } from '../../prepare-test/test-helpers'
import { TargetType } from '../../prepare-test/types'

const { createRepo, getResources } = newEnv()

test('1 package', async () => {
  const { runCi, gitHeadCommit } = await createRepo({
    packages: [
      {
        name: 'a',
        version: '1.0.0',
        targetType: TargetType.docker,
      },
    ],
  })

  const master = await runCi({
    targetsInfo: {
      docker: {
        shouldPublish: true,
      },
    },
  })
  expect(master.published.get('a')?.docker?.tags).toEqual(expect.arrayContaining([await gitHeadCommit()]))
})

test('ensure the image is working', async () => {
  const hash = chance().hash().slice(0, 8)
  const { runCi, dockerOrganizationName, toActualName, gitHeadCommit } = await createRepo({
    packages: [
      {
        name: 'a',
        version: '1.0.0',
        targetType: TargetType.docker,
        additionalFiles: {
          Dockerfile: `FROM alpine
          CMD ["echo","${hash}"]`,
        },
      },
    ],
  })

  await runCi({
    targetsInfo: {
      docker: {
        shouldPublish: true,
      },
    },
  })

  await expect(
    runDockerImage(
      `${getResources().dockerRegistry.replace('http://', '')}/${dockerOrganizationName}/${toActualName(
        'a',
      )}:${await gitHeadCommit()}`,
    ),
  ).resolves.toEqual(
    expect.objectContaining({
      stdout: expect.stringContaining(hash),
    }),
  )
})

test('ensure image is deleted after docker-push', async () => {
  const hash = chance().hash().slice(0, 8)
  const { runCi, getFullImageName, gitHeadCommit } = await createRepo({
    packages: [
      {
        name: 'a',
        version: '1.0.0',
        targetType: TargetType.docker,
        additionalFiles: {
          Dockerfile: `FROM alpine
          LABEL label1=${hash}
          RUN echo 'this will create a <none> image so we can ensure it was removed'
          CMD ["echo","${hash}"]`,
        },
      },
    ],
  })

  await runCi({
    targetsInfo: {
      docker: {
        shouldPublish: true,
      },
    },
  })

  const isImageExistLocally = await execa
    .command(`docker inspect --type=image ${getFullImageName('a', await gitHeadCommit())}`)
    .then(
      () => true,
      () => false,
    )

  expect(isImageExistLocally).toBeFalsy()
})
