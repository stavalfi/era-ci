import { Artifact, execaCommand, Graph, INVALIDATE_CACHE_HASH, PackageJson } from '@era-ci/utils'
import crypto from 'crypto'
import fs from 'fs'
import _ from 'lodash'
import path from 'path'
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
  parents: PackageHashInfo[] // who I depend on
  children: Array<string> // who depends on me
}

function combineHashes(hashes: Array<string>): string {
  const hasher = hashes.reduce((hasher, hash) => {
    hasher.update(hash)
    return hasher
  }, crypto.createHash('sha224'))
  return Buffer.from(hasher.digest()).toString('hex').slice(0, 8)
}

// this method must be implemented in BFS (DFS will cause a bug) because dfs dont cover
// the following scenraio: c depends on a, c depends on b.
// why: we need to calculate the hash of a and b before we caluclate the hash of c
function calculateConbinedHashes(
  rootFilesHash: string,
  artifacts: Graph<{ artifact: Artifact }>,
): Graph<{ artifact: Artifact }> {
  const artifactsClone = _.cloneDeep(artifacts)
  const heads = artifactsClone.filter(a => a.parentsIndexes.length === 0)
  const queue = heads

  const seen = new Set<number>()

  while (queue.length > 0) {
    const artifact = queue[0]
    queue.shift()
    seen.add(artifact.index)

    const oldPackageHash = artifact.data.artifact.packageHash
    const combinedHash = combineHashes([
      rootFilesHash,
      oldPackageHash,
      ...artifact.parentsIndexes.map(parentIndex => artifactsClone[parentIndex].data.artifact.packageHash),
    ])
    artifact.data.artifact.packageHash = combinedHash
    artifact.childrenIndexes.forEach(childIndex => {
      if (!seen.has(childIndex)) {
        queue.push(artifactsClone[childIndex])
      }
    })
  }

  return artifactsClone
}

async function calculateHashOfFiles(packagePath: string, filesPath: Array<string>): Promise<string> {
  const hasher = (
    await Promise.all(
      filesPath.map(async filePath => ({
        filePath,
        fileContent: await fs.promises.readFile(filePath, 'utf-8'),
      })),
    )
  ).reduce((hasher, { filePath, fileContent }) => {
    const relativePathInPackage = path.relative(packagePath, filePath)
    hasher.update(relativePathInPackage)
    hasher.update(fileContent)
    return hasher
  }, crypto.createHash('sha224'))
  hasher.update(INVALIDATE_CACHE_HASH)
  return Buffer.from(hasher.digest()).toString('hex').slice(0, 8)
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
    // remove uncommnited deleted files from the list of existing files
    .filter(filePath => fs.existsSync(filePath))

  const packageJsons: PackageJson[] = await Promise.all(
    packagesPath.map(async packagePath =>
      JSON.parse(await fs.promises.readFile(path.join(packagePath, 'package.json'), 'utf-8')),
    ),
  )

  const isolatedPackageHash = await Promise.all(
    packagesPath.map(packagePath => {
      const packageFiles = repoFilesPath.filter(filePath => isInParent(packagePath, filePath))
      return calculateHashOfFiles(packagePath, packageFiles)
    }),
  )

  const artifactsWithoutChildren: Graph<{ artifact: Artifact }> = packagesPath.map((packagePath, index) => {
    const deps = Array.from(
      new Set([
        ...Object.keys(packageJsons[index].dependencies || {}),
        ...Object.keys(packageJsons[index].devDependencies || {}),
        ...Object.keys(packageJsons[index].peerDependencies || {}),
      ]),
    )
    const parentsIndexes = deps
      .map(parentArtifactName => packageJsons.findIndex(packageJson => packageJson.name === parentArtifactName))
      .filter(
        index =>
          // keep only deps from this monorepo
          index >= 0,
      )

    return {
      parentsIndexes,
      childrenIndexes: [],
      index,
      data: {
        artifact: {
          packageJson: packageJsons[index],
          packagePath,
          relativePackagePath: path.relative(repoPath, packagePath),
          packageHash: isolatedPackageHash[index],
        },
      },
    }
  })

  const artifacts = artifactsWithoutChildren.map(artifact => ({
    ...artifact,
    childrenIndexes: artifactsWithoutChildren
      .filter(possibleChild => possibleChild.parentsIndexes.includes(artifact.index))
      .map(child => child.index),
  }))

  const rootFilesInfo = repoFilesPath.filter(filePath => isRootFile(repoPath, filePath))
  const rootFilesHash = await calculateHashOfFiles(repoPath, rootFilesInfo)

  const artifactsWithCombinedHash = calculateConbinedHashes(rootFilesHash, artifacts)

  const repoHash = combineHashes([rootFilesHash, ...artifactsWithCombinedHash.map(p => p.data.artifact.packageHash)])

  log.verbose('calculated hashes to every package in the monorepo:')
  log.verbose(`root-files -> ${rootFilesHash}`)
  log.verbose(`${artifactsWithCombinedHash.length} packages:`)
  artifactsWithCombinedHash.forEach(node =>
    log.verbose(
      `${node.data.artifact.relativePackagePath} (${node.data.artifact.packageJson.name}) -> ${node.data.artifact.packageHash}`,
    ),
  )
  log.verbose('---------------------------------------------------')
  return { repoHash, artifacts: artifactsWithCombinedHash }
}
