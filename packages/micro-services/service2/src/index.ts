import express from 'express'
import pkgUp from 'pkg-up'
import fse from 'fs-extra'
import { IPackageJson } from 'package-json-type'

async function getPackageJson(): Promise<IPackageJson> {
  const packageJsonPath = await pkgUp({
    cwd: __dirname,
  })

  if (!packageJsonPath) {
    throw new Error(`can't find package.json of this project`)
  }

  return fse.readJson(packageJsonPath)
}

async function main() {
  const packageJson = await getPackageJson()

  const serviceInfo = `${packageJson.name}@${packageJson.version}`

  express()
    .get('/', (_req, res) => res.end(`alive hi everyone - ${serviceInfo}`))
    .listen(80)
}

if (require.main === module) {
  // eslint-disable-next-line no-floating-promise/no-floating-promise
  main()
}
