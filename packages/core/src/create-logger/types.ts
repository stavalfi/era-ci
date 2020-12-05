export enum LogLevel {
  error = 'error',
  info = 'info',
  verbose = 'verbose',
  debug = 'debug',
  trace = 'trace',
}

export type Log = {
  [LogLevel.error]: (message: string, error?: unknown, json?: Record<string, unknown>) => void
  [LogLevel.info]: (message: string, json?: Record<string, unknown>) => void
  [LogLevel.verbose]: (message: string, json?: Record<string, unknown>) => void
  [LogLevel.debug]: (message: string, json?: Record<string, unknown>) => void
  [LogLevel.trace]: (message: string, json?: Record<string, unknown>) => void
  noFormattingInfo: (message: string) => void
  noFormattingError: (message: string) => void
  infoFromStream: (stream: NodeJS.ReadableStream) => void
  errorFromStream: (stream: NodeJS.ReadableStream) => void
}

export type Logger = {
  logFilePath: string
  createLog: (moduleName: string, options?: { disable?: boolean }) => Log
}

export type CreateLogger = {
  callInitializeLogger: (options: { repoPath: string }) => Promise<Logger>
}
