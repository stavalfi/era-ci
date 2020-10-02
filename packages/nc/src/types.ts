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
  parentsIndexes: number[]
  childrenIndexes: number[]
}

export type Graph<T> = Node<T>[]

export type Artifact = {
  relativePackagePath: string
  packagePath: string
  packageHash: string
  packageJson: PackageJson
}
