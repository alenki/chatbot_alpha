import { pino, type Logger } from 'pino'

export type { Logger }

export function createLogger(nodeEnv: string = process.env.NODE_ENV ?? 'development'): Logger {
  const level = nodeEnv === 'production' ? 'info' : nodeEnv === 'test' ? 'silent' : 'debug'
  if (nodeEnv === 'development') {
    return pino({
      level,
      transport: {
        target: 'pino-pretty',
        options: { colorize: true, translateTime: 'SYS:HH:MM:ss' },
      },
    })
  }
  return pino({ level })
}

/** Root logger for the process; child loggers via log.child({ module: '...' }). */
export const log: Logger = createLogger()
