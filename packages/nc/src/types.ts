import { IDependencyMap, IScriptsMap } from 'package-json-type'

export type Cleanup = () => Promise<unknown>

export type PackageJson = {
  name: string
  version: string
  private?: boolean
  scripts?: Partial<IScriptsMap> & { build?: string; lint?: string }
  dependencies?: IDependencyMap
  devDependencies?: IDependencyMap
  peerDependencies?: IDependencyMap
  main?: string
}

export type Node<T> = {
  data: T
  index: number
  parentsIndexes: Array<number>
  childrenIndexes: Array<number>
}

export type Graph<T> = Array<Node<T>>

export type Artifact = {
  relativePackagePath: string
  packagePath: string
  packageHash: string
  packageJson: PackageJson
}

export type UnionArrayValues<T, Array1 extends Array<T>> = Array1[number]
