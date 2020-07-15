import winston from 'winston'
import chalk from 'chalk'
import randomColor from 'randomcolor'

const { combine, timestamp, printf } = winston.format

const moduleToColor = new Map<string, string>()

function randomModuleColor(module: string): string {
  const color = moduleToColor.get(module)
  if (color) {
    return chalk.hex(color)(module)
  } else {
    const newColor = randomColor({ luminosity: 'light' })
    moduleToColor.set(module, newColor)
    return chalk.hex(newColor)(module)
  }
}

const consoleTransport = new winston.transports.Console({
  format: combine(
    timestamp(),
    winston.format.colorize(),
    printf(
      ({ timestamp, module, level, message }) => `${timestamp} [${randomModuleColor(module)}] ${level}: ${message}`,
    ),
  ),
})

// eslint-disable-next-line no-process-env
const isNcTestMode = Boolean(process.env.NC_TEST_MODE)
const mainLogger = winston.createLogger({
  level: isNcTestMode ? 'debug' : 'info',
  transports: [consoleTransport],
  exceptionHandlers: [consoleTransport],
})

export const logger = (module: string): winston.Logger => mainLogger.child({ module })
