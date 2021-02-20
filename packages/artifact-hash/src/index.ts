/// <reference path="../../../declarations.d.ts" />

import type { Artifact, Graph, PackageJson } from '@era-ci/utils'
import crypto from 'crypto'
import fs from 'fs'
import { glob } from 'glob-gitignore'
import ignore from 'ignore'
import parseGitIgnore from 'parse-gitignore'
import path from 'path'

const isInParent = (parent: string, child: string) => {
  const relative = path.relative(parent, child)
  return relative && !relative.startsWith('..') && !path.isAbsolute(relative)
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
  const heads = artifacts.filter(a => a.parentsIndexes.length === 0)
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
      ...artifact.parentsIndexes.map(parentIndex => artifacts[parentIndex].data.artifact.packageHash),
    ])
    artifact.data.artifact.packageHash = combinedHash
    artifact.childrenIndexes.forEach(childIndex => {
      if (!seen.has(childIndex)) {
        queue.push(artifacts[childIndex])
      }
    })
  }

  return artifacts
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
  return Buffer.from(hasher.digest()).toString('hex').slice(0, 8)
}

const isRootFile = (repoPath: string, filePath: string) => !filePath.includes(path.join(repoPath, 'packages'))

export async function calculateArtifactsHash({
  repoPath,
  packagesPath,
}: {
  repoPath: string
  packagesPath: Array<string>
}): Promise<{
  artifacts: Graph<{
    artifact: { relativePackagePath: string; packagePath: string; packageHash: string; packageJson: PackageJson }
  }>
  repoHash: string
}> {
  const repoFilesPath = await glob(['**'], {
    cwd: repoPath,
    absolute: true,
    nodir: true,
    ignore: ignore().add(parseGitIgnore(await fs.promises.readFile(path.join(repoPath, '.gitignore'), 'utf-8'))),
  })

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

  return { repoHash, artifacts: artifactsWithCombinedHash }
}
