import { CreateLogger, Log, Logger, LogLevel } from './types'

export { CreateLogger, Log, Logger, LogLevel }

export function createLogger<
  LoggerConfigurations = void,
  NormalizedLoggerConfigurations = LoggerConfigurations
>(createLoggerOptions: {
  normalizeLoggerConfigurations?: (options: {
    loggerConfigurations: LoggerConfigurations
    repoPath: string
    disableFileOutput?: boolean
    customLog?: (...values: unknown[]) => void
  }) => Promise<NormalizedLoggerConfigurations>
  initializeLogger: (options: {
    loggerConfigurations: NormalizedLoggerConfigurations
    flowId: string
  }) => Promise<Logger>
}) {
  return (loggerConfigurations: LoggerConfigurations): CreateLogger => ({
    callInitializeLogger: async ({ repoPath, disableFileOutput, flowId }) => {
      // @ts-ignore - we need to find a way to ensure that if NormalizedLoggerConfigurations is defined, also normalizedLoggerConfigurations is defined.
      const normalizedLoggerConfigurations: NormalizedLoggerConfigurations = createLoggerOptions.normalizeLoggerConfigurations
        ? await createLoggerOptions.normalizeLoggerConfigurations({ loggerConfigurations, repoPath, disableFileOutput })
        : loggerConfigurations
      return createLoggerOptions.initializeLogger({ loggerConfigurations: normalizedLoggerConfigurations, flowId })
    },
  })
}
