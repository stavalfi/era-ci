import { command, option, optional, run, string } from 'cmd-ts'
import findProjectRoot from 'find-project-root'
import path from 'path'
import { readNcConfigurationFile } from './config-file'
import { ci } from '../ci-logic'
import { printFlowLogs } from '../print-flow-logs'

export async function startCli(processArgv: Array<string>, processEnv: NodeJS.ProcessEnv): Promise<void> {
  const app = command({
    name: 'scripts',
    args: {
      'config-file': option({
        type: optional(string),
        long: 'config-file',
        description: 'path of the ci configuration file. default: <repo-path>/era-ci.config.ts ',
      }),
      'repo-path': option({
        type: string,
        long: 'repo-path',
        description: 'from where to run the ci',
        defaultValue: () => findProjectRoot(__dirname) as string,
      }),
      'print-flow': option({
        type: optional(string),
        long: 'print-flow',
        description: 'flow-id - print flow logs to stdout',
      }),
    },
    handler: async args => {
      const repoPath = path.resolve(args['repo-path'])
      const configFilePath = args['config-file']
        ? path.resolve(args['config-file'])
        : path.join(repoPath, 'era-ci.config.ts')
      const config = await readNcConfigurationFile(configFilePath)
      if (args['print-flow']) {
        await printFlowLogs({
          flowId: args['print-flow'],
          repoPath,
          config,
        })
      } else {
        await ci({
          repoPath,
          config,
          processEnv,
        })
      }
    },
  })

  await run(app, processArgv.slice(2))
}
