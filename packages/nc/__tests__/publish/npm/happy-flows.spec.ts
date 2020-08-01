import chance from 'chance'
import { newEnv } from '../../prepare-test'
import { TargetType } from '../../prepare-test/types'

const { createRepo } = newEnv()

test('1 package', async () => {
  const { runCi } = await createRepo({
    packages: [
      {
        name: 'a',
        version: '1.0.0',
        targetType: TargetType.npm,
      },
    ],
  })

  const master = await runCi({
    shouldPublish: true,
  })
  expect(master.published.get('a')?.npm?.versions).toEqual(['1.0.0'])
})

test('multiple publishes of the same package', async () => {
  const { runCi, addRandomFileToPackage } = await createRepo({
    packages: [
      {
        name: 'a',
        version: '1.0.0',
        targetType: TargetType.npm,
      },
    ],
  })

  const master1 = await runCi({
    shouldPublish: true,
  })
  expect(master1.published.get('a')?.npm?.versions).toEqual(['1.0.0'])

  await addRandomFileToPackage('a')

  const master2 = await runCi({
    shouldPublish: true,
  })

  expect(master2.published.get('a')?.npm?.versions).toEqual(['1.0.0', '1.0.1'])
  expect(master2.published.get('a')?.npm?.highestVersion).toEqual('1.0.1')

  await addRandomFileToPackage('a')

  const master3 = await runCi({
    shouldPublish: true,
  })
  expect(master3.published.get('a')?.npm?.versions).toEqual(['1.0.0', '1.0.1', '1.0.2'])
  expect(master3.published.get('a')?.npm?.highestVersion).toEqual('1.0.2')
})

test('multiple packages', async () => {
  const { runCi } = await createRepo({
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
      },
      {
        name: 'c',
        version: '3.0.0',
        targetType: TargetType.npm,
      },
    ],
  })

  const master = await runCi({
    shouldPublish: true,
  })
  expect(master.published.get('a')?.npm?.versions).toEqual(['1.0.0'])
  expect(master.published.get('b')?.npm?.versions).toEqual(['2.0.0'])
  expect(master.published.get('c')?.npm?.versions).toEqual(['3.0.0'])
})

test('1 package - validate publish content', async () => {
  const hash = chance().hash()
  const { runCi, installAndRunNpmDependency } = await createRepo({
    packages: [
      {
        name: 'a',
        version: '1.0.0',
        targetType: TargetType.npm,
        'index.js': `console.log("${hash}")`,
      },
    ],
  })

  await runCi({
    shouldPublish: true,
  })

  await expect(installAndRunNpmDependency('a')).resolves.toEqual(
    expect.objectContaining({
      stdout: expect.stringContaining(hash),
    }),
  )
})

test('reproduce bug in travelGraph function', async () => {
  const { runCi } = await createRepo({
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
      },
      {
        name: 'c',
        version: '3.0.0',
        targetType: TargetType.npm,
        dependencies: {
          a: '^1.0.0',
        },
      },
    ],
  })

  const master = await runCi({
    shouldPublish: true,
  })
  expect(master.published.get('a')?.npm?.versions).toEqual(['1.0.0'])
  expect(master.published.get('b')?.npm?.versions).toEqual(['2.0.0'])
  expect(master.published.get('c')?.npm?.versions).toEqual(['3.0.0'])
})
