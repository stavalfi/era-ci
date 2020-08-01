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

  await execa.command(`git remote add origin ${gitServer.generateGitRepositoryAddress(org, name)}`, {
    cwd: repoPath,
    stdio: 'pipe',
  })
  await execa.command(`git push ${gitServer.generateGitRepositoryAddress(org, name)} -u master`, {
    cwd: repoPath,
    stdio: 'pipe',
  })
}

function createPackageJson({
  artifact,
  toActualName,
  isFromThisMonorepo,
}: {
  artifact: Package
  toActualName: ToActualName
  isFromThisMonorepo: (depName: string) => boolean
}) {
  return {
    name: toActualName(artifact.name),
    version: artifact.version,
    private: artifact.targetType !== TargetType.npm,
    ...(artifact['index.js'] && { main: 'index.js' }),
    ...(artifact.scripts && { scripts: artifact.scripts }),
    ...(artifact.dependencies && {
      dependencies: Object.fromEntries(
        Object.entries(artifact.dependencies).map(([key, value]) => [
          isFromThisMonorepo(key) ? toActualName(key) : key,
          value,
        ]),
      ),
    }),
    ...(artifact.devDependencies && {
      devDependencies: Object.fromEntries(
        Object.entries(artifact.devDependencies).map(([key, value]) => [
          isFromThisMonorepo(key) ? toActualName(key) : key,
          value,
        ]),
      ),
    }),
  }
}

function createPackages({ toActualName, repo }: { repo: Repo; toActualName: ToActualName }) {
  const isFromThisMonorepo = (depName: string) => Boolean(repo.packages?.some(artifact => artifact.name === depName))

  return Object.fromEntries(
    repo.packages?.map(artifact => {
      return [
        toActualName(artifact.name),
        {
          'package.json': createPackageJson({
            artifact,
            isFromThisMonorepo,
            toActualName,
          }),
          ...(artifact['index.js'] && { 'index.js': artifact['index.js'] }),
          ...(artifact.src && {
            src: artifact.src,
          }),
          ...(artifact.tests && {
            tests: artifact.tests,
          }),
          ...(artifact.targetType === TargetType.docker && {
            Dockerfile: `\
            FROM alpine
            CMD ["echo","hello"]
            `,
          }),
          ...artifact.additionalFiles,
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
