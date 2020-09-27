import { IPackageJson } from 'package-json-type'

export type Cleanup = () => Promise<unknown>

export type PackageJson = Omit<IPackageJson, 'name' | 'version'> & Required<Pick<IPackageJson, 'name' | 'version'>>

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
