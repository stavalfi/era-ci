import winston from 'winston'
import chalk from 'chalk'
import randomColor from 'randomcolor'
import ciInfo from 'ci-info'

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
  stderrLevels: ['error'],
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
  silent: ciInfo.isCI && isNcTestMode,
  level: isNcTestMode ? 'verbose' : 'info',
  transports: [consoleTransport],
})

export const addLogfile = (logsPath: string): void => {
  mainLogger.add(new winston.transports.File({ filename: logsPath, level: 'verbose' }))
}

export const logger = (module: string): winston.Logger => mainLogger.child({ module })
