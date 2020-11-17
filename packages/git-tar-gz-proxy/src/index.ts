import fastify from 'fastify'
import got from 'got'

// eslint-disable-next-line no-process-env
const env = process.env

const DEFAULT_AUTH = {
  GITHUB: {
    TOKEN: env.GITHUB_TOKEN || 'e228688513b757fcd0ef5bb00d662c2edb20c787',
  },
  BITBUCKET_CLOUD: {
    USERNAME: env.BITBUCKET_CLOUD_USERNAME || 'stavalfi-octopol',
    TOKEN: env.BITBUCKET_CLOUD_TOKEN || 'dtJN7SynXH6HtbtWQ7db',
  },
}

interface QueryStringOptions {
  git_registry: 'bitbucket-cloud' | 'github'
  git_org: string
  git_repo: string
  commit: string
}

function downloadFromGithub(options: QueryStringOptions, auth: typeof DEFAULT_AUTH) {
  const url = `https://api.github.com/repos/${options.git_org}/${options.git_repo}/tarball/${options.commit}`
  return got.stream(url, {
    headers: {
      Authorization: `token ${auth.GITHUB.TOKEN}`,
    },
  })
}

function downloadFromBitbucketCloud(options: QueryStringOptions, auth: typeof DEFAULT_AUTH) {
  const url = `https://${auth.BITBUCKET_CLOUD.USERNAME}:${auth.BITBUCKET_CLOUD.TOKEN}@bitbucket.org/${options.git_org}/${options.git_repo}/get/${options.commit}.tar.gz`
  return got.stream(url)
}

function download(options: QueryStringOptions, auth: typeof DEFAULT_AUTH) {
  switch (options.git_registry) {
    case 'github':
      return downloadFromGithub(options, auth)
    case 'bitbucket-cloud':
      return downloadFromBitbucketCloud(options, auth)
  }
}

/**
 * examples:
 * http://127.0.0.1:8080/download-git-repo-tar-gz?git_registry=github&git_org=stavalfi&git_repo=nc&commit=master
 * http://127.0.0.1:8080/download-git-repo-tar-gz?git_registry=bitbucket-cloud&git_org=octopoli&git_repo=dancer&commit=master
 * @param options
 */
export async function startGitTarGzProxyService(options?: {
  auth?: typeof DEFAULT_AUTH
  port?: number
}): Promise<string> {
  const app = fastify({
    logger: true,
  })

  app.get('/', async (_req, res) => res.send('alive'))

  app.get<{
    Querystring: QueryStringOptions
  }>('/download-git-repo-tar-gz', async (req, res) => res.send(download(req.query, options?.auth ?? DEFAULT_AUTH)))

  return app.listen(options?.port ?? env.PORT ?? 8080)
}

if (require.main === module) {
  startGitTarGzProxyService()
}
