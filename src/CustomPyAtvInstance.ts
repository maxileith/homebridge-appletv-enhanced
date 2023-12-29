import * as nodePyatv from '@sebbo2002/node-pyatv';
import path from 'path';
import type { AlternatePyATVDeviceOptions } from './interfaces';
import PrefixLogger from './PrefixLogger';
import type LogLevelLogger from './LogLevelLogger';


type ICache = Record<string, nodePyatv.NodePyATVDevice>;

class CustomPyATVInstance extends nodePyatv.NodePyATVInstance {

    private static cachedDevices: ICache = {};

    private static atvscriptPath: string | undefined = undefined;
    private static atvremotePath: string | undefined = undefined;

    private constructor(options: nodePyatv.NodePyATVInstanceOptions) {
        super(options);
    }

    public static async find(options?: nodePyatv.NodePyATVFindAndInstanceOptions): Promise<nodePyatv.NodePyATVDevice[]> {
        return nodePyatv.NodePyATVInstance.find(this.extendOptions(options))
            .then(async (results) => {
                for (const result of results) {
                    if (result.mac) {
                        this.cachedDevices[result.mac] = result;
                    }
                }
                return results;
            });
    }

    public static deviceAdvanced(
        options: AlternatePyATVDeviceOptions | nodePyatv.NodePyATVDeviceOptions,
    ): nodePyatv.NodePyATVDevice | undefined {
        if (options.mac) {
            const cachedDevice: nodePyatv.NodePyATVDevice = this.cachedDevices[options.mac];
            if (cachedDevice === undefined) {
                return undefined;
            }
            return super.device(this.extendOptions({
                ...options,
                host: cachedDevice.host,
                mac: cachedDevice.mac,
                name: cachedDevice.name,
                id: cachedDevice.id,
                model: cachedDevice.model,
                modelName: cachedDevice.modelName,
                version: cachedDevice.version,
                os: cachedDevice.os,
            }));
        }
        return super.device(this.extendOptions<nodePyatv.NodePyATVDeviceOptions>(options as nodePyatv.NodePyATVDeviceOptions));
    }

    public static setStoragePath(storagePath: string, logger?: LogLevelLogger | PrefixLogger): void {
        this.atvscriptPath = path.join(storagePath, 'appletv-enhanced', '.venv', 'bin', 'atvscript');
        this.atvremotePath = path.join(storagePath, 'appletv-enhanced', '.venv', 'bin', 'atvremote');
        if (logger) {
            const log: PrefixLogger = new PrefixLogger(logger, 'CustomPyATVInstance');
            log.debug(`Set atvscript path to "${this.atvscriptPath}".`);
            log.debug(`Set atvremote path to "${this.atvremotePath}".`);
        }
    }

    public static getAtvremotePath(): string {
        return this.atvremotePath || 'atvremote';
    }

    public static getAtvscriptPath(): string {
        return this.atvremotePath || 'atvscript';
    }

    private static extendOptions<T extends nodePyatv.NodePyATVDeviceOptions | nodePyatv.NodePyATVInstanceOptions | undefined>(
        options: T,
    ): T {
        return {
            atvscriptPath: this.atvscriptPath,
            atvremotePath: this.atvremotePath,
            ...options,
        };
    }

    public async find(options?: nodePyatv.NodePyATVFindAndInstanceOptions): Promise<nodePyatv.NodePyATVDevice[]> {
        return CustomPyATVInstance.find(options);
    }
}

export default CustomPyATVInstance;
