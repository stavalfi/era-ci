export type DockerPublishConfiguration = {
  dockerRegistry: 'https://registry.hub.docker.com' | 'https://quay.io' | string
  isStepEnabled: boolean
  dockerRegistryAuth?: {
    username: string
    token: string
  }
  dockerOrganizationName: string
  imageInstallArtifactsFromNpmRegistry?: boolean
}

export type QuayDockerPublishConfiguration = DockerPublishConfiguration & {
  quayService: 'https://quay.io' | string // this value is not really used. it's here to show that in tests/local-mock runs, dockerRegistry!==quayService
  dockerfileBuildTimeoutMs: number
  imagesVisibility: 'public' | 'private'
}
export type LocalDockerPublishConfiguration = DockerPublishConfiguration & {
  remoteSshDockerHost?: string
}
