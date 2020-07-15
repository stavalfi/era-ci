import execa from 'execa'
import { logger } from '@tahini/log'
import { Graph, PackageInfo } from './types'

const log = logger('promote')

export async function promote(orderedGraph: Graph<PackageInfo>): Promise<PackageInfo[]> {
  log.debug('start promoting packages...')
  const toPromote = orderedGraph.map(node => node.data).filter(data => data.target?.needPublish)

  if (toPromote.length === 0) {
    log.debug(`there is no need to promote anything. all packages that we should eventually publish, didn't change.`)
    return []
  } else {
    log.debug('promoting the following packages: %s', toPromote.map(node => `"${node.packageJson.name}"`).join(', '))
    await Promise.all(
      toPromote.map(async data => {
        const newVersion = data.target?.needPublish && data.target?.newVersion // it can't be false.
        log.debug(`promoting %s from %s to version %s`, data.relativePackagePath, data.packageJson.version, newVersion)
        await execa.command(`yarn version --new-version ${newVersion} --no-git-tag-version`, {
          stdio: 'ignore',
          cwd: data.packagePath,
        })
      }),
    )
    return toPromote
  }
}
