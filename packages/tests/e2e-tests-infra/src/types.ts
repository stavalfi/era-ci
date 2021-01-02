import { PackageJson, TargetType } from '@era-ci/utils'
import { FolderStructure } from 'create-folder-structure'
import { IDependencyMap } from 'package-json-type'
import { DeepPartial } from 'ts-essentials'
import { GitServer } from './git-server-testkit'

export { DeepPartial } from 'ts-essentials'

export { TargetType, PackageJson }

export type Cleanup = () => Promise<unknown>

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
  scripts?: PackageJson['scripts']
}

export type Repo = {
  packages?: Package[]
  rootFiles?: FolderStructure
  rootPackageJson?: DeepPartial<PackageJson>
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
  redisServerUrl: string
  redisServerHost: string
  redisServerPort: number
  quayMockService: string
  quayHelperService: string
  quayNamespace: string
  quayToken: string
  quayBuildStatusChangedRedisTopic: string
}

export type ToActualName = (name: string) => string

export type ResultingArtifact = {
  npm: {
    versions: Array<string>
    highestVersion?: string
  }
  docker: {
    tags: Array<string>
  }
}
