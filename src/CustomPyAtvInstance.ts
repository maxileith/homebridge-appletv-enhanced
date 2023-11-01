import * as nodePyatv from '@sebbo2002/node-pyatv';
import { Logger } from 'homebridge';
import path from 'path';
import { AlternatePyATVDeviceOptions } from './interfaces';


interface ICache {
    [k: string]: nodePyatv.NodePyATVDevice;
}

class CustomPyATVInstance extends nodePyatv.NodePyATVInstance {

    private static cachedDevices: ICache = {};

    private static atvscriptPath: string | undefined = undefined;
    private static atvremotePath: string | undefined = undefined;

    private constructor(options: nodePyatv.NodePyATVInstanceOptions) {
        super(options);
    }

    public async find(options?: nodePyatv.NodePyATVFindAndInstanceOptions): Promise<nodePyatv.NodePyATVDevice[]> {
        return CustomPyATVInstance.find(options);
    }

    public static async find(options?: nodePyatv.NodePyATVFindAndInstanceOptions): Promise<nodePyatv.NodePyATVDevice[]> {
        return nodePyatv.NodePyATVInstance.find(this.extendOptions(options)).then(async (results) => {
            for (const result of results) {
                this.cachedDevices[result.id!] = result;
            }
            return results;
        });
    }

    public static deviceAdvanced(options: nodePyatv.NodePyATVDeviceOptions | AlternatePyATVDeviceOptions): nodePyatv.NodePyATVDevice | undefined {
        if (options.id) {
            const cachedDevice = this.cachedDevices[options.id];
            if (cachedDevice === undefined) {
                return undefined;
            }
            return super.device(this.extendOptions({
                ...options,
                host: cachedDevice.host,
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

    public static setStoragePath(storagePath: string, logger?: Logger): void {
        this.atvscriptPath = path.join(storagePath, 'appletv-enhanced', '.venv', 'bin', 'atvscript');
        this.atvremotePath = path.join(storagePath, 'appletv-enhanced', '.venv', 'bin', 'atvremote');
        if (logger) {
            logger.debug(`PyATVInstance: Set atvscript path to "${this.atvscriptPath}".`);
            logger.debug(`PyATVInstance: Set atvremote path to "${this.atvremotePath}".`);
        }
    }

    private static extendOptions<T extends nodePyatv.NodePyATVDeviceOptions | nodePyatv.NodePyATVInstanceOptions | undefined>(options: T): T {
        return {
            atvscriptPath: this.atvscriptPath,
            atvremotePath: this.atvremotePath,
            ...options,
        };
    }

    public static getAtvremotePath(): string {
        return this.atvremotePath || 'atvremote';
    }

    public static getAtvscriptPath(): string {
        return this.atvremotePath || 'atvscript';
    }
}

export default CustomPyATVInstance;
