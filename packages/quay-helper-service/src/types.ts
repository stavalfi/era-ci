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

export enum QuayBuildStatus {
  waiting = 'waiting',
  started = 'started', // this is not confirmed. can't find in the docs what it is
  cancelled = 'cancelled', // this is not confirmed. can't find in the docs if this exists
  complete = 'complete',
  error = 'error',
}

export enum QuayNotificationEvents {
  buildQueued = 'build_queued',
  buildStart = 'build_start',
  buildSuccess = 'build_success',
  buildFailure = 'build_failure',
  buildCancelled = 'build_cancelled',
}
