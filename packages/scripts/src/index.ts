#!/usr/bin/env node --unhandled-rejections=strict

/* eslint-disable no-process-env */

/// <reference path="../../../declarations.d.ts" />

import { boolean, command, flag, run, subcommands } from 'cmd-ts'
import { clean } from './clean'

const app = subcommands({
  name: 'scripts',
  cmds: {
    clean: command({
      name: 'clean',
      args: {
        silent: flag({
          type: boolean,
          long: 'clean',
          defaultValue: () => false,
        }),
      },
      handler: clean,
    }),
    'run-ci-pr': command({
      name: 'run-ci-pr',
      args: {},
      handler: () => require('@tahini/log').runCiCli(require('./get-ci-options').getPrCiOptions(), 'inherit'),
    }),
    'run-ci-master': command({
      name: 'run-ci-master',
      args: {},
      handler: () => require('@tahini/log').runCiCli(require('./get-ci-options').getMasterCiOptions(), 'inherit'),
    }),
  },
})

run(app, process.argv.slice(2))
