import { Service, PlatformAccessory, CharacteristicValue, Nullable } from 'homebridge';

import { AppleTVEnhancedPlatform } from './appleTVEnhancedPlatform';
import pyatvInstance from './pyatvInstance';

/**
 * Platform Accessory
 * An instance of this class is created for each accessory your platform registers
 * Each accessory may expose multiple services of different service types.
 */
export class AppleTVEnhancedAccessory {
    private service: Service;

    constructor(
        private readonly platform: AppleTVEnhancedPlatform,
        private readonly accessory: PlatformAccessory,
    ) {
        const device = pyatvInstance.deviceById(this.accessory.context.id as string);
        device?.getApp().then((e) => this.platform.log.error(e as unknown as string));

        // set accessory information
        this.accessory.getService(this.platform.Service.AccessoryInformation)!
            .setCharacteristic(this.platform.Characteristic.Manufacturer, 'Apple')
            .setCharacteristic(this.platform.Characteristic.Model, device!.modelName!)
            .setCharacteristic(this.platform.Characteristic.SerialNumber, device!.id!)
            .setCharacteristic(this.platform.Characteristic.Name, device!.name)
            .setCharacteristic(this.platform.Characteristic.Active, this.platform.Characteristic.Active.INACTIVE)
            .setCharacteristic(this.platform.Characteristic.ActiveIdentifier, 0)
            .setCharacteristic(this.platform.Characteristic.ConfiguredName, device!.name)
            .setCharacteristic(this.platform.Characteristic.SleepDiscoveryMode, this.platform.Characteristic.SleepDiscoveryMode.NOT_DISCOVERABLE);

        // get the LightBulb service if it exists, otherwise create a new LightBulb service
        // you can create multiple services for each accessory
        this.service = this.accessory.getService(
            this.platform.Service.Television) || this.accessory.addService(this.platform.Service.Television);

        // create handlers for required characteristics
        this.service.getCharacteristic(this.platform.Characteristic.Manufacturer)
            .onGet(this.handleManufacturerGet.bind(this));
        this.service.getCharacteristic(this.platform.Characteristic.Model)
            .onGet(this.handleModelGet.bind(this));
        this.service.getCharacteristic(this.platform.Characteristic.SerialNumber)
            .onGet(this.handleSerialNumberGet.bind(this));
        this.service.getCharacteristic(this.platform.Characteristic.Name)
            .onGet(this.handleNameGet.bind(this));
    }

    private handleManufacturerGet(): Nullable<CharacteristicValue> {
        return this.service.getCharacteristic(this.platform.Characteristic.Manufacturer).value;
    }

    private handleModelGet(): Nullable<CharacteristicValue> {
        return this.service.getCharacteristic(this.platform.Characteristic.Model).value;
    }

    private handleSerialNumberGet(): Nullable<CharacteristicValue> {
        return this.service.getCharacteristic(this.platform.Characteristic.SerialNumber).value;
    }

    private handleNameGet(): Nullable<CharacteristicValue> {
        return this.service.getCharacteristic(this.platform.Characteristic.Name).value;
    }
}