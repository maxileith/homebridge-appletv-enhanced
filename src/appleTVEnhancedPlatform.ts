import type { API, DynamicPlatformPlugin, Logger, PlatformAccessory, Service, Characteristic } from 'homebridge';
import { PLUGIN_NAME } from './settings';
import { AppleTVEnhancedAccessory } from './appleTVEnhancedAccessory';
import CustomPyAtvInstance from './CustomPyAtvInstance';
import type { AppleTVEnhancedPlatformConfig } from './interfaces';
import type { NodePyATVDevice, NodePyATVFindResponseObject } from '@sebbo2002/node-pyatv';
import PythonChecker from './PythonChecker';
import PrefixLogger from './PrefixLogger';
import LogLevelLogger from './LogLevelLogger';
import { hostname } from 'os';

// compatible model identifiers according to https://pyatv.dev/api/const/#pyatv.const.DeviceModel
const ALLOWED_MODELS: string[] = [
    'Gen4',
    'Gen4K',
    'AppleTV4KGen2',
    'AppleTV4KGen3',
];

const DEV_MODE: boolean = process.env.APPLETV_ENHANCED_DEV?.toLowerCase() === 'true';

export class AppleTVEnhancedPlatform implements DynamicPlatformPlugin {
    public readonly characteristic: typeof Characteristic;
    public readonly logLevelLogger: LogLevelLogger;
    public readonly service: typeof Service;
    private atvAccessories: AppleTVEnhancedAccessory[] = [];

    private readonly log: PrefixLogger;
    private readonly publishedUUIDs: string[] = [];

    public constructor(
        ogLog: Logger,
        public readonly config: AppleTVEnhancedPlatformConfig,
        public readonly api: API,
    ) {
        this.logLevelLogger = new LogLevelLogger(ogLog, this.config.logLevel);
        this.log = new PrefixLogger(this.logLevelLogger, 'Platform');

        this.service = this.api.hap.Service;
        this.characteristic = this.api.hap.Characteristic;

        if (DEV_MODE === true) {
            this.log.warn('Development mode activated');
        }

        this.log.info('Finished initializing platform:', this.config.name);

        // When this event is fired it means Homebridge has restored all cached accessories from disk.
        // Dynamic Platform plugins should only register new accessories after this event was fired,
        // in order to ensure they weren't added to homebridge already. This event can also be used
        // to start discovery of new accessories.
        // eslint-disable-next-line @typescript-eslint/no-misused-promises
        this.api.on('didFinishLaunching', async (): Promise<void> => {
            this.log.debug('Executed didFinishLaunching callback');

            // make sure the Python environment is ready
            await new PythonChecker(this.logLevelLogger, this.api.user.storagePath(), this.config.pythonExecutable)
                .allInOne(this.config.forceVenvRecreate);

            // run the method to discover / register your devices as accessories
            this.log.debug(`Setting the storage path of the PyATV instance to ${this.api.user.storagePath()}`);
            CustomPyAtvInstance.setLogger(this.logLevelLogger);
            CustomPyAtvInstance.setStoragePath(this.api.user.storagePath());

            if (
                this.config.discover?.multicast === false &&
                (this.config.discover.unicast === undefined || this.config.discover.unicast.length === 0)
            ) {
                this.log.error('Neither multicast nor unicast discovery is enabled.');
                return;
            }

            this.log.info('Starting device discovery ...');
            void this.discoverDevices();
            setInterval(() => {
                void this.discoverDevices();
            }, 60000);
            setTimeout(() => {
                this.warnNoDevices();
            }, 150000);
        });

        // Shutdown event will stop all ATV accessories
        this.api.on('shutdown', (): void => {
            for (const atvAccessory of this.atvAccessories) {
                atvAccessory.stop().catch(() => {
                    this.log.error(`Failed to stop ${atvAccessory.name} (${atvAccessory.mac})`);
                });
            }
        });
    }

    // eslint-disable-next-line @typescript-eslint/no-unused-vars, @typescript-eslint/no-empty-function
    public configureAccessory(_accessory: PlatformAccessory): void { }

    /**
   * This is an example method showing how to register discovered accessories.
   * Accessories must only be registered once, previously created accessories
   * must not be registered again to prevent "duplicate UUID" errors.
   */
    private async discoverDevices(): Promise<void> {
        this.log.debug('Starting device discovery ...');
        let scanResults: NodePyATVDevice[] = [];

        // multicast discovery
        if (
            this.config.discover?.multicast === undefined ||
            this.config.discover.multicast === true
        ) {
            try {
                const multicastResults: NodePyATVFindResponseObject = await CustomPyAtvInstance.customFind();
                multicastResults.errors.forEach((error) => {
                    if (error.exception !== undefined && typeof error.exception === 'string') {
                        this.log.error(`multicast discovery - ${error.exception}`);
                        this.log.debug(JSON.stringify(error, undefined, 2));
                    } else {
                        this.log.error(JSON.stringify(error, undefined, 2));
                    }
                });
                scanResults = multicastResults.devices;
                this.log.debug('finished multicast device discovery');
            } catch (e: unknown) {
                if (typeof e === 'object' && e instanceof Error) {
                    this.log.error(`${e.name}: ${e.message}`);
                    if (e.stack !== undefined && e.stack !== null) {
                        this.log.debug(e.stack);
                    }
                } else {
                    throw e;
                }
            }
        }

        // unicast discovery
        if (
            this.config.discover?.unicast &&
            this.config.discover.unicast.length !== 0
        ) {
            try {
                const unicastResults: NodePyATVFindResponseObject =
                    await CustomPyAtvInstance.customFind({ hosts: this.config.discover?.unicast });
                unicastResults.errors.forEach((error) => {
                    if (error.exception !== undefined && typeof error.exception === 'string') {
                        this.log.error(`unicast discovery - ${error.exception}`);
                        this.log.debug(JSON.stringify(error, undefined, 2));
                    } else {
                        this.log.error(JSON.stringify(error, undefined, 2));
                    }
                });
                scanResults = [...scanResults, ...unicastResults.devices];
                this.log.debug('finished unicast device discovery');
            } catch (e: unknown) {
                if (typeof e === 'object' && e instanceof Error) {
                    this.log.error(`${e.name}: ${e.message}`);
                    if (e.stack !== undefined && e.stack !== null) {
                        this.log.debug(e.stack);
                    }
                } else {
                    throw e;
                }
            }
        }

        const appleTVs: NodePyATVDevice[] = scanResults.filter((d) => ALLOWED_MODELS.includes(d.model ?? '') && d.os === 'TvOS');

        // loop over the discovered devices and register each one if it has not already been registered
        for (const appleTV of appleTVs) {
            this.log.debug(`Found ${appleTV.name} (${appleTV.mac}).`);

            if (appleTV.mac === undefined || appleTV.mac === null) {
                this.log.debug(`${appleTV.name} is skipped since the MAC address could not be determined.`);
                continue;
            }
            const mac: string = appleTV.mac.toUpperCase();

            if (this.config.discover?.blacklist) {
                if (this.config.discover.blacklist.map((e) => e.toUpperCase()).includes(mac)) {
                    this.log.debug(`${appleTV.name} (${appleTV.mac}) is on the blacklist. Skipping.`);
                    continue;
                }
                if (this.config.discover.blacklist.includes(appleTV.host ?? '')) {
                    this.log.debug(`${appleTV.name} (${appleTV.host}) is on the blacklist. Skipping.`);
                    continue;
                }
            }

            // generate a unique id for the accessory this should be generated from
            // something globally unique, but constant, for example, the device serial
            // number or MAC address
            let uuid: string = this.api.hap.uuid.generate(mac);
            if (DEV_MODE === true) {
                const localHostname: string = hostname();
                uuid = this.api.hap.uuid.generate(`${localHostname}${mac}`);
                this.log.debug(`Generated UUID ${uuid} for ${appleTV.name} from local hostname ${localHostname} and MAC address ${mac} \
since development mode is enabled.`);
            }
            if (this.publishedUUIDs.includes(uuid)) {
                this.log.debug(`${appleTV.name} (${appleTV.mac}) with UUID ${uuid} already exists. Skipping.`);
                continue;
            }
            this.publishedUUIDs.push(uuid);

            // the accessory does not yet exist, so we need to create it
            this.log.info(`Adding ${appleTV.name} (${appleTV.mac})`);

            // create a new accessory
            const newAccessory: PlatformAccessory = new this.api.platformAccessory(appleTV.name, uuid);

            // store a copy of the device object in the `accessory.context`
            // the `context` property can be used to store any data about the accessory you may need
            newAccessory.context.mac = mac;

            // create the accessory handler for the newly create accessory
            // this is imported from `platformAccessory.ts`
            void (async (): Promise<void> => {
                this.log.debug(`Waiting for ${appleTV.name} (${appleTV.mac}) to boot ...`);

                const newAtvAccessory: AppleTVEnhancedAccessory = new AppleTVEnhancedAccessory(this, newAccessory);
                await newAtvAccessory.untilBooted();
                this.atvAccessories.push(newAtvAccessory);

                // link the accessory to your platform
                this.log.debug(`${appleTV.name} (${appleTV.mac}) finished booting. Publishing the accessory now.`);
                this.api.publishExternalAccessories(PLUGIN_NAME, [newAccessory]);
            })();
        }

        this.log.debug('Finished device discovery.');
    }

    private warnNoDevices(): void {
        if (this.publishedUUIDs.length === 0) {
            this.log.warn('The device discovery could not find any Apple TV devices until now. Are you sure that you have a compatible \
Apple TV and the Apple TV is in the same subnet? (see \
https://github.com/maxileith/homebridge-appletv-enhanced/tree/main?tab=readme-ov-file#requirements)');
        }
    }
}
