import { newEnv } from './prepare-test'
import { TargetType } from './prepare-test/types'

const { createRepo } = newEnv()

test('skip publish of package that did not change from the last publish', async () => {
  const { runCi } = await createRepo({
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

  const master2 = await runCi({
    shouldPublish: true,
  })
  expect(master2.published.get('a')?.npm?.versions).toEqual(['1.0.0'])
})

test('multiple packages - publish again only changed package', async () => {
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
      },
    ],
  })

  const master1 = await runCi({
    shouldPublish: true,
  })

  expect(master1.published.get('a')?.npm?.versions).toEqual(['1.0.0'])
  expect(master1.published.get('b')?.npm?.versions).toEqual(['2.0.0'])

  await addRandomFileToPackage('a')

  const master2 = await runCi({
    shouldPublish: true,
  })

  expect(master2.published.get('a')?.npm?.versions).toEqual(['1.0.0', '1.0.1'])
  expect(master2.published.get('a')?.npm?.highestVersion).toEqual('1.0.1')
  expect(master2.published.get('b')?.npm?.versions).toEqual(['2.0.0'])
})

test('no addtional publish of the same package with the exact same content', async () => {
  const { runCi, modifyPackageJson } = await createRepo({
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

  await modifyPackageJson('a', packageJson => ({
    ...packageJson,
    author: 'stav',
  }))

  const master2 = await runCi({
    shouldPublish: true,
  })
  expect(master2.published.get('a')?.npm?.versions).toEqual(['1.0.0', '1.0.1'])
  expect(master2.published.get('a')?.npm?.highestVersion).toEqual('1.0.1')

  await modifyPackageJson('a', packageJson => {
    const shallowCopy = { ...packageJson }
    delete shallowCopy.author
    return shallowCopy
  })

  const master3 = await runCi({
    shouldPublish: true,
  })
  expect(master3.published.get('a')?.npm?.versions).toEqual(['1.0.0', '1.0.1'])
  expect(master3.published.get('a')?.npm?.highestVersion).toEqual('1.0.1')
})
