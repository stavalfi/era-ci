export enum LogLevel {
  error = 'error',
  info = 'info',
  verbose = 'verbose',
}

export type Log = {
  [LogLevel.error]: (message: string, error?: unknown) => void
  [LogLevel.info]: (message: string) => void
  [LogLevel.verbose]: (message: string) => void
  noFormattingInfo: (message: string) => void
  noFormattingError: (message: string) => void
  infoFromStream: (stream: NodeJS.ReadableStream) => void
  errorFromStream: (stream: NodeJS.ReadableStream) => void
}

export type Logger = (moduleName: string) => Log
