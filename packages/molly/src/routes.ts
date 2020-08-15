/* eslint-disable no-console */
import bodyParser from 'body-parser'
import chance from 'chance'
import express, { Express } from 'express'
import {
  ActiveToken,
  MockedBet,
  MollyAccount,
  MollyOpenBetSlipRequest,
  MollyOpenBetSlipResponse,
  MollyPlaceOrderResponse,
  OpenedBetSlip,
  OrderReqBody,
  Token,
  Db,
} from './types'
import { authenticate, EXTEND_OPENED_BET_SLIP_TTL, initDb, OPENED_BET_SLIP_TTL } from './utils'
import { setTimeout } from 'timers'

export function buildRoutes(app: express.Express, dbObject: { db: Db }): express.Express {
  return (
    app
      .use(bodyParser.json())
      .post('/reset-mock', (req, res) => {
        dbObject.db = initDb()
      })
      .post<{}, unknown, MockedBet>('/set-mock-event', (req, res) => {
        // all data that i will send in the web-socket
        const bet = [...dbObject.db.mockedBets.keys()].find(
          bet1 =>
            bet1.betId.bet_type === req.body.betId.bet_type &&
            bet1.betId.event_id === req.body.betId.event_id &&
            bet1.betId.sport === req.body.betId.sport,
        )
        if (bet) {
          bet.mockedEvents = req.body.mockedEvents
        } else {
          dbObject.db.mockedBets.add(req.body)
        }

        res.end()
      })
      // open bit-slip
      .post<{}, MollyOpenBetSlipResponse, MollyOpenBetSlipRequest>('/v1/betslips/', async (req, res) => {
        const activeToken = authenticate(req, res, dbObject.db)

        if (!activeToken) {
          return
        }

        const openBetSlip = [
          ...(dbObject.db.OpenedBetSlips.get(activeToken.mollyAccount.username)?.values() || []),
        ].find(
          bet1 =>
            bet1.betId.bet_type === req.body.bet_type &&
            bet1.betId.event_id === req.body.event_id &&
            bet1.betId.sport === req.body.sport,
        )

        if (openBetSlip) {
          // todo: need to check if molly throw error or approve this
          res.status(403)
          return res.json(openBetSlip.mockedBet.openBetSlipResponse)
        }

        const mockedBet = [...dbObject.db.mockedBets.keys()].find(
          bet1 =>
            bet1.betId.bet_type === req.body.bet_type &&
            bet1.betId.event_id === req.body.event_id &&
            bet1.betId.sport === req.body.sport,
        )

        if (!mockedBet) {
          res.status(401)
          res.send({
            status: 'error',
            code: 'bet does not exist',
          })
          return
        }

        if (mockedBet.openBetSlipResponse.status !== 'ok') {
          // todo: placing manager is not using it so i don't implement it yet
          res.status(501)
          res.end()
        }

        const startDate = Date.now()
        const endDate = new Date(startDate)
        endDate.setMilliseconds(endDate.getMilliseconds() + OPENED_BET_SLIP_TTL)
        const openedBetSlip: OpenedBetSlip = {
          betId: req.body,
          mockedBet,
          username: activeToken.mollyAccount.username,
          mollyBetSlipId: mockedBet.openBetSlipResponse.data.betslip_id,
          startDate,
          endDate: endDate.getTime(),
          ttlInMs: OPENED_BET_SLIP_TTL,
        }

        const openBetslips = dbObject.db.OpenedBetSlips.get(activeToken.mollyAccount.username) || new Set()
        openBetslips.add(openedBetSlip)
        dbObject.db.OpenedBetSlips.set(activeToken.mollyAccount.username, openBetslips)

        res.json(mockedBet.openBetSlipResponse)

        const ws = dbObject.db.mollyAccountsWs.get(activeToken.mollyAccount.username)

        if (!ws) {
          console.error(
            `looks like the client didn't create a ws connection before opening a bet-slip. this implementation won't send any PMMs for this bet-slip.`,
          )
          return
        }

        const send = (data: string): Promise<void> =>
          new Promise((res, rej) => ws.send(data, error => (error ? rej(error) : res())))

        for (const event in mockedBet.mockedEvents) {
          if (Date.now() < openedBetSlip.endDate) {
            await send(JSON.stringify(event, null, 2))
          }
        }

        const dateNow = Date.now()
        if (dateNow < openedBetSlip.endDate) {
          const waitMs: number = Date.now() - Date.now()
          await new Promise(res => setTimeout(res, waitMs))
        }
      })
      // keep-alive
      .get('/v1/xrates/', (req, res) => {
        // ...
      })
      // Get open bet Slips at Molly
      .get('/v1/betslips/', (req, res) => {
        // todo: placing manager is not using it so i don't implement it yet
        res.status(501)
        res.end()
      })
      // extend bet-slip
      .post<{ mollyBetSlipId: string }>('/v1/betslips/:mollyBetSlipId/refresh/', (req, res) => {
        const activeToken = authenticate(req, res, dbObject.db)

        if (!activeToken) {
          return
        }

        const mollyBetSlipId = req.params.mollyBetSlipId

        const openBetSlip = [
          ...(dbObject.db.OpenedBetSlips.get(activeToken.mollyAccount.username)?.values() || []),
        ].find(bet1 => bet1.mollyBetSlipId === mollyBetSlipId)

        if (!openBetSlip) {
          res.status(401)
          res.send({
            status: 'error',
            code: `mollyBetSlipId: ${mollyBetSlipId} doesn't exist`,
          })
          return
        }

        openBetSlip.ttlInMs += EXTEND_OPENED_BET_SLIP_TTL

        res.end()
      })
      // place bet
      .post<{}, MollyPlaceOrderResponse, OrderReqBody>('/v1/orders/', (req, res) => {
        res.status(501)
        res.end()
      })
      // request for token to open bet-slip socket
      .post<{}, Token, MollyAccount>('/v1/sessions/', (req, res) => {
        const isAccountFound = [...dbObject.db.mollyAccounts.keys()].some(
          account => account.username === req.body.username && account.password === req.body.password,
        )
        if (!isAccountFound) {
          res.status(401)
          res.end()
          return
        }

        const activeToken: ActiveToken = {
          mollyAccount: {
            username: req.body.username,
            password: req.body.password,
          },
          token: {
            data: {
              token: chance().hash(),
            },
          },
        }
        dbObject.db.activeTokens.add(activeToken)
        console.log('added token: ', JSON.stringify(activeToken, null, 2))
        res.json(activeToken.token)
      })
      .get('/', (_req, res) => res.end('alive'))
  )
}
