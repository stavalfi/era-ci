export interface QueryStringOptions {
  git_registry: 'bitbucket-cloud' | 'github'
  git_org: string
  git_repo: string
  commit: string
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
  quayBuildStatusChangedRedisTopic: string
}
