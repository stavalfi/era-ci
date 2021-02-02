#!/usr/bin/env node --unhandled-rejections=strict

/// <reference path="../../../declarations.d.ts" />

import 'source-map-support/register'

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
