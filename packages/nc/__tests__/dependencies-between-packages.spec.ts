import { newEnv } from './prepare-test'
import { TargetType } from './prepare-test/types'

const { createRepo } = newEnv()

describe('npm package depends on.....', () => {
  test('b-package depends on a-package, when a-package published, then b-package need to publish as well', async () => {
    const { runCi, addRandomFileToPackage } = await createRepo({
      packages: [
        {
          name: 'a',
          version: '1.0.0',
          targetType: TargetType.npm,
        },
        {
          name: 'b',
          version: '2.0.0',
          targetType: TargetType.npm,
          dependencies: {
            a: '^1.0.0',
          },
        },
      ],
    })

    const master1 = await runCi({
      targetsInfo: {
        npm: {
          shouldPublish: true,
          shouldDeploy: false,
        },
      },
    })

    expect(master1.published.get('a')?.npm?.versions).toEqual(['1.0.0'])
    expect(master1.published.get('b')?.npm?.versions).toEqual(['2.0.0'])

    await addRandomFileToPackage('a')

    const master2 = await runCi({
      targetsInfo: {
        npm: {
          shouldPublish: true,
          shouldDeploy: false,
        },
      },
    })

    expect(master2.published.get('a')?.npm?.versions).toEqual(['1.0.0', '1.0.1'])
    expect(master2.published.get('a')?.npm?.highestVersion).toEqual('1.0.1')
    expect(master2.published.get('b')?.npm?.versions).toEqual(['2.0.0', '2.0.1'])
    expect(master2.published.get('b')?.npm?.highestVersion).toEqual('2.0.1')
  })

  test('b-package depends on a-package, when b-package published, then a-package dont need to publish as well', async () => {
    const { runCi, addRandomFileToPackage } = await createRepo({
      packages: [
        {
          name: 'a',
          version: '1.0.0',
          targetType: TargetType.npm,
        },
        {
          name: 'b',
          version: '2.0.0',
          targetType: TargetType.npm,
          dependencies: {
            a: '^1.0.0',
          },
        },
      ],
    })

    const master1 = await runCi({
      targetsInfo: {
        npm: {
          shouldPublish: true,
          shouldDeploy: false,
        },
      },
    })

    expect(master1.published.get('a')?.npm?.versions).toEqual(['1.0.0'])
    expect(master1.published.get('b')?.npm?.versions).toEqual(['2.0.0'])

    await addRandomFileToPackage('b')

    const master2 = await runCi({
      targetsInfo: {
        npm: {
          shouldPublish: true,
          shouldDeploy: false,
        },
      },
    })

    expect(master1.published.get('a')?.npm?.versions).toEqual(['1.0.0'])
    expect(master2.published.get('b')?.npm?.versions).toEqual(['2.0.0', '2.0.1'])
    expect(master2.published.get('b')?.npm?.highestVersion).toEqual('2.0.1')
  })

  test('npm-package cannot depends on docker-package', async () => {
    const { runCi, toActualName } = await createRepo({
      packages: [
        {
          name: 'a',
          version: '1.0.0',
          targetType: TargetType.docker,
        },
        {
          name: 'b',
          version: '2.0.0',
          targetType: TargetType.npm,
          dependencies: {
            a: '^1.0.0',
          },
        },
      ],
    })

    await expect(
      runCi({
        targetsInfo: {
          npm: {
            shouldPublish: false,
            shouldDeploy: false,
          },
          docker: {
            shouldPublish: false,
            shouldDeploy: false,
          },
        },
        execaOptions: {
          stdio: 'pipe',
        },
      }),
    ).rejects.toEqual(
      expect.objectContaining({
        stderr: expect.stringContaining(
          `the package "${toActualName('b')}" can't depend on dependency: "${toActualName(
            'a',
          )}" in version "^1.0.0" becuase this version represents a docker-package`,
        ),
      }),
    )
  })

  test('public npm-package cannot depends on private-npm-package', async () => {
    const { runCi, toActualName } = await createRepo({
      packages: [
        {
          name: 'a',
          version: '1.0.0',
        },
        {
          name: 'b',
          version: '2.0.0',
          targetType: TargetType.npm,
          dependencies: {
            a: '^1.0.0',
          },
        },
      ],
    })

    await expect(
      runCi({
        targetsInfo: {
          npm: {
            shouldPublish: false,
            shouldDeploy: false,
          },
        },
        execaOptions: {
          stdio: 'pipe',
        },
      }),
    ).rejects.toEqual(
      expect.objectContaining({
        stderr: expect.stringContaining(
          `the package "${toActualName('b')}" can't depend on dependency: "${toActualName(
            'a',
          )}" in version "^1.0.0" becuase this version represents a private-npm-package`,
        ),
      }),
    )
  })
})

describe('docker-package depends on...', () => {
  test('b-docker-package depends on a-package, when a-package published, then b-package need to publish as well', async () => {
    const { runCi, addRandomFileToPackage } = await createRepo({
      packages: [
        {
          name: 'a',
          version: '1.0.0',
          targetType: TargetType.npm,
        },
        {
          name: 'b',
          version: '2.0.0',
          targetType: TargetType.docker,
          dependencies: {
            a: '^1.0.0',
          },
        },
      ],
    })

    const master1 = await runCi({
      targetsInfo: {
        npm: {
          shouldPublish: true,
          shouldDeploy: false,
        },
        docker: {
          shouldPublish: true,
          shouldDeploy: false,
        },
      },
    })

    expect(master1.published.get('a')?.npm?.versions).toEqual(['1.0.0'])
    expect(master1.published.get('b')?.docker?.tags).toEqual(['2.0.0'])

    await addRandomFileToPackage('a')

    const master2 = await runCi({
      targetsInfo: {
        npm: {
          shouldPublish: true,
          shouldDeploy: false,
        },
        docker: {
          shouldPublish: true,
          shouldDeploy: false,
        },
      },
    })

    expect(master2.published.get('a')?.npm?.versions).toEqual(['1.0.0', '1.0.1'])
    expect(master2.published.get('a')?.npm?.highestVersion).toEqual('1.0.1')
    expect(master2.published.get('b')?.docker?.tags).toEqual(['2.0.0', '2.0.1'])
  })

  test('docker-package cannot depends on docker-package', async () => {
    const { runCi, toActualName } = await createRepo({
      packages: [
        {
          name: 'a',
          version: '1.0.0',
          targetType: TargetType.docker,
        },
        {
          name: 'b',
          version: '2.0.0',
          targetType: TargetType.docker,
          dependencies: {
            a: '^1.0.0',
          },
        },
      ],
    })

    await expect(
      runCi({
        targetsInfo: {
          docker: {
            shouldPublish: true,
            shouldDeploy: false,
          },
        },
        execaOptions: {
          stdio: 'pipe',
        },
      }),
    ).rejects.toEqual(
      expect.objectContaining({
        stderr: expect.stringContaining(
          `the package "${toActualName('b')}" can't depend on dependency: "${toActualName(
            'a',
          )}" in version "^1.0.0" becuase this version represents a docker-package`,
        ),
      }),
    )
  })

  test('docker-package can depend on private npm package', async () => {
    const { runCi } = await createRepo({
      packages: [
        {
          name: 'a',
          version: '1.0.0',
        },
        {
          name: 'b',
          version: '2.0.0',
          targetType: TargetType.docker,
          dependencies: {
            a: '^1.0.0',
          },
          additionalFiles: {
            Dockerfile: `\
FROM node

WORKDIR /usr/repo

COPY yarn.lock package.json ./
COPY packages/ ./packages/

RUN yarn install --frozen-lockfile --production\
            `,
          },
        },
      ],
    })

    const master1 = await runCi({
      targetsInfo: {
        docker: {
          shouldPublish: true,
          shouldDeploy: false,
        },
      },
    })

    expect(master1.published.get('b')?.docker?.tags).toEqual(['2.0.0'])
  })
})
