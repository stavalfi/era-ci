export enum LogLevel {
  error = 'error',
  info = 'info',
  verbose = 'verbose',
  debug = 'debug',
}

export type Log = {
  [LogLevel.error]: (message: string, error?: unknown) => void
  [LogLevel.info]: (message: string) => void
  [LogLevel.verbose]: (message: string) => void
  [LogLevel.debug]: (message: string) => void
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
