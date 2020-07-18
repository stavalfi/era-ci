import { createFolder } from 'create-folder-structure'
import execa from 'execa'
import { GitServer } from './git-server-testkit'
import { Repo, TargetType, ToActualName, Package } from './types'
import chance from 'chance'
import path from 'path'

async function initializeGitRepo({
  gitServer,
  name,
  org,
  repoPath,
}: {
  repoPath: string
  org: string
  name: string
  gitServer: GitServer
}) {
  await execa.command('git init', { cwd: repoPath, stdio: 'pipe' })
  await execa.command('git add --all', { cwd: repoPath, stdio: 'pipe' })
  await execa.command('git commit -m init', { cwd: repoPath, stdio: 'pipe' })

  await gitServer.createRepository(org, name)

  await execa.command(`git push ${gitServer.generateGitRepositoryAddress(org, name)} -u master`, {
    cwd: repoPath,
    stdio: 'pipe',
  })
}

function createPackageJson({
  packageInfo,
  toActualName,
  isFromThisMonorepo,
}: {
  packageInfo: Package
  toActualName: ToActualName
  isFromThisMonorepo: (depName: string) => boolean
}) {
  return {
    name: toActualName(packageInfo.name),
    version: packageInfo.version,
    private: packageInfo.targetType !== TargetType.npm,
    ...(packageInfo['index.js'] && { main: 'index.js' }),
    ...(packageInfo.scripts && { scripts: packageInfo.scripts }),
    ...(packageInfo.dependencies && {
      dependencies: Object.fromEntries(
        Object.entries(packageInfo.dependencies).map(([key, value]) => [
          isFromThisMonorepo(key) ? toActualName(key) : key,
          value,
        ]),
      ),
    }),
    ...(packageInfo.devDependencies && {
      devDependencies: Object.fromEntries(
        Object.entries(packageInfo.devDependencies).map(([key, value]) => [
          isFromThisMonorepo(key) ? toActualName(key) : key,
          value,
        ]),
      ),
    }),
  }
}

function createPackages({ toActualName, repo }: { repo: Repo; toActualName: ToActualName }) {
  const isFromThisMonorepo = (depName: string) =>
    Boolean(repo.packages?.some(packageInfo => packageInfo.name === depName))

  return Object.fromEntries(
    repo.packages?.map(packageInfo => {
      return [
        toActualName(packageInfo.name),
        {
          'package.json': createPackageJson({
            packageInfo,
            isFromThisMonorepo,
            toActualName,
          }),
          ...(packageInfo['index.js'] && { 'index.js': packageInfo['index.js'] }),
          ...(packageInfo.src && {
            src: packageInfo.src,
          }),
          ...(packageInfo.tests && {
            tests: packageInfo.tests,
          }),
          ...(packageInfo.targetType === TargetType.docker && {
            Dockerfile: `\
            FROM alpine
            CMD ["echo","hello"]
            `,
          }),
          ...packageInfo.additionalFiles,
        },
      ]
    }) || [],
  )
}

export async function createRepo({
  toActualName,
  repo,
  gitServer,
}: {
  repo: Repo
  gitServer: GitServer
  toActualName: ToActualName
}) {
  const repoOrg = toActualName('org')
  const repoName = `repo-${chance()
    .hash()
    .slice(0, 8)}`
  const packagesFolderName = 'packages'
  const subPackagesFolderName = 'more-packages'

  const repoPath = await createFolder({
    'package.json': {
      name: repoName,
      version: '1.0.0',
      private: true,
      workspaces: [`${packagesFolderName}/*`, `${packagesFolderName}/${subPackagesFolderName}/*`],
    },
    '.dockerignore': `node_modules`,
    '.gitignore': 'node_modules',
    packages: {
      ...createPackages({
        repo,
        toActualName,
      }),
      [subPackagesFolderName]: {
        '.gitkeep': '',
      },
    },
    ...repo.rootFiles,
  })

  const packagesFolderPath = path.join(repoPath, packagesFolderName)
  const subPackagesFolderPath = path.join(packagesFolderPath, subPackagesFolderName)

  await execa.command(`yarn install`, { cwd: repoPath, stdio: 'pipe' })

  await initializeGitRepo({
    gitServer,
    repoPath,
    org: repoOrg,
    name: repoName,
  })

  return {
    repoPath,
    repoName,
    repoOrg,
    packagesFolderPath,
    subPackagesFolderPath,
  }
}
