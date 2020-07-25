#!/usr/bin/env node --unhandled-rejections=strict -r ts-node/register

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
  },
})

run(app, process.argv.slice(2))
