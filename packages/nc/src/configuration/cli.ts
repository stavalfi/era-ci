import { command, option, optional, run, string } from 'cmd-ts'
import findProjectRoot from 'find-project-root'
import path from 'path'
import { readNcConfigurationFile } from './config-file'
import { ci } from '../ci-logic'

export async function startCli(processArgv: string[]) {
  const app = command({
    name: 'scripts',
    args: {
      'config-file': option({
        type: optional(string),
        long: 'config-file',
        description: 'path of the ci configuration file. default: <repo-path>/nc.config.ts ',
      }),
      'repo-path': option({
        type: string,
        long: 'repo-path',
        description: 'from where to run the ci',
        defaultValue: () => findProjectRoot(__dirname) as string,
      }),
    },
    handler: async args => {
      const configFilePath = args['config-file'] || path.join(args['repo-path'], 'nc.config.ts')
      const configurations = await readNcConfigurationFile(configFilePath)
      await ci({
        ...configurations,
        repoPath: args['repo-path'],
      })
    },
  })

  await run(app, processArgv.slice(2))
}
