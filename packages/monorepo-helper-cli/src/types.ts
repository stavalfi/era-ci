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
  removeAllDevDeps = 'remove-all-dev-deps',
  removeAllDevDepsNotRelatedTo = 'remove-all-dev-deps-not-related-to',
  generateDockerfiles = 'generate-docker-files',
  calculateArtifactHash = 'calculate-artifact-hash',
}
