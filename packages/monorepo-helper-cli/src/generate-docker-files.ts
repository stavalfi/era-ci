import { findAllRecursiveDepsOfPackage } from './utils'
import fs from 'fs'
import path from 'path'
import { WorkspacesInfo } from '@era-ci/utils'

const packageNameToArg = (packageName: string) =>
  packageName.split('/')[packageName.split('/').length - 1].split('-').join('_')

function generateDockerfile(repoPath: string, graph: WorkspacesInfo, packageJsonName: string): string {
  const deps = findAllRecursiveDepsOfPackage(repoPath, graph, packageJsonName)

  const args = deps.map(dep => `ARG ${packageNameToArg(dep)}_path=${graph[dep].location}`).join('\n')

  const firstCopies = deps
    .map(
      dep =>
        `\
COPY \${${packageNameToArg(dep)}_path}/package.json ./\${${packageNameToArg(dep)}_path}/package.json
COPY \${${packageNameToArg(dep)}_path}/tsconfig-build.json ./\${${packageNameToArg(dep)}_path}/tsconfig-build.json\
`,
    )
    .join('\n\n')

  const secondCopies = deps
    .map(dep => `COPY \${${packageNameToArg(dep)}_path}/src ./\${${packageNameToArg(dep)}_path}/src`)
    .join('\n\n')

  const dockerfile = `\
FROM quay.io/eraci/node:15.7.0-alpine3.10

WORKDIR /usr/service

# this line is because of 'highwayhash'
RUN apk add make g++ python3 py3-pip

COPY yarn.lock package.json tsconfig.json tsconfig-build.json declarations.d.ts ./

${args}

${firstCopies}

RUN npx @era-ci/monorepo-helper-cli remove-all-dev-deps-not-related-to --repo-path /usr/service ${packageJsonName} \\
        --except-deps typescript,@types/* && \\
    yarn install

${secondCopies}

RUN yarn build

CMD yarn workspace ${packageJsonName} start:prod\
`

  return dockerfile
}

export async function generateDockerfiles(
  repoPath: string,
  graph: WorkspacesInfo,
  packageJsonNames: string[],
): Promise<void> {
  const filtered = packageJsonNames.filter(p => fs.existsSync(path.join(repoPath, graph[p].location, 'Dockerfile')))

  const dockerfiles = filtered.map(p => generateDockerfile(repoPath, graph, p))

  await Promise.all(
    filtered.map((p, i) =>
      fs.promises.writeFile(path.join(repoPath, graph[p].location, 'Dockerfile'), dockerfiles[i], 'utf-8'),
    ),
  )
}
