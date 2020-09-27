import { CreateCache } from '../create-cache'
import { CreateLogger } from '../create-logger'
import { Step } from '../create-step'

export type ConfigFile = {
  cache: CreateCache
  logger: CreateLogger
  steps: Step[]
}
