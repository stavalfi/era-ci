export type DockerPublishConfiguration = {
  isStepEnabled: boolean
  registry: string
  registryAuth?: {
    username: string
    token: string
  }
  dockerOrganizationName: string
  doesImageContainsNpmArtifacts?: boolean
}

export type QuayDockerPublishConfiguration = DockerPublishConfiguration & {
  dockerfileBuildTimeoutMs: number
  imagesVisibility: 'public' | 'private'
}
export type LocalDockerPublishConfiguration = DockerPublishConfiguration & {
  remoteSshDockerHost?: string
}
