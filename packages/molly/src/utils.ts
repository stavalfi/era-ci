import { Request, Response } from 'express'
import { ActiveToken, Db, MockedBet, MollyAccount, OpenedBetSlip, MollyAccountUsername } from './types'
import WebSocket from 'ws'

export const OPENED_BET_SLIP_TTL = 60 * 1000
export const EXTEND_OPENED_BET_SLIP_TTL = 60 * 1000

export function initDb(): Db {
  return {
    mollyAccounts: new Set<MollyAccount>([{ username: 'stav', password: 'pass' }]),
    mockedBets: new Set<MockedBet>(),
    OpenedBetSlips: new Map<MollyAccountUsername, Set<OpenedBetSlip>>(),
    activeTokens: new Set<ActiveToken>(),
    mollyAccountsWs: new Map<MollyAccountUsername, WebSocket>(),
  }
}

export function authenticate(req: Request, res: Response, db: Db): ActiveToken | undefined {
  const token = req.header('Session')
  const acrtiveToken = [...db.activeTokens.keys()].find(activeToken => activeToken.token.data.token === token)

  if (!acrtiveToken) {
    res.status(401)
    res.send({
      status: 'error',
      code: 'token is invalid or empty',
    })
    return
  }
  return acrtiveToken
}
