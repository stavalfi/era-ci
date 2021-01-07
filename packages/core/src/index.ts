// #!/usr/bin/env node --unhandled-rejections=strict

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
  } finally {
    // eslint-disable-next-line no-process-env
    if (process.env.NC_TEST_MODE) {
      // jest don't show last two console logs so we add this as a workaround
      // so we can see the *actual* two last console logs.
      // eslint-disable-next-line no-console
      console.log('---------------------------')
      // eslint-disable-next-line no-console
      console.log('---------------------------')
    }
  }
}

if (require.main === module) {
  main()
}
