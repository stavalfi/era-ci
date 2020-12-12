import crypto from 'crypto'
import fs from 'fs-extra'
import path from 'path'
import { Artifact, PackageJson, Graph, execaCommand, INVALIDATE_CACHE_HASH } from '@tahini/utils'
import { Log } from './create-logger'

const isInParent = (parent: string, child: string) => {
  const relative = path.relative(parent, child)
  return relative && !relative.startsWith('..') && !path.isAbsolute(relative)
}

export type PackageHashInfo = {
  relativePackagePath: string
  packagePath: string
  packageHash: string
  packageJson: PackageJson
  parents: PackageHashInfo[] // who depends on me
  children: Array<string> // who I depend on
}

function combineHashes(hashes: Array<string>): string {
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

  for (const packagePath of packageHashInfoByPath.keys()) {
    visit(packagePath)
  }
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
): Graph<{
  artifact: Artifact
}> {
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
        artifact: {
          relativePackagePath: node.relativePackagePath,
          packageHash: node.packageHash,
          packageJson: node.packageJson,
          packagePath: node.packagePath,
        },
      },
      // @ts-ignore
      childrenIndexes: node.children.map(packagePath => packageHashInfoByPath.get(packagePath)?.index!),
      // @ts-ignore
      parentsIndexes: node.parents.map(parent => parent.index),
    }))
}

async function calculateHashOfFiles(packagePath: string, filesPath: Array<string>): Promise<string> {
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
  hasher.update(INVALIDATE_CACHE_HASH)
  return Buffer.from(hasher.digest()).toString('hex')
}

const isRootFile = (repoPath: string, filePath: string) => !filePath.includes(path.join(repoPath, 'packages'))

export async function calculateArtifactsHash({
  repoPath,
  packagesPath,
  log,
}: {
  repoPath: string
  packagesPath: Array<string>
  log: Log
}): Promise<{
  artifacts: Graph<{
    artifact: { relativePackagePath: string; packagePath: string; packageHash: string; packageJson: PackageJson }
  }>
  repoHash: string
}> {
  const repoFilesPathResult = await execaCommand('git ls-tree -r --name-only HEAD', {
    cwd: repoPath,
    stdio: 'pipe',
    log,
  })

  const repoFilesPath = repoFilesPathResult.stdout
    .split('\n')
    .map(relativeFilePath => path.join(repoPath, relativeFilePath))

  const packagesWithPackageJson = await Promise.all(
    packagesPath.map<Promise<{ packagePath: string; packageJson: PackageJson }>>(async packagePath => ({
      packagePath,
      packageJson: await fs.readJson(path.join(packagePath, 'package.json')),
    })),
  )

  const getDepsPaths = (deps?: { [key: string]: string }): Array<string> =>
    Object.keys(deps || {})
      .map(dependencyName => packagesWithPackageJson.find(({ packageJson }) => packageJson.name === dependencyName))
      .filter(Boolean)
      .map(p => p?.packagePath as string)

  type TempArtifact = {
    relativePackagePath: string
    packagePath: string
    packageJson: PackageJson
    packageHash: string
    children: Array<string>
    parents: []
  }

  const packageHashInfoByPath: Map<string, PackageHashInfo> = new Map(
    await Promise.all(
      packagesWithPackageJson.map<Promise<[string, TempArtifact]>>(async ({ packagePath, packageJson }) => {
        const packageFiles = repoFilesPath.filter(filePath => isInParent(packagePath, filePath))
        const packageHash = await calculateHashOfFiles(packagePath, packageFiles)
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
  const rootFilesHash = await calculateHashOfFiles(repoPath, rootFilesInfo)

  calculateConbinedHashes(rootFilesHash, packageHashInfoByPath)

  const artifacts = createOrderGraph(packageHashInfoByPath)

  const repoHash = combineHashes([rootFilesHash, ...artifacts.map(p => p.data.artifact.packageHash)])

  log.verbose('calculated hashes to every package in the monorepo:')
  log.verbose(`root-files -> ${rootFilesHash}`)
  log.verbose(`${artifacts.length} packages:`)
  artifacts.forEach(node =>
    log.verbose(
      `${node.data.artifact.relativePackagePath} (${node.data.artifact.packageJson.name}) -> ${node.data.artifact.packageHash}`,
    ),
  )
  log.verbose('---------------------------------------------------')
  return { repoHash, artifacts }
}