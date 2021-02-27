import { PackageManager } from '@era-ci/utils/src'
import { createFolder, FolderStructure } from '@stavalfi/create-folder-structure'
import chance from 'chance'
import execa from 'execa'
import path from 'path'
import { GitServer } from './git-server-testkit'
import { Package, PackageJson, Repo, TargetType, ToActualName } from './types'

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
}): Promise<void> {
  await execa.command('git init', { cwd: repoPath, stdio: 'pipe' })
  await execa.command(`git config user.email "test@test.com"`, { cwd: repoPath, stdio: 'pipe' })
  await execa.command(`git config user.name "test-user"`, { cwd: repoPath, stdio: 'pipe' })

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
  npmRegistryAddressToPublish,
}: {
  artifact: Package
  toActualName: ToActualName
  isFromThisMonorepo: (depName: string) => boolean
  npmRegistryAddressToPublish: string
}): PackageJson {
  return {
    name: toActualName(artifact.name),
    version: artifact.version,
    publishConfig: {
      access: 'public',
      registry: npmRegistryAddressToPublish,
    },
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

function createPackages({
  toActualName,
  repo,
  npmRegistryAddressToPublish,
}: {
  repo: Repo
  toActualName: ToActualName
  npmRegistryAddressToPublish: string
}): {
  [k: string]: {
    'index.js'?: string
    Dockerfile?: string
    tests?: FolderStructure
    src?: FolderStructure
    'package.json': PackageJson
  }
} {
  const isFromThisMonorepo = (depName: string) => Boolean(repo.packages?.some(artifact => artifact.name === depName))

  return Object.fromEntries(
    repo.packages?.map(artifact => {
      const packageName = toActualName(artifact.name)
      const packageDirName = packageName.replace('/', '-').replace('@', '')
      return [
        packageDirName,
        {
          'package.json': createPackageJson({
            artifact,
            isFromThisMonorepo,
            toActualName,
            npmRegistryAddressToPublish,
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

export async function createGitRepo({
  toActualName,
  repo,
  gitServer,
  gitIgnoreFiles,
  npm,
  packageManager,
  processEnv,
  overrideInitialInstallNpmRegistry,
}: {
  overrideInitialInstallNpmRegistry?: string
  repo: Repo
  gitServer: GitServer
  toActualName: ToActualName
  gitIgnoreFiles: Array<string>
  npm: {
    address: string
    auth: {
      username: string
      password: string
      email: string
    }
  }
  packageManager: PackageManager
  processEnv: NodeJS.ProcessEnv
}): Promise<{
  repoPath: string
  repoName: string
  repoOrg: string
  packagesFolderPath: string
  subPackagesFolderPath: string
}> {
  const repoOrg = toActualName('org')
  const repoName = `repo-${chance().hash().slice(0, 8)}`
  const packagesFolderName = 'packages'
  const subPackagesFolderName = 'more-packages'

  const repoPath = await createFolder({
    'package.json': {
      name: repoName,
      version: '1.0.0',
      private: true,
      license: 'UNLICENSED',
      workspaces: [`${packagesFolderName}/*`, `${packagesFolderName}/${subPackagesFolderName}/*`],
      ...repo.rootPackageJson,
    },
    '.gitignore': `\
node_modules
.yarn/*
!.yarn/cache
!.yarn/releases
!.yarn/plugins
!.yarn/sdks
!.yarn/versions
${gitIgnoreFiles.join('\n')}\
    `,
    packages: {
      ...createPackages({
        repo,
        toActualName,
        npmRegistryAddressToPublish: npm.address,
      }),
      [subPackagesFolderName]: {
        '.gitkeep': '',
      },
    },
    ...repo.rootFiles,
  })

  const packagesFolderPath = path.join(repoPath, packagesFolderName)
  const subPackagesFolderPath = path.join(packagesFolderPath, subPackagesFolderName)

  switch (packageManager) {
    case PackageManager.yarn1: {
      // await execa.command(`yarn set version 1.22.10`, { cwd: repoPath, stdio: 'pipe', extendEnv: false })
      const registry = overrideInitialInstallNpmRegistry ?? npm.address
      await execa.command(`yarn install --registry ${registry}`, {
        cwd: repoPath,
        stdio: 'pipe',
        extendEnv: false,
      })
      break
    }
    case PackageManager.yarn2: {
      throw new Error(`not supported yet`)
      // the following code is an alternative to download yarn2 which decrease this step from 1.8s -> 10ms (for every test!)
      //       await fs.promises.mkdir(path.join(repoPath, '.yarn', 'releases'), { recursive: true })
      //       await Promise.all([
      //         fs.promises.copyFile(
      //           path.join(__dirname, '..', '..', '..', '..', '.yarn', 'install-state.gz'),
      //           path.join(repoPath, '.yarn', 'install-state.gz'),
      //         ),
      //         fs.promises.copyFile(
      //           path.join(__dirname, '..', '..', '..', '..', '.yarn', 'releases', 'yarn-2.4.0.cjs'),
      //           path.join(repoPath, '.yarn', 'releases', 'yarn-2.4.0.cjs'),
      //         ),
      //         fs.promises.copyFile(path.join(__dirname, '..', '..', '..', '..', '.pnp.js'), path.join(repoPath, '.pnp.js')),
      //         fs.promises.writeFile(
      //           path.join(repoPath, '.yarnrc.yml'),
      //           `yarnPath: ${path.join('.yarn', 'releases', 'yarn-2.4.0.cjs')}
      // unsafeHttpWhitelist:
      //   - "${new URL(npm.address).hostname}"`,
      //           'utf-8',
      //         ),
      //       ])
      //       // TODO: install from verdaccio
      //       await execa.command(`yarn install`, { cwd: repoPath, stdio: 'pipe' })
      break
    }
  }

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
