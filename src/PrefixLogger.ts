/* eslint-disable @typescript-eslint/no-explicit-any */
import type LogLevelLogger from './LogLevelLogger';

class PrefixLogger {

    public constructor(
        private readonly log: LogLevelLogger | PrefixLogger,
        private prefix: string,
    ) { }

    public extendedDebug(message: string, ...parameters: any[]): void {
        this.log.extendedDebug(this.extendMessage(message), ...parameters);
    }

    public debug(message: string, ...parameters: any[]): void {
        this.log.debug(this.extendMessage(message), ...parameters);
    }

    public info(message: string, ...parameters: any[]): void {
        this.log.info(this.extendMessage(message), ...parameters);
    }

    public warn(message: string, ...parameters: any[]): void {
        this.log.warn(this.extendMessage(message), ...parameters);
    }

    public error(message: string, ...parameters: any[]): void {
        this.log.error(this.extendMessage(message), ...parameters);
    }

    public setPrefix(value: string): void {
        this.prefix = value;
    }

    private extendMessage(message: string): string {
        return `${this.prefix}: ${message}`;
    }
}

export default PrefixLogger;