/* eslint-disable no-console */
import express from 'express'
import got from 'got'
import http from 'http'
import WebSocket from 'ws'
import { buildRoutes } from './routes'
import { Db, Token } from './types'
import { initDb } from './utils'
import { listenNewConnections } from './ws-listener'

async function main() {
  console.log('starting molly-mock')

  const dbObject: { db: Db } = { db: initDb() }

  const app = buildRoutes(express(), dbObject)

  const server = http.createServer(app)

  const wss = new WebSocket.Server({ server, path: '/v1stream' })

  await listenNewConnections({ dbObject, wss })

  await new Promise(res => server.listen(80, res))

  console.log('molly-mock service is listening on port 80')

  const token = await got.post<Token>(`http://localhost:80/v1/sessions/`, {
    json: {
      username: 'stav',
      password: 'pass',
    },
    resolveBodyOnly: true,
    responseType: 'json',
  })

  const wsClient = new WebSocket(`ws://localhost:80/v1stream?token=${token.data.token}`, {
    perMessageDeflate: false,
  })

  wsClient.on('message', function incoming(data) {
    console.log(data)
  })
}

if (require.main === module) {
  // eslint-disable-next-line no-floating-promise/no-floating-promise
  main()
}
