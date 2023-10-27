import { API, DynamicPlatformPlugin, Logger, PlatformAccessory, Service, Characteristic } from 'homebridge';

import { PLUGIN_NAME } from './settings';
import { AppleTVEnhancedAccessory } from './appleTVEnhancedAccessory';
import CustomPyAtvInstance from './CustomPyAtvInstance';
import { AppleTVEnhancedPlatformConfig } from './interfaces';

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
        this.api.on('didFinishLaunching', () => {
            this.log.debug('Executed didFinishLaunching callback');
            this.log.info('Starting device discovery');

            // run the method to discover / register your devices as accessories
            CustomPyAtvInstance.createInstance(this.api.user.storagePath());
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
        this.log.info('Loading accessory from cache:', accessory.displayName);

        // // add the restored accessory to the accessories cache so we can track if it has already been registered
        this.accessories.push(accessory);
    }

    /**
   * This is an example method showing how to register discovered accessories.
   * Accessories must only be registered once, previously created accessories
   * must not be registered again to prevent "duplicate UUID" errors.
   */
    async discoverDevices() {
        const scanResults = await CustomPyAtvInstance.getInstance()!.find();
        const appleTVs = scanResults.filter((d) => d.modelName?.includes('Apple TV') && d.os === 'TvOS');

        // loop over the discovered devices and register each one if it has not already been registered
        for (const appleTV of appleTVs) {
            if (this.config.blacklist && this.config.blacklist.includes(appleTV.id as string)) {
                continue;
            }

            // generate a unique id for the accessory this should be generated from
            // something globally unique, but constant, for example, the device serial
            // number or MAC address
            const uuid = this.api.hap.uuid.generate(appleTV.id as string);
            if (this.publishedUUIDs.includes(uuid)) {
                continue;
            }
            this.publishedUUIDs.push(uuid);

            // the accessory does not yet exist, so we need to create it
            this.log.info('Adding Apple TV:', appleTV.name);

            // create a new accessory
            const accessory = new this.api.platformAccessory(`Apple TV ${appleTV.name}`, uuid);

            // store a copy of the device object in the `accessory.context`
            // the `context` property can be used to store any data about the accessory you may need
            accessory.context.id = appleTV.id;

            // create the accessory handler for the newly create accessory
            // this is imported from `platformAccessory.ts`
            (async () => {
                await (new AppleTVEnhancedAccessory(this, accessory)).untilBooted();

                // link the accessory to your platform
                this.api.publishExternalAccessories(PLUGIN_NAME, [accessory]);
            })();
        }
    }


}