// #!/usr/bin/env node --unhandled-rejections=strict
/* eslint-disable no-console */

/// <reference path="../../../declarations.d.ts" />

// `require('source-map-support').install()` MUST be the first (executed) line in the project!!!
// eslint-disable-next-line @typescript-eslint/no-var-requires
import 'source-map-support/register'
//
import { startCli } from './configuration/cli'

export * from './ci-logic'
export * from './configuration'
export * from './create-logger'
export * from './redis-client'
export * from './create-step'
export * from './create-constrain'
export * from './create-task-queue'
export * from './immutable-cache'
export * from './utils'

if (require.main === module) {
  // eslint-disable-next-line no-process-env
  startCli(process.argv, process.env)
}
