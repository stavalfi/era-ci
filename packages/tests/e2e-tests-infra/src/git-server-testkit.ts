/// <reference path="../../../../declarations.d.ts" />

import { createFolder } from '@stavalfi/create-folder-structure'
import { Server } from 'http'
import { URL } from 'url'
import NodeGitServer from 'node-git-server'

type NodeGitServerInstance = {
  close: () => Promise<void>
  create: (repoName: string, cb: () => void) => void
  listen: (port: number, cb: (err: unknown) => void) => void
  server: Server
}

export type GitServer = {
  getUsername: () => string
  getToken: () => string
  generateGitRepositoryAddress: (scope: string, name: string) => string
  close: () => Promise<void>
  createRepository: (scope: string, name: string) => Promise<void>
  getServerInfo: () => {
    port: number
    host: string
    protocol: string
  }
}

const getPort = (server: Server): number => {
  const result1 = server.address()
  if (!result1) {
    throw new Error('could not start git-server. address is null')
  }
  return Number(typeof result1 === 'string' ? new URL(result1).port : 'port' in result1 && result1.port)
}

export const starGittServer = async (): Promise<GitServer> => {
  const username = 'root'
  const token = 'root'

  const server: NodeGitServerInstance = new NodeGitServer(await createFolder(), {
    authenticate: ({ type, user }, next) => {
      if (type == 'push') {
        user((user, userToken) => {
          if (user !== username) {
            throw new Error(`username is incorrect: it is "${user}" instead of "${username}"`)
          }
          if (token !== userToken) {
            throw new Error(`token is incorrect: it is "${userToken}" instead of "${token}"`)
          }
          next()
        })
      } else {
        next()
      }
    },
  })

  await new Promise<void>((res, rej) => server.listen(0, err => (err ? rej(err) : res())))

  const port = getPort(server.server)
  const connectionType = 'http'
  const ip = 'localhost'

  return {
    getUsername: () => username,
    getToken: () => token,
    generateGitRepositoryAddress: (scope, name) =>
      `${connectionType}://${username}:${token}@${ip}:${port}/${scope}/${name}.git`,
    close: async () => {
      await server.close()
      // eslint-disable-next-line no-console
      console.log('closed git server')
    },
    createRepository: async (scope, name) => {
      await new Promise<void>(res => server.create(`${scope}/${name}`, res))
    },
    getServerInfo: () => ({
      port,
      host: ip,
      protocol: connectionType,
    }),
  }
}
