export type QueryStringOptions =
  | {
      git_registry: 'bitbucket-cloud' | 'github'
      git_org: string
      git_repo: string
      commit: string
    }
  | {
      // this option is for testing `quay-task-queue`
      git_registry: 'local-filesystem'
      repo_abs_path: string
    }

export type Auth = {
  github: {
    token: string
  }
  bitbucketCloud: {
    username: string
    token: string
  }
}

export type Config = {
  auth: Auth
  port: number
  redisAddress: string
  redisAuth?: {
    username?: string
    password?: string
  }
  quayBuildStatusChangedRedisTopic: string
}
