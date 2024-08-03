/* eslint-disable @typescript-eslint/no-explicit-any */
import type { Logger } from 'homebridge';

export enum LogLevel {
    NONE = 0,
    ERROR = 1,
    WARN = 2,
    INFO = 3,
    DEBUG = 4,
    VERBOSE = 5,
}

class LogLevelLogger {

    private readonly debugEnv: boolean = process.env.DEBUG !== undefined && process.env.DEBUG.toLowerCase() !== 'false';
    private readonly level: LogLevel;

    public constructor(
        private readonly log: Logger,
        level: LogLevel | undefined,
    ) {
        this.level =
            this.debugEnv === true ?
                LogLevel.DEBUG :
                level === undefined ?
                    LogLevel.INFO :
                    level;
    }

    public debug(message: string, ...parameters: any[]): void {
        if (this.level >= LogLevel.DEBUG) {
            this.log.info(`\u001B[90m[D] ${message}\u001B[39m`, ...parameters);
        }
    }

    public error(message: string, ...parameters: any[]): void {
        if (this.level >= LogLevel.ERROR) {
            this.log.error(`[E] ${message}`, ...parameters);
        }
    }

    public getLogLevel(): LogLevel {
        return this.level;
    }

    public info(message: string, ...parameters: any[]): void {
        if (this.level >= LogLevel.INFO) {
            this.log.info(`[I] ${message}`, ...parameters);
        }
    }

    public success(message: string, ...parameters: any[]): void {
        if (this.level >= LogLevel.INFO) {
            this.log.success(`[S] ${message}`, ...parameters);
        }
    }

    public verbose(message: string, ...parameters: any[]): void {
        if (this.level >= LogLevel.VERBOSE) {
            this.log.info(`\u001B[90m[V] ${message}\u001B[39m`, ...parameters);
        }
    }

    public warn(message: string, ...parameters: any[]): void {
        if (this.level >= LogLevel.WARN) {
            this.log.warn(`[W] ${message}`, ...parameters);
        }
    }
}

export default LogLevelLogger;
