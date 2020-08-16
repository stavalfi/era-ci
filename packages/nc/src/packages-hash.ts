import { logger } from '@tahini/log'
import crypto from 'crypto'
import execa from 'execa'
import fs from 'fs-extra'
import { IPackageJson } from 'package-json-type'
import path from 'path'
import { Graph } from './types'

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
  parents: PackageHashInfo[] // who depends on me
  children: string[] // who I depend on
}

function combineHashes(hashes: string[]): string {
  const hasher = hashes.reduce((hasher, hash) => {
    hasher.update(hash)
    return hasher
  }, crypto.createHash('sha224'))
  return Buffer.from(hasher.digest()).toString('hex')
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

// this method must be implemented in BFS (DFS will cause a bug) because dfs dont cover
// the following scenraio: c depends on a, c depends on b.
// why: we need to calculate the hash of a and b before we caluclate the hash of c
function calculateConbinedHashes(
  rootFilesHash: string,
  packageDirectHashInfoByPath: Map<string, PackageHashInfo>,
): void {
  const heads = [...packageDirectHashInfoByPath.entries()].filter(
    ([_packagePath, packageInfo]) => packageInfo.children.length === 0,
  )
  const queue = heads

  const seen = new Set<string>()

  while (queue.length > 0) {
    const [packagePath, packageHashInfo] = queue[0]
    queue.shift()
    seen.add(packagePath)

    const oldPackageHash = packageHashInfo.packageHash
    const combinedHash = combineHashes([
      rootFilesHash,
      oldPackageHash,
      ...packageHashInfo.children.map(parentPath => packageDirectHashInfoByPath.get(parentPath)?.packageHash!),
    ])
    packageHashInfo.packageHash = combinedHash
    packageHashInfo.parents.forEach(packageInfo => {
      if (!seen.has(packageInfo.packagePath)) {
        queue.push([packageInfo.packagePath, packageInfo])
      }
    })
  }
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
      // @ts-ignore
      index: node.index,
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

async function calculateHashOfPackage(packagePath: string, filesPath: string[]): Promise<string> {
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
  return Buffer.from(hasher.digest()).toString('hex')
}

const isRootFile = (repoPath: string, filePath: string) => !filePath.includes(path.join(repoPath, 'packages'))

export async function calculatePackagesHash(
  repoPath: string,
  packagesPath: string[],
): Promise<
  Graph<{ relativePackagePath: string; packagePath: string; packageHash: string; packageJson: IPackageJson }>
> {
  const repoFilesPathResult = await execa.command('git ls-tree -r --name-only HEAD', {
    cwd: repoPath,
  })

  const repoFilesPath = repoFilesPathResult.stdout
    .split('\n')
    .map(relativeFilePath => path.join(repoPath, relativeFilePath))

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

  type Artifact = {
    relativePackagePath: string
    packagePath: string
    packageJson: IPackageJson
    packageHash: string
    children: string[]
    parents: []
  }

  const packageHashInfoByPath: Map<string, PackageHashInfo> = new Map(
    await Promise.all(
      packagesWithPackageJson.map<Promise<[string, Artifact]>>(async ({ packagePath, packageJson }) => {
        const packageFiles = repoFilesPath.filter(filePath => isInParent(packagePath, filePath))
        const packageHash = await calculateHashOfPackage(packagePath, packageFiles)
        return [
          packagePath,
          {
            relativePackagePath: path.relative(repoPath, packagePath),
            packagePath,
            packageJson,
            packageHash,
            children: [...getDepsPaths(packageJson?.dependencies), ...getDepsPaths(packageJson?.devDependencies)],
            parents: [], // I will fill this soon (its not a todo. the next secion will fill it)
          },
        ]
      }),
    ),
  )

  fillParentsInGraph(packageHashInfoByPath)

  const rootFilesInfo = repoFilesPath.filter(filePath => isRootFile(repoPath, filePath))
  const rootFilesHash = await calculateHashOfPackage(repoPath, rootFilesInfo)

  calculateConbinedHashes(rootFilesHash, packageHashInfoByPath)

  const orderedGraph = createOrderGraph(packageHashInfoByPath)

  log.verbose('calculated hashes to every package in the monorepo:')
  log.verbose(`root-files -> ${rootFilesHash}`)
  log.verbose(`${orderedGraph.length} packages:`)
  orderedGraph.forEach(node =>
    log.verbose(`${node.data.relativePackagePath} (${node.data.packageJson.name}) -> ${node.data.packageHash}`),
  )
  log.verbose('---------------------------------------------------')
  return orderedGraph
}
