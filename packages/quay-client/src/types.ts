import { EventEmitter } from 'events'
import { StrictEventEmitter } from 'strict-event-emitter-types'

export type AbortEventHandler = StrictEventEmitter<
  EventEmitter,
  {
    closed: () => void
  }
>
