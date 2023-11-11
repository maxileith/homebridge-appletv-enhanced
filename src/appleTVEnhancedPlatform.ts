import { API, DynamicPlatformPlugin, Logger, PlatformAccessory, Service, Characteristic } from 'homebridge';

import { PLUGIN_NAME } from './settings';
import { AppleTVEnhancedAccessory } from './appleTVEnhancedAccessory';
import CustomPyAtvInstance from './CustomPyAtvInstance';
import { AppleTVEnhancedPlatformConfig } from './interfaces';
import { NodePyATVDevice } from '@sebbo2002/node-pyatv';
import PythonChecker from './PythonChecker';
import PrefixLogger from './PrefixLogger';
import checkOs from './checkOS';


export class AppleTVEnhancedPlatform implements DynamicPlatformPlugin {
    private readonly log: PrefixLogger;

    public readonly Service: typeof Service;
    public readonly Characteristic: typeof Characteristic;

    // this is used to track restored cached accessories
    public readonly accessories: PlatformAccessory[] = [];
    private publishedUUIDs: string[] = [];

    constructor(
        public readonly ogLog: Logger,
        public readonly config: AppleTVEnhancedPlatformConfig,
        public readonly api: API,
    ) {
        this.log = new PrefixLogger(this.ogLog, 'Platform');

        this.Service = this.api.hap.Service;
        this.Characteristic = this.api.hap.Characteristic;

        this.log.info('Finished initializing platform:', this.config.name);

        // When this event is fired it means Homebridge has restored all cached accessories from disk.
        // Dynamic Platform plugins should only register new accessories after this event was fired,
        // in order to ensure they weren't added to homebridge already. This event can also be used
        // to start discovery of new accessories.
        this.api.on('didFinishLaunching', async () => {
            this.log.debug('Executed didFinishLaunching callback');

            // make sure the Python environment is ready
            checkOs((m) => this.ogLog.info(m), (m) => this.ogLog.warn(m));
            await new PythonChecker(this.ogLog, this.api.user.storagePath()).allInOne(this.config.forceVenvRecreate);

            // run the method to discover / register your devices as accessories
            this.log.debug(`Setting the storage path of the PyATV instance to ${this.api.user.storagePath()}`);
            CustomPyAtvInstance.setStoragePath(this.api.user.storagePath(), this.ogLog);

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
        });
    }

    /**
   * This function is invoked when homebridge restores cached accessories from disk at startup.
   * It should be used to setup event handlers for characteristics and update respective values.
   */
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    configureAccessory(accessory: PlatformAccessory) {
        this.log.info(`Loading accessory from cache: ${accessory.displayName}`);

        // // add the restored accessory to the accessories cache so we can track if it has already been registered
        this.accessories.push(accessory);
    }

    /**
   * This is an example method showing how to register discovered accessories.
   * Accessories must only be registered once, previously created accessories
   * must not be registered again to prevent "duplicate UUID" errors.
   */
    async discoverDevices() {
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

        const appleTVs = scanResults.filter((d) =>
            // compatible model identifiers according to https://pyatv.dev/api/const/#pyatv.const.DeviceModel
            d.model === 'Gen4' ||
            d.model === 'Gen4K' ||
            d.model === 'AppleTVGen4' || // future proof since they will be renamed in pyatv
            d.model === 'AppleTVGen4K' ||  // future proof since they will be renamed in pyatv
            d.model === 'AppleTV4KGen2' ||
            d.model === 'AppleTV4KGen3',
        );

        // loop over the discovered devices and register each one if it has not already been registered
        for (const appleTV of appleTVs) {
            this.log.debug(`Found Apple TV ${appleTV.name} (${appleTV.id} / ${appleTV.host}).`);

            if (/^([0-9A-Fa-f]{2}[:]){5}([0-9A-Fa-f]{2})$/.test(appleTV.id!) === false) {
                this.log.debug(`Identifier ${appleTV.id} is not a MAC-Address. ${appleTV.name} (${appleTV.host}) is therefore skipped.`);
                continue;
            }

            if (
                this.config.discover &&
                this.config.discover.blacklist &&
                (this.config.discover.blacklist.includes(appleTV.id!) || this.config.discover.blacklist.includes(appleTV.host))
            ) {
                this.log.debug(`Apple TV ${appleTV.name} (${appleTV.id} / ${appleTV.host}) is on the blacklist. Skipping.`);
                continue;
            }

            // generate a unique id for the accessory this should be generated from
            // something globally unique, but constant, for example, the device serial
            // number or MAC address
            const uuid = this.api.hap.uuid.generate(appleTV.id!);
            if (this.publishedUUIDs.includes(uuid)) {
                this.log.debug(`Apple TV ${appleTV.name} (${appleTV.id}) with UUID ${uuid} already exists. Skipping.`);
                continue;
            }
            this.publishedUUIDs.push(uuid);

            // the accessory does not yet exist, so we need to create it
            this.log.info(`Adding Apple TV ${appleTV.name} (${appleTV.id})`);

            // create a new accessory
            const accessory = new this.api.platformAccessory(`Apple TV ${appleTV.name}`, uuid);

            // store a copy of the device object in the `accessory.context`
            // the `context` property can be used to store any data about the accessory you may need
            accessory.context.id = appleTV.id;

            // create the accessory handler for the newly create accessory
            // this is imported from `platformAccessory.ts`
            (async () => {
                this.log.debug(`Waiting for Apple TV ${appleTV.name} (${appleTV.id}) to boot ...`);
                await (new AppleTVEnhancedAccessory(this, accessory)).untilBooted();

                // link the accessory to your platform
                this.log.debug(`Apple TV ${appleTV.name} (${appleTV.id}) finished booting. Publishing the accessory now.`);
                this.api.publishExternalAccessories(PLUGIN_NAME, [accessory]);
            })();
        }

        this.log.debug('Finished device discovery.');
    }
}