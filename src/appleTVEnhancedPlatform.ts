import type { API, DynamicPlatformPlugin, Logger, PlatformAccessory, Service, Characteristic } from 'homebridge';
import { PLUGIN_NAME } from './settings';
import { AppleTVEnhancedAccessory } from './appleTVEnhancedAccessory';
import CustomPyAtvInstance from './CustomPyAtvInstance';
import type { AppleTVEnhancedPlatformConfig } from './interfaces';
import type { NodePyATVDevice } from '@sebbo2002/node-pyatv';
import PythonChecker from './PythonChecker';
import PrefixLogger from './PrefixLogger';
import LogLevelLogger from './LogLevelLogger';
import UpdateChecker from './UpdateChecker';

// compatible model identifiers according to https://pyatv.dev/api/const/#pyatv.const.DeviceModel
const ALLOWED_MODELS: string[] = [
    'Gen4',
    'Gen4K',
    'AppleTVGen4', // future proof since they will be renamed in pyatv
    'AppleTVGen4K',  // future proof since they will be renamed in pyatv
    'AppleTV4KGen2',
    'AppleTV4KGen3',
];

export class AppleTVEnhancedPlatform implements DynamicPlatformPlugin {
    public readonly Service: typeof Service;
    public readonly Characteristic: typeof Characteristic;

    public readonly logLevelLogger: LogLevelLogger;
    private readonly log: PrefixLogger;

    private readonly publishedUUIDs: string[] = [];

    public constructor(
        ogLog: Logger,
        public readonly config: AppleTVEnhancedPlatformConfig,
        public readonly api: API,
    ) {
        this.logLevelLogger = new LogLevelLogger(ogLog, this.config.logLevel);
        this.log = new PrefixLogger(this.logLevelLogger, 'Platform');

        this.Service = this.api.hap.Service;
        this.Characteristic = this.api.hap.Characteristic;

        this.log.info('Finished initializing platform:', this.config.name);

        // When this event is fired it means Homebridge has restored all cached accessories from disk.
        // Dynamic Platform plugins should only register new accessories after this event was fired,
        // in order to ensure they weren't added to homebridge already. This event can also be used
        // to start discovery of new accessories.
        this.api.on('didFinishLaunching', async () => {
            this.log.debug('Executed didFinishLaunching callback');

            // enable update check
            const updateChecker: UpdateChecker =
                new UpdateChecker(this.logLevelLogger, this.config.autoUpdate === true, this.config.updateCheckLevel === 'beta', 60);
            await updateChecker.check('info');
            updateChecker.startInterval(true);

            // make sure the Python environment is ready
            await new PythonChecker(this.logLevelLogger, this.api.user.storagePath()).allInOne(this.config.forceVenvRecreate);

            // run the method to discover / register your devices as accessories
            this.log.debug(`Setting the storage path of the PyATV instance to ${this.api.user.storagePath()}`);
            CustomPyAtvInstance.setLogger(this.logLevelLogger);
            CustomPyAtvInstance.setStoragePath(this.api.user.storagePath());

            if (
                this.config.discover !== undefined &&
                this.config.discover.multicast === false &&
                (this.config.discover.unicast === undefined || this.config.discover.unicast.length === 0)
            ) {
                this.log.error('Neither multicast nor unicast discovery is enabled.');
                return;
            }

            this.log.info('Starting device discovery ...');
            this.discoverDevices();
            setInterval(() => this.discoverDevices(), 60000);
            setTimeout(() => this.warnNoDevices(), 150000);
        });
    }

    // eslint-disable-next-line @typescript-eslint/no-unused-vars, @typescript-eslint/no-empty-function
    public configureAccessory(accessory: PlatformAccessory): void {}

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
            this.config.discover === undefined ||
            this.config.discover.multicast === undefined ||
            this.config.discover.multicast === true
        ) {
            try {
                scanResults = [ ...scanResults, ...await CustomPyAtvInstance.find()];
                this.log.debug('finished multicast device discovery');
            } catch (err: unknown) {
                this.log.error(err as string);
            }
        }

        // unicast discovery
        if (
            this.config.discover &&
            this.config.discover.unicast &&
            this.config.discover.unicast.length !== 0
        ) {
            try {
                scanResults = [ ...scanResults, ...await CustomPyAtvInstance.find({hosts: this.config.discover?.unicast})];
                this.log.debug('finished unicast device discovery');
            } catch (err: unknown) {
                this.log.error(err as string);
            }
        }

        const appleTVs: NodePyATVDevice[] = scanResults.filter((d) => ALLOWED_MODELS.includes(d.model || ''));

        // loop over the discovered devices and register each one if it has not already been registered
        for (const appleTV of appleTVs) {
            this.log.debug(`Found Apple TV ${appleTV.name} (${appleTV.mac} / ${appleTV.host}).`);

            if (appleTV.mac === undefined || appleTV.mac === null) {
                this.log.debug(`${appleTV.name} (${appleTV.host}) is skipped since the MAC address could not be determined.`);
                continue;
            }
            const mac: string = appleTV.mac.toUpperCase();

            if (
                this.config.discover &&
                this.config.discover.blacklist &&
                (
                    this.config.discover.blacklist.map((e) => e.toUpperCase()).includes(mac) ||
                    this.config.discover.blacklist.includes(appleTV.host)
                )
            ) {
                this.log.debug(`Apple TV ${appleTV.name} (${appleTV.mac} / ${appleTV.host}) is on the blacklist. Skipping.`);
                continue;
            }

            // generate a unique id for the accessory this should be generated from
            // something globally unique, but constant, for example, the device serial
            // number or MAC address
            const uuid: string = this.api.hap.uuid.generate(mac);
            if (this.publishedUUIDs.includes(uuid)) {
                this.log.debug(`Apple TV ${appleTV.name} (${appleTV.mac}) with UUID ${uuid} already exists. Skipping.`);
                continue;
            }
            this.publishedUUIDs.push(uuid);

            // the accessory does not yet exist, so we need to create it
            this.log.info(`Adding Apple TV ${appleTV.name} (${appleTV.mac})`);

            // create a new accessory
            const accessory: PlatformAccessory = new this.api.platformAccessory(`Apple TV ${appleTV.name}`, uuid);

            // store a copy of the device object in the `accessory.context`
            // the `context` property can be used to store any data about the accessory you may need
            accessory.context.mac = mac;

            // create the accessory handler for the newly create accessory
            // this is imported from `platformAccessory.ts`
            (async (): Promise<void> => {
                this.log.debug(`Waiting for Apple TV ${appleTV.name} (${appleTV.mac}) to boot ...`);
                await (new AppleTVEnhancedAccessory(this, accessory)).untilBooted();

                // link the accessory to your platform
                this.log.debug(`Apple TV ${appleTV.name} (${appleTV.mac}) finished booting. Publishing the accessory now.`);
                this.api.publishExternalAccessories(PLUGIN_NAME, [accessory]);
            })();
        }

        this.log.debug('Finished device discovery.');
    }

    private warnNoDevices(): void {
        if (this.publishedUUIDs.length === 0) {
            this.log.warn('The device discovery could not find any Apple TV devices until now. Are you sure that you have a compatible \
Apple TV and the Apple TV is in the same subnet? (see https://github.com/maxileith/homebridge-appletv-enhanced#requirements)');
        }
    }
}