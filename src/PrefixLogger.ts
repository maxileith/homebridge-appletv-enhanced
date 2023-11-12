/* eslint-disable @typescript-eslint/no-explicit-any */
import type { Logger } from 'homebridge';

class PrefixLogger {

    public constructor(
        private readonly log: Logger | PrefixLogger,
        private prefix: string,
    ) { }

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