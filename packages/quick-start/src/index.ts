#! /usr/bin/env node

import { startQuayHelperService } from '@era-ci/quay-helper-service'
import { startQuayMockService } from '@era-ci/quay-mock-service'
import yargsParser from 'yargs-parser'

export * from '@era-ci/loggers'
export * from '@era-ci/steps'
export * from '@era-ci/steps-graph'
export * from '@era-ci/task-queues'

async function main(processArgv: string[]): Promise<void> {
  const argv = yargsParser(processArgv, {
    number: ['quay-helper-service-port', 'quay-mock-service-port'],
    string: ['redis-url', 'docker-registry-url', 'docker-fake-org', 'docker-fake-token'],
  })

  if (!argv['quay-helper-service-port']) {
    throw new Error(`--quay-helper-service-port must be valid number > 0`)
  }
  if (!argv['quay-helper-service-port']) {
    throw new Error(`--quay-mock-service-port must be valid number > 0`)
  }

  startQuayMockService({
    port: Number(argv['quay-mock-service-port']),
    isTestMode: false,
    dockerRegistryAddress: argv['docker-registry-url'],
    namespace: argv['docker-fake-org'],
    token: argv['docker-fake-token'],
    rateLimit: {
      max: 1000,
      timeWindowMs: 1000,
    },
  })

  startQuayHelperService({
    PORT: argv['quay-helper-service-port'],
    REDIS_ADDRESS: argv['redis-url'],
  })
}

if (require.main === module) {
  main(process.argv.slice(2))
}
