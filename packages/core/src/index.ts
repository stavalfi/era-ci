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

async function main() {
  try {
    // eslint-disable-next-line no-process-env
    await startCli(process.argv, process.env)
  } catch (error: unknown) {
    console.error(`CI failed unexpectedly`, error)
    throw error
  }
}

if (require.main === module) {
  main()
}
