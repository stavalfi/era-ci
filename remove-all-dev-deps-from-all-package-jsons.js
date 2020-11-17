const fs = require('fs')
const path = require('path')
const { execSync } = require('child_process')

async function deleteDevDeps(packageJsonPath) {
  const packageJson = require(packageJsonPath)
  delete packageJson.devDependencies
  await new Promise((res, rej) =>
    fs.writeFile(packageJsonPath, JSON.stringify(packageJson, null, 2), 'utf-8', error => (error ? rej(error) : res())),
  )
}

function getSubPackagesPaths(repoPath) {
  const result = execSync(`yarn workspaces --json info`).toString()
  const workspacesInfo = JSON.parse(JSON.parse(result).data)
  return Object.values(workspacesInfo)
    .map(workspaceInfo => workspaceInfo.location)
    .map(packagePath => path.join(repoPath, packagePath, 'package.json'))
}

async function main() {
  const repoPath = __dirname
  const packageJsonPath = path.join(repoPath, 'package.json')
  await deleteDevDeps(packageJsonPath)
  await Promise.all(getSubPackagesPaths(repoPath).map(packageJsonPath => deleteDevDeps(packageJsonPath)))
}

if (require.main === module) {
  main()
}
