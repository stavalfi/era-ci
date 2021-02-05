import { LogLevel } from '@era-ci/core'
import winston from 'winston'
import { randomModuleColor } from './modules-color'

export function formatLog(log: winston.Logform.TransformableInfo): string {
  const logLevel = log.level.replace('silly', LogLevel.trace)
  const withModule = log.module ? ` [${randomModuleColor(log.module)}] ` : ' '
  const base = `${log.timestamp}${withModule}${logLevel}`
  let final = ''
  if (log.stack) {
    // workaround to print error with stacktrace: https://github.com/winstonjs/winston/issues/1338#issuecomment-643473267
    let returnLog = `${base}: ${log.message.replace(log.stack.split('\n')[0].substr(7), '')}`
    returnLog += '\n'
    returnLog += '[' + logLevel + '] '
    returnLog += log.stack.replace(/\n/g, `\n[${logLevel}]\t`)
    final = `${returnLog}: `
  } else {
    final = `${base}: ${log.message}`
  }
  if (log.json && Object.keys(log.json).length > 0) {
    final += '\n'
    final += '[' + logLevel + '] '
    final += JSON.stringify(log.json, null, 2).replace(/\n/g, `\n[${logLevel}]\t`)
  }
  return final
}
