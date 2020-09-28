import { TargetType } from '../../src'
import { FolderStructure } from 'create-folder-structure'
import { IDependencyMap } from 'package-json-type'
import { GitServer } from './git-server-testkit'

export { TargetType }

export type Package = {
  name: string
  version: string
  targetType?: TargetType
  'index.js'?: string
  dependencies?: IDependencyMap
  devDependencies?: IDependencyMap
  src?: FolderStructure
  tests?: FolderStructure
  additionalFiles?: FolderStructure
  scripts?: {
    test?: string
    postpublish?: string
  }
}

export type Repo = {
  packages?: Package[]
  rootFiles?: FolderStructure
}

export type TestResources = {
  npmRegistry: {
    address: string
    auth: {
      username: string
      token: string
      email: string
    }
  }
  dockerRegistry: string
  gitServer: GitServer
  redisServer: string
}

export type ToActualName = (name: string) => string