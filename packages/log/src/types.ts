export enum LogLevel {
  error = 'error',
  info = 'info',
  verbose = 'verbose',
}

export type Log = {
  [LogLevel.error]: (message: string, error?: unknown) => void
  [LogLevel.info]: (message: string) => void
  [LogLevel.verbose]: (message: string) => void
  fromStream: (logLevel: LogLevel, stream: NodeJS.ReadableStream) => void
}
