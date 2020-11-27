export type Config = {
  token: string
  namespace: string
  dockerRegistryAddress: string
}

export type Build = {
  buildId: string
  status: QuayBuildStatus
}

export type Notification = {
  notificationId: string
  event: QuayNotificationEvents
  method: 'webhook'
  webhookAddress: string
}

export type Repo = {
  repo: string
  builds: Record<string, Build>
  notifications: Record<string, Notification>
}

export type Namespace = {
  namespace: string
  repos: Record<string, Repo>
}

export type Db = {
  namespaces: Record<string, Namespace>
}

export type Headers = {
  Authorization: string
}

export enum QuayBuildStatus {
  waiting = 'waiting',
  started = 'started', // this is not confirmed. can't find in the docs what it is
  cancelled = 'cancelled', // this is not confirmed. can't find in the docs if this exists
  complete = 'complete',
  error = 'error',
}

export type CreateRepoRequest = {
  repo_kind: 'image'
  namespace: string
  visibility: 'private' | 'public'
  repository: string
  description: string
}

export type CreateRepoResponse = {
  kind: 'image'
  namespace: string
  name: string
}

export type GetBuildStatusResponse = {
  status: unknown // {}
  error: null
  display_name: string
  repository: { namespace: string; name: string }
  subdirectory: string
  started: string
  tags: string[]
  archive_url: string
  pull_robot: null
  trigger: null
  trigger_metadata: unknown // {}
  context: string
  is_writer: true
  phase: QuayBuildStatus
  resource_key: null
  manual_user: string
  id: string
  dockerfile_path: string
}

export type TriggerBuildRequest = {
  archive_url: string
  docker_tags: string[]
  context: string
  dockerfile_path: string
}

export type TriggerBuildResponse = {
  status: unknown // {}
  error: null
  display_name: string
  repository: { namespace: string; name: string }
  subdirectory: string
  started: string
  tags: string[]
  archive_url: string
  pull_robot: null
  trigger: null
  trigger_metadata: unknown // {}
  context: string
  is_writer: true
  phase: QuayBuildStatus
  resource_key: null
  manual_user: string
  id: string
  dockerfile_path: string
}

export enum QuayNotificationEvents {
  buildQueued = 'build_queued',
  buildStart = 'build_start',
  buildSuccess = 'build_success',
  buildFailure = 'build_failure',
  buildCancelled = 'build_cancelled',
}

export type CreateNotificationRequest = {
  config: { url: string }
  event: QuayNotificationEvents
  eventConfig: Record<string, unknown>
  method: 'webhook'
  title: string
}

export type CreateNotificationResponse = {
  event_config: Record<string, unknown>
  uuid: string
  title: string
  number_of_failures: number
  method: 'webhook'
  config: {
    url: string
    template: string // it's JSON.strigify of request.body.config.template
  }
  event: QuayNotificationEvents
}
