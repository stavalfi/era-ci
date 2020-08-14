import chance from 'chance'
import { newEnv } from '../../prepare-test'
import { TargetType } from '../../prepare-test/types'
import { runDockerImage } from '../../prepare-test/test-helpers'
import execa from 'execa'

const { createRepo, getTestResources } = newEnv()

test('1 package', async () => {
  const { runCi } = await createRepo({
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
        shouldDeploy: false,
      },
    },
  })
  expect(master.published.get('a')?.docker?.tags).toEqual(['1.0.0'])
})

test('ensure the image is working', async () => {
  const hash = chance().hash()
  const { runCi, dockerOrganizationName, toActualName } = await createRepo({
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
        shouldDeploy: false,
      },
    },
  })

  await expect(
    runDockerImage(
      `${getTestResources().dockerRegistry.host}:${
        getTestResources().dockerRegistry.port
      }/${dockerOrganizationName}/${toActualName('a')}:1.0.0`,
    ),
  ).resolves.toEqual(
    expect.objectContaining({
      stdout: expect.stringContaining(hash),
    }),
  )
})

test('ensure image is deleted after docker-push', async () => {
  const hash = chance().hash()
  const { runCi, getFullImageName } = await createRepo({
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
        shouldDeploy: false,
      },
    },
  })

  const isImageExistLocally = await execa.command(`docker inspect --type=image ${getFullImageName('a', '1.0.0')}`).then(
    () => true,
    () => false,
  )

  expect(isImageExistLocally).toBeFalsy()
})
