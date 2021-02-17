#! /usr/bin/env node

/// <reference path="../../../declarations.d.ts" />

// if we load this module with jest, the source map are corrupted
// eslint-disable-next-line no-process-env
if (!process.env.ERA_TEST_MODE) {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  require('source-map-support').install()
}

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
export * from './types'
export * from './steps-execution'

if (require.main === module) {
  // eslint-disable-next-line no-process-env
  startCli(process.argv, process.env)
}
