/* eslint-disable @typescript-eslint/no-explicit-any */
import type { Logger } from 'homebridge';

export enum LogLevel {
    NONE = 0,
    ERROR = 1,
    WARN = 2,
    INFO = 3,
    DEBUG = 4,
}

class LogLevelLogger {

    private readonly level: LogLevel;
    private readonly debugEnv: boolean = process.env.DEBUG !== undefined && process.env.DEBUG.toLowerCase() !== 'false';

    public constructor(
        private readonly log: Logger,
        level: LogLevel | undefined,
    ) {
        this.level = this.debugEnv === true ? LogLevel.DEBUG : (level || LogLevel.INFO);
    }

    public debug(message: string, ...parameters: any[]): void {
        if (this.level >= LogLevel.DEBUG) {
            this.log.info(`\u001B[90m${message}\u001B[39m`, ...parameters);
        }
    }

    public info(message: string, ...parameters: any[]): void {
        if (this.level >= LogLevel.INFO) {
            this.log.info(message, ...parameters);
        }
    }

    public warn(message: string, ...parameters: any[]): void {
        if (this.level >= LogLevel.WARN) {
            this.log.warn(message, ...parameters);
        }
    }

    public error(message: string, ...parameters: any[]): void {
        if (this.level >= LogLevel.ERROR) {
            this.log.error(message, ...parameters);
        }
    }

    public getLogLevel(): LogLevel {
        return this.level;
    }

}

export default LogLevelLogger;
