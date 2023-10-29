import { API, DynamicPlatformPlugin, Logger, PlatformAccessory, Service, Characteristic } from 'homebridge';

import { PLUGIN_NAME } from './settings';
import { AppleTVEnhancedAccessory } from './appleTVEnhancedAccessory';
import CustomPyAtvInstance from './CustomPyAtvInstance';
import { AppleTVEnhancedPlatformConfig } from './interfaces';
import { NodePyATVDevice } from '@sebbo2002/node-pyatv';
import PythonChecker from './PythonChecker';


export class AppleTVEnhancedPlatform implements DynamicPlatformPlugin {
    public readonly Service: typeof Service;
    public readonly Characteristic: typeof Characteristic;

    // this is used to track restored cached accessories
    public readonly accessories: PlatformAccessory[] = [];
    private publishedUUIDs: string[] = [];

    constructor(
        public readonly log: Logger,
        public readonly config: AppleTVEnhancedPlatformConfig,
        public readonly api: API,
    ) {
        this.Service = this.api.hap.Service;
        this.Characteristic = this.api.hap.Characteristic;

        this.log.info('Finished initializing platform:', this.config.name);

        // When this event is fired it means Homebridge has restored all cached accessories from disk.
        // Dynamic Platform plugins should only register new accessories after this event was fired,
        // in order to ensure they weren't added to homebridge already. This event can also be used
        // to start discovery of new accessories.
        this.api.on('didFinishLaunching', async () => {
            this.log.debug('Platform: Executed didFinishLaunching callback');

            // make sure the Python environment is ready
            await new PythonChecker(log, this.api.user.storagePath()).allInOne();

            // run the method to discover / register your devices as accessories
            this.log.debug(`Platform: Setting the storage path to ${this.api.user.storagePath()}`);
            CustomPyAtvInstance.setStoragePath(this.api.user.storagePath(), this.log);

            this.log.info('Platform: Starting device discovery ...');
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
        this.log.info(`Platform: Loading accessory from cache: ${accessory.displayName}`);

        // // add the restored accessory to the accessories cache so we can track if it has already been registered
        this.accessories.push(accessory);
    }

    /**
   * This is an example method showing how to register discovered accessories.
   * Accessories must only be registered once, previously created accessories
   * must not be registered again to prevent "duplicate UUID" errors.
   */
    async discoverDevices() {
        this.log.debug('Platform: Starting device discovery ...');
        const scanResults = await CustomPyAtvInstance.find().catch((err) => {
            this.log.error(err);
            return [] as NodePyATVDevice[];
        });
        this.log.debug('Platform: Finished device discovery.');

        const appleTVs = scanResults.filter((d) => d.modelName?.includes('Apple TV') && d.os === 'TvOS');

        // loop over the discovered devices and register each one if it has not already been registered
        for (const appleTV of appleTVs) {
            this.log.debug(`Platform: Found Apple TV ${appleTV.name} (${appleTV.id}).`);

            if (this.config.blacklist && this.config.blacklist.includes(appleTV.id as string)) {
                this.log.debug(`Platform: Apple TV ${appleTV.name} (${appleTV.id}) is on the blacklist. Skipping.`);
                continue;
            }

            // generate a unique id for the accessory this should be generated from
            // something globally unique, but constant, for example, the device serial
            // number or MAC address
            const uuid = this.api.hap.uuid.generate(appleTV.id as string);
            if (this.publishedUUIDs.includes(uuid)) {
                this.log.debug(`Platform: Apple TV ${appleTV.name} (${appleTV.id}) with UUID ${uuid} already exists. Skipping.`);
                continue;
            }
            this.publishedUUIDs.push(uuid);

            // the accessory does not yet exist, so we need to create it
            this.log.info(`Platform: Adding Apple TV ${appleTV.name} (${appleTV.id})`);

            // create a new accessory
            const accessory = new this.api.platformAccessory(`Apple TV ${appleTV.name}`, uuid);

            // store a copy of the device object in the `accessory.context`
            // the `context` property can be used to store any data about the accessory you may need
            accessory.context.id = appleTV.id;

            // create the accessory handler for the newly create accessory
            // this is imported from `platformAccessory.ts`
            (async () => {
                this.log.debug(`Platform: Waiting for Apple TV ${appleTV.name} (${appleTV.id}) to boot ...`);
                await (new AppleTVEnhancedAccessory(this, accessory)).untilBooted();

                // link the accessory to your platform
                this.log.debug(`Platform: Apple TV ${appleTV.name} (${appleTV.id}) finished booting. Publishing the accessory now.`);
                this.api.publishExternalAccessories(PLUGIN_NAME, [accessory]);
            })();
        }
    }


}