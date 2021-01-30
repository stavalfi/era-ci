import { EventEmitter } from 'events'
import { StrictEventEmitter } from 'strict-event-emitter-types'

export type TaskTimeoutEventEmitter = StrictEventEmitter<
  EventEmitter,
  {
    timeout: (taskId: string) => void
  }
>

export type AbortEventHandler = StrictEventEmitter<
  EventEmitter,
  {
    closed: () => void
  }
>

export enum QuayBuildStatus {
  waiting = 'waiting',
  started = 'started', // this is not confirmed. can't find in the docs what it is
  cancelled = 'cancelled', // this is not confirmed. can't find in the docs if this exists
  complete = 'complete',
  error = 'error',
}

export type QuayCreateRepoResult = { kind: 'image'; namespace: string; name: string }

export type QuayNewBuildResult = {
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

export type BuildTriggerResult = {
  quayRepoName: string
  quayBuildId: string
  quayBuildName: string
  quayBuildAddress: string
  quayBuildLogsAddress: string
  quayBuildStatus: QuayBuildStatus
}

export type NotificationsListResult = {
  notifications: {
    event_config: {}
    uuid: string
    title: QuayNotificationEvents
    number_of_failures: 0
    method: 'webhook' | string
    config: {
      url: string
    }
    event: QuayNotificationEvents
  }[]
}

export enum QuayNotificationEvents {
  buildQueued = 'build_queued',
  buildStart = 'build_start',
  buildSuccess = 'build_success',
  buildFailure = 'build_failure',
  buildCancelled = 'build_cancelled',
}

export type CreateNotificationResult = {
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
