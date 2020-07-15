import crypto from 'crypto'
import execa from 'execa'
import fs from 'fs-extra'
import path from 'path'
import _ from 'lodash'
import { Graph } from './types'
import { logger } from '@tahini/log'
import { IPackageJson } from 'package-json-type'

const log = logger('packages-hash')

const isInParent = (parent: string, child: string) => {
  const relative = path.relative(parent, child)
  return relative && !relative.startsWith('..') && !path.isAbsolute(relative)
}

export type PackageHashInfo = {
  relativePackagePath: string
  packagePath: string
  packageHash: string
  packageJson: IPackageJson
  children: string[]
  parents: PackageHashInfo[]
}

function fillParentsInGraph(packageHashInfoByPath: Map<string, PackageHashInfo>) {
  const visited = new Map<string, boolean>()
  function visit(packagePath: string) {
    if (!visited.has(packagePath)) {
      visited.set(packagePath, true)
      const parent = packageHashInfoByPath.get(packagePath) as PackageHashInfo
      parent.children.forEach(dependencyPath => {
        const child = packageHashInfoByPath.get(dependencyPath) as PackageHashInfo
        if (!child.parents.includes(parent)) {
          child.parents.push(parent)
        }
      })
      parent.children.forEach(visit)
    }
  }
  ;[...packageHashInfoByPath.keys()].forEach(visit)
}

function createOrderGraph(
  packageHashInfoByPath: Map<string, PackageHashInfo>,
): Graph<{ relativePackagePath: string; packagePath: string; packageHash: string; packageJson: IPackageJson }> {
  const heads = [...packageHashInfoByPath.values()].filter(packageHashInfo => packageHashInfo.children.length === 0)
  const orderedGraph: PackageHashInfo[] = []
  const visited = new Map<PackageHashInfo, boolean>()
  function visit(node: PackageHashInfo) {
    if (!visited.has(node)) {
      visited.set(node, true)
      orderedGraph.push(node)
      node.parents.map(packagePath => packageHashInfoByPath.get(packagePath.packagePath)!).forEach(visit)
    }
  }
  heads.forEach(visit)
  return orderedGraph
    .map((node, index) => {
      // @ts-ignore
      node.index = index
      return node
    })
    .map(node => ({
      data: {
        relativePackagePath: node.relativePackagePath,
        packageHash: node.packageHash,
        packageJson: node.packageJson,
        packagePath: node.packagePath,
      },
      // @ts-ignore
      childrenIndexes: node.children.map(packagePath => packageHashInfoByPath.get(packagePath)?.index!),
      // @ts-ignore
      parentsIndexes: node.parents.map(parent => parent.index),
    }))
}

async function calculateHashOfPackage(
  packagePath: string,
  filesPath: string[],
  rootFilesHash?: string,
): Promise<string> {
  const hasher = (
    await Promise.all(
      filesPath.map(async filePath => ({
        filePath,
        fileContent: await fs.readFile(filePath, 'utf-8'),
      })),
    )
  ).reduce((hasher, { filePath, fileContent }) => {
    const relativePathInPackage = path.relative(packagePath, filePath)
    hasher.update(relativePathInPackage)
    hasher.update(fileContent)
    return hasher
  }, crypto.createHash('sha224'))
  if (rootFilesHash) {
    hasher.update(rootFilesHash)
  }
  return Buffer.from(hasher.digest()).toString('hex')
}

function combineHashes(hashes: string[]): string {
  const hasher = hashes.reduce((hasher, hash) => {
    hasher.update(hash)
    return hasher
  }, crypto.createHash('sha224'))
  return Buffer.from(hasher.digest()).toString('hex')
}

const isRootFile = (rootPath: string, filePath: string) => !filePath.includes(path.join(rootPath, 'packages'))

export async function calculatePackagesHash(
  rootPath: string,
  packagesPath: string[],
): Promise<
  Graph<{ relativePackagePath: string; packagePath: string; packageHash: string; packageJson: IPackageJson }>
> {
  const repoFilesPathResult = await execa.command('git ls-tree -r --name-only HEAD', {
    cwd: rootPath,
  })

  const repoFilesPath = repoFilesPathResult.stdout
    .split('\n')
    .map(relativeFilePath => path.join(rootPath, relativeFilePath))

  const rootFilesInfo = repoFilesPath.filter(filePath => isRootFile(rootPath, filePath))
  const rootFilesHash = await calculateHashOfPackage(rootPath, rootFilesInfo)

  const packagesWithPackageJson = await Promise.all(
    packagesPath.map<Promise<{ packagePath: string; packageJson: IPackageJson }>>(async packagePath => ({
      packagePath,
      packageJson: await fs.readJson(path.join(packagePath, 'package.json')),
    })),
  )

  const getDepsPaths = (deps?: { [key: string]: string }): string[] =>
    Object.keys(deps || {})
      .map(dependencyName => packagesWithPackageJson.find(({ packageJson }) => packageJson.name === dependencyName))
      .filter(Boolean)
      .map(p => p?.packagePath as string)

  type PackageInfo = {
    relativePackagePath: string
    packagePath: string
    packageJson: IPackageJson
    packageHash: string
    children: string[]
    parents: []
  }

  const packageHashInfoByPath: Map<string, PackageHashInfo> = new Map(
    await Promise.all(
      packagesWithPackageJson.map<Promise<[string, PackageInfo]>>(async ({ packagePath, packageJson }) => {
        const packageFiles = repoFilesPath.filter(filePath => isInParent(packagePath, filePath))
        const packageHash = await calculateHashOfPackage(packagePath, packageFiles, rootFilesHash)
        return [
          packagePath,
          {
            relativePackagePath: path.relative(rootPath, packagePath),
            packagePath,
            packageJson,
            packageHash,
            children: [...getDepsPaths(packageJson?.dependencies), ...getDepsPaths(packageJson?.devDependencies)],
            parents: [], // I will fill this soon
          },
        ]
      }),
    ),
  )

  fillParentsInGraph(packageHashInfoByPath)

  const orderedGraph = createOrderGraph(packageHashInfoByPath)

  const result = _.cloneDeep(orderedGraph).map((packageHashInfo, _index, array) => ({
    ...packageHashInfo,
    data: {
      ...packageHashInfo.data,
      packageHash: combineHashes([
        rootFilesHash,
        packageHashInfo.data.packageHash,
        ...packageHashInfo.childrenIndexes.map(i => array[i].data.packageHash),
      ]),
    },
  }))

  log.debug('calculated hashes to every package in the monorepo:')
  log.debug('root-files -> %s', rootFilesHash)
  log.debug('%d packages: ', result.length)
  result.forEach(node =>
    log.debug(`%s (%s) -> %s`, node.data.relativePackagePath, node.data.packageJson.name, node.data.packageHash),
  )
  log.debug('---------------------------------------------------')
  return result
}
