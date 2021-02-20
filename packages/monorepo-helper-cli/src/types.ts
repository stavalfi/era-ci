export type Workspaces = {
  [packageJsonName: string]: {
    location: string // relative-path
    workspaceDependencies: string[] // packageJson-names
    mismatchedWorkspaceDependencies: []
  }
}

export type Tsconfig = {
  compilerOptions: {
    paths: { [dep: string]: string }
  }
}

export type TsconfigBuild = {
  references: { path: string }[]
}

export type PackageJson = {
  name?: string
  dependencies?: { [dep: string]: string }
  devDependencies?: { [dep: string]: string }
}

export enum Actions {
  removeAllDevDepsNotRelatedTo = 'remove-all-dev-deps-not-related-to',
  generateDockerfiles = 'generate-docker-files',
  calculateArtifactHash = 'calculate-artifact-hash',
}
