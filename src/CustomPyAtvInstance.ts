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

    private static log: PrefixLogger | undefined = undefined;

    private constructor(options: nodePyatv.NodePyATVInstanceOptions) {
        super(options);
    }

    public static async customFind(
        options: nodePyatv.NodePyATVFindAndInstanceOptions = {},
    ): Promise<nodePyatv.NodePyATVFindResponseObject> {
        return nodePyatv.NodePyATVInstance.find(this.extendOptions(options), true)
            .then(async (results) => {
                for (const device of results.devices) {
                    if (device.mac) {
                        CustomPyATVInstance.cachedDevices[device.mac.toUpperCase()] = device;
                    }
                }
                return results;
            });
    }

    public static deviceAdvanced(
        options: AlternatePyATVDeviceOptions | nodePyatv.NodePyATVDeviceOptions,
    ): nodePyatv.NodePyATVDevice | undefined {
        if (options.mac) {
            const cachedDevice: nodePyatv.NodePyATVDevice = CustomPyATVInstance.cachedDevices[options.mac.toUpperCase()];
            if (cachedDevice === undefined) {
                return undefined;
            }
            return super.device(this.extendOptions({
                ...options,
                host: cachedDevice.host,
                mac: cachedDevice.mac?.toUpperCase(),
                name: cachedDevice.name,
                id: cachedDevice.id,
                model: cachedDevice.model,
                modelName: cachedDevice.modelName,
                version: cachedDevice.version,
                os: cachedDevice.os,
                allIDs: cachedDevice.allIDs,
            }));
        } else {
            return super.device(this.extendOptions<nodePyatv.NodePyATVDeviceOptions>(options as nodePyatv.NodePyATVDeviceOptions));
        }
    }

    public static setStoragePath(storagePath: string): void {
        CustomPyATVInstance.atvscriptPath = path.join(storagePath, 'appletv-enhanced', '.venv', 'bin', 'atvscript');
        CustomPyATVInstance.atvremotePath = path.join(storagePath, 'appletv-enhanced', '.venv', 'bin', 'atvremote');
        CustomPyATVInstance.log?.debug(`Set atvscript path to "${CustomPyATVInstance.atvscriptPath}".`);
        CustomPyATVInstance.log?.debug(`Set atvremote path to "${CustomPyATVInstance.atvremotePath}".`);
    }

    public static setLogger(logger: LogLevelLogger | PrefixLogger): void {
        CustomPyATVInstance.log = new PrefixLogger(logger, 'CustomPyATVInstance');
    }

    public static getAtvremotePath(): string {
        return CustomPyATVInstance.atvremotePath || 'atvremote';
    }

    public static getAtvscriptPath(): string {
        return CustomPyATVInstance.atvremotePath || 'atvscript';
    }

    private static extendOptions<T extends nodePyatv.NodePyATVDeviceOptions | nodePyatv.NodePyATVInstanceOptions>(
        options: T,
    ): T {
        const debug = (msg: string): void => {
            if (CustomPyATVInstance.log) {
                // remove color
                // eslint-disable-next-line no-control-regex
                msg = msg.replace(/[\u001b\u009b][[()#;?]*(?:[0-9]{1,4}(?:;[0-9]{0,4})*)?[0-9A-ORZcf-nqry=><]/g, '');
                CustomPyATVInstance.log.verbose(msg);
            }
        };
        return {
            atvscriptPath: CustomPyATVInstance.atvscriptPath,
            atvremotePath: CustomPyATVInstance.atvremotePath,
            debug: debug,
            ...options,
        };
    }

    public async find(options?: nodePyatv.NodePyATVFindAndInstanceOptions): Promise<nodePyatv.NodePyATVDevice[]> {
        return CustomPyATVInstance.find(options);
    }
}

export default CustomPyATVInstance;
