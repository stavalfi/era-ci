/* eslint-disable no-console */
import queryString from 'query-string'
import { of } from 'rxjs'
import { concatMap, filter, tap } from 'rxjs/operators'
import { Db, MollySocketDataMessage } from './types'
import WebSocket from 'ws'

export async function listenNewConnections({ dbObject, wss }: { dbObject: { db: Db }; wss: WebSocket.Server }) {
  wss.on('connection', async function connection(ws, req) {
    const send = (data: string): Promise<void> =>
      new Promise((res, rej) => ws.send(data, error => (error ? rej(error) : res())))

    // need to check that the end of the path is: ?token=${this.token}

    // ws.send: JSON.strigify of:
    interface MollyAsyncMsgEnvelope {
      ts: number
      data: MollySocketDataMessage[]
    }

    const {
      query: { token },
    } = queryString.parseUrl(req.url || '')

    const username = [...dbObject.db.activeTokens.keys()].find(activeToken => activeToken.token.data.token === token)
      ?.mollyAccount?.username

    if (!username) {
      await send('token is missing or invalid')
      return ws.close()
    }

    const { unsubscribe } = dbObject.db.newOpenBetSlip$
      .pipe(
        filter(openedBetSlip => openedBetSlip.username === username),
        filter(openedBetSlip => {
          const endDate = new Date(openedBetSlip.startDate)
          endDate.setMilliseconds(endDate.getMilliseconds() + openedBetSlip.ttlInMs)
          return new Date() < endDate
        }),
        concatMap(openedBetSlip => {
          const x$ = of(openedBetSlip.mockedBet.mockedEvents).pipe(
            tap(mockedEvent =>
              console.log(
                `mollyBetSlipId: "${openedBetSlip.mollyBetSlipId}" sent event to ${username}: ${JSON.stringify(
                  mockedEvent,
                  null,
                  2,
                )}`,
              ),
            ),
            concatMap(mockedEvent => send(JSON.stringify(mockedEvent))),
          )
          return x$
        }),
      )
      .subscribe({
        next: () => {
          // nothing to do here
        },
      })

    ws.onclose = () => unsubscribe()
  })
}
