/* eslint-disable @typescript-eslint/no-explicit-any */
import { Logger } from 'homebridge';

class AccessoryLogger {

    private readonly logger: Logger;

    private appleTVName: string;
    private readonly appleTVID: string;

    public constructor(logger: Logger, appleTVName: string, appleTVID: string) {
        this.logger = logger;
        this.appleTVName = appleTVName;
        this.appleTVID = appleTVID;
    }

    public debug(message: string, ...parameters: any[]): void {
        this.logger.debug(this.extendMessage(message), ...parameters);
    }

    public info(message: string, ...parameters: any[]): void {
        this.logger.info(this.extendMessage(message), ...parameters);
    }

    public warn(message: string, ...parameters: any[]): void {
        this.logger.warn(this.extendMessage(message), ...parameters);
    }

    public error(message: string, ...parameters: any[]): void {
        this.logger.error(this.extendMessage(message), ...parameters);
    }

    private extendMessage(message: string): string {
        return `${this.appleTVName} (${this.appleTVID}): ${message}`;
    }

    public setAppleTVName(value: string): void {
        this.appleTVName = value;
    }
}

export default AccessoryLogger;