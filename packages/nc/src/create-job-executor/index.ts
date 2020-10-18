import { Log, Logger, LogLevel } from './types'

export { Log, Logger, LogLevel }

export type CreateLogger = {
  callInitializeLogger: (options: { repoPath: string }) => Promise<Logger>
}

export function createLogger<
  LoggerConfigurations = void,
  NormalizedLoggerConfigurations = LoggerConfigurations
>(createLoggerOptions: {
  normalizeLoggerConfigurations?: (options: {
    loggerConfigurations: LoggerConfigurations
    repoPath: string
  }) => Promise<NormalizedLoggerConfigurations>
  initializeLogger: (options: { loggerConfigurations: NormalizedLoggerConfigurations }) => Promise<Logger>
}) {
  return (loggerConfigurations: LoggerConfigurations): CreateLogger => ({
    callInitializeLogger: async ({ repoPath }) => {
      // @ts-ignore - we need to find a way to ensure that if NormalizedLoggerConfigurations is defined, also normalizedLoggerConfigurations is defined.
      const normalizedLoggerConfigurations: NormalizedLoggerConfigurations = createLoggerOptions.normalizeLoggerConfigurations
        ? await createLoggerOptions.normalizeLoggerConfigurations({ loggerConfigurations, repoPath })
        : loggerConfigurations
      return createLoggerOptions.initializeLogger({ loggerConfigurations: normalizedLoggerConfigurations })
    },
  })
}
