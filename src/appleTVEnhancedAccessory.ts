import fs from 'fs';
import { Service, PlatformAccessory, CharacteristicValue, Nullable } from 'homebridge';

import { AppleTVEnhancedPlatform } from './appleTVEnhancedPlatform';
import pyatvInstance from './pyatvInstance';
import { NodePyATVDevice, NodePyATVDeviceEvent, NodePyATVDeviceState, NodePyATVMediaType } from '@sebbo2002/node-pyatv';

interface NodePyATVApp {
    id: string;
    name: string;
    launch: () => Promise<void>;
}

interface Inputs {
    pyatvApp: NodePyATVApp;
    service: Service;
}

interface IAppConfig {
    configuredName: string;
    isConfigured: 0 | 1;
    visibilityState: 0 | 1;
}

interface IAppConfigs {
    [k: string]: IAppConfig;
}

/**
 * Platform Accessory
 * An instance of this class is created for each accessory your platform registers
 * Each accessory may expose multiple services of different service types.
 */
export class AppleTVEnhancedAccessory {
    private service: Service;
    private device: NodePyATVDevice;
    private inputs: Inputs[] = [];
    private stateServices: { [k: string]: Service } = {};
    private mediaServices: { [k: string]: Service } = {};

    private appConfigs: IAppConfigs | undefined = undefined;

    constructor(
        private readonly platform: AppleTVEnhancedPlatform,
        private readonly accessory: PlatformAccessory,
    ) {
        const discoveredDevice = pyatvInstance.deviceById(this.accessory.context.id as string);
        this.device = pyatvInstance.device({
            host: discoveredDevice!.host!,
            name: discoveredDevice!.name!,
            // eslint-disable-next-line max-len
            airplayCredentials: 'xxx',
            // eslint-disable-next-line max-len
            companionCredentials: 'xxx',
        });

        this.accessory.category = this.platform.api.hap.Categories.TV_SET_TOP_BOX;

        // set accessory information
        this.accessory.getService(this.platform.Service.AccessoryInformation)!
            .setCharacteristic(this.platform.Characteristic.Manufacturer, 'Apple Inc.')
            .setCharacteristic(this.platform.Characteristic.Model, discoveredDevice!.modelName!)
            .setCharacteristic(this.platform.Characteristic.SerialNumber, discoveredDevice!.id!)
            .setCharacteristic(this.platform.Characteristic.Name, discoveredDevice!.name)
            .setCharacteristic(this.platform.Characteristic.FirmwareRevision, discoveredDevice!.version!);

        // create the service
        this.service = this.accessory.getService(this.platform.Service.Television) || this.accessory.addService(this.platform.Service.Television);
        this.service
            .setCharacteristic(this.platform.Characteristic.Active, this.platform.Characteristic.Active.INACTIVE)
            .setCharacteristic(this.platform.Characteristic.ActiveIdentifier, 0)
            .setCharacteristic(this.platform.Characteristic.ConfiguredName, this.accessory.context.displayName)
            .setCharacteristic(this.platform.Characteristic.SleepDiscoveryMode, this.platform.Characteristic.SleepDiscoveryMode.ALWAYS_DISCOVERABLE);
        // create handlers for required characteristics of the service
        this.service.getCharacteristic(this.platform.Characteristic.Active)
            .onGet(this.handleActiveGet.bind(this))
            .onSet(this.handleActiveSet.bind(this));
        this.service.getCharacteristic(this.platform.Characteristic.ActiveIdentifier)
            .onGet(this.handleActiveIdentifierGet.bind(this))
            .onSet(this.handleActiveIdentifierSet.bind(this));
        this.service.getCharacteristic(this.platform.Characteristic.ConfiguredName)
            .onGet(this.handleConfiguredNameGet.bind(this))
            .onSet(this.handleConfiguredNameSet.bind(this));
        this.service.getCharacteristic(this.platform.Characteristic.SleepDiscoveryMode)
            .onGet(this.handleSleepDiscoveryModeGet.bind(this));
        this.service.getCharacteristic(this.platform.Characteristic.RemoteKey)
            .onSet(this.handleRemoteKeySet.bind(this));
        // create listeners for updating the service
        this.device.on('update:powerState', this.handleActiveUpdate.bind(this));

        // create input services
        this.device.listApps().then(this.createInputs.bind(this));
        // create listener to keep the current app up to date
        this.device.on('update:appId', this.handleInputUpdate.bind(this));

        // create device state motion sensors
        this.createDeviceStateSensors();
        // create listener to keep the current device state up to date
        this.device.on('update:deviceState', this.handleDeviceStateUpdate.bind(this));

        // create media type motion sensors
        this.createMediaTypeSensors();
        // create listener to keep the current media type up to date
        this.device.on('update:mediaType', this.handleMediaTypeUpdate.bind(this));

        const updateListener = (event: NodePyATVDeviceEvent | Error) => {
            if (event instanceof Error || event.key === 'dateTime') {
                return;
            }
            this.platform.log.error(`   ${event.key}: ${event?.value} (was ${event?.oldValue})`);
        };

        this.device.on('update', updateListener);
    }

    private createMediaTypeSensors(): void {
        let state: keyof typeof NodePyATVMediaType;
        for (state in NodePyATVMediaType) {
            const s = this.accessory.getService(state) || this.accessory.addService(this.platform.Service.MotionSensor, state, state)
                .setCharacteristic(this.platform.Characteristic.MotionDetected, false)
                .setCharacteristic(this.platform.Characteristic.Name, state);
            this.service.addLinkedService(s);
            this.mediaServices[state] = s;
        }
    }

    private async handleMediaTypeUpdate(event: NodePyATVDeviceEvent | Error): Promise<void> {
        if (event instanceof Error) {
            return;
        }
        this.platform.log.info(`New Media Type State: ${event.value}`);
        if (event.oldValue !== null) {
            const s = this.mediaServices[event.oldValue];
            s.setCharacteristic(this.platform.Characteristic.MotionDetected, false);
        }
        if (event.value !== null) {
            const s = this.mediaServices[event.value];
            s.setCharacteristic(this.platform.Characteristic.MotionDetected, true);
        }
    }

    private createDeviceStateSensors(): void {
        let state: keyof typeof NodePyATVDeviceState;
        for (state in NodePyATVDeviceState) {
            const s = this.accessory.getService(state) || this.accessory.addService(this.platform.Service.MotionSensor, state, state)
                .setCharacteristic(this.platform.Characteristic.MotionDetected, false)
                .setCharacteristic(this.platform.Characteristic.Name, state);
            this.service.addLinkedService(s);
            this.stateServices[state] = s;
        }
    }

    private async handleDeviceStateUpdate(event: NodePyATVDeviceEvent | Error): Promise<void> {
        if (event instanceof Error) {
            return;
        }
        this.platform.log.info(`New Device State: ${event.value}`);
        if (event.oldValue !== null) {
            const s = this.stateServices[event.oldValue];
            s.setCharacteristic(this.platform.Characteristic.MotionDetected, false);
        }
        if (event.value !== null) {
            const s = this.stateServices[event.value];
            s.setCharacteristic(this.platform.Characteristic.MotionDetected, true);
        }
    }

    private createInputs(apps: NodePyATVApp[]): void {
        const appConfigs = this.getAppConfigs();

        apps.forEach((app, k) => {
            if (!Object.keys(appConfigs).includes(app.id)) {
                appConfigs[app.id] = {
                    configuredName: app.name,
                    isConfigured: this.platform.Characteristic.IsConfigured.CONFIGURED,
                    visibilityState: this.platform.Characteristic.CurrentVisibilityState.SHOWN,
                };
            }
            this.platform.log.info(`Adding ${appConfigs[app.id].configuredName} (${app.id}) as an input.`);
            const s = this.accessory.getService(app.name) || this.accessory.addService(this.platform.Service.InputSource, app.name, app.id)
                .setCharacteristic(this.platform.Characteristic.ConfiguredName, appConfigs[app.id].configuredName)
                .setCharacteristic(this.platform.Characteristic.InputSourceType, this.platform.Characteristic.InputSourceType.APPLICATION)
                .setCharacteristic(this.platform.Characteristic.IsConfigured, appConfigs[app.id].isConfigured)
                .setCharacteristic(this.platform.Characteristic.Name, app.name)
                .setCharacteristic(this.platform.Characteristic.CurrentVisibilityState, appConfigs[app.id].visibilityState)
                .setCharacteristic(this.platform.Characteristic.InputDeviceType, this.platform.Characteristic.InputDeviceType.OTHER)
                .setCharacteristic(this.platform.Characteristic.TargetVisibilityState, appConfigs[app.id].visibilityState)
                .setCharacteristic(this.platform.Characteristic.Identifier, k);
            s.getCharacteristic(this.platform.Characteristic.ConfiguredName)
                .onSet(async (value) => {
                    this.platform.log.info(`Changing configured name of ${app.id} from ${appConfigs[app.id].configuredName} to ${value}.`);
                    appConfigs[app.id].configuredName = value as string;
                    this.setAppConfigs(appConfigs);
                });
            s.getCharacteristic(this.platform.Characteristic.IsConfigured)
                .onSet(async (value) => {
                    this.platform.log.info(`Changing is configured of ${appConfigs[app.id].configuredName} (${app.id}) from ${appConfigs[app.id].isConfigured} to ${value}.`);
                    appConfigs[app.id].isConfigured = value as 0 | 1;
                    this.setAppConfigs(appConfigs);
                });
            s.getCharacteristic(this.platform.Characteristic.TargetVisibilityState)
                .onSet(async (value) => {
                    this.platform.log.info(`Changing visibility state of ${appConfigs[app.id].configuredName} (${app.id}) from ${appConfigs[app.id].visibilityState} to ${value}.`);
                    appConfigs[app.id].visibilityState = value as 0 | 1;
                    s.setCharacteristic(this.platform.Characteristic.CurrentVisibilityState, value);
                    this.setAppConfigs(appConfigs);
                });
            this.service.addLinkedService(s);
            this.inputs.push({
                pyatvApp: app,
                service: s,
            });
        });
        this.setAppConfigs(appConfigs);
    }

    private async handleInputUpdate(event: NodePyATVDeviceEvent | Error): Promise<void> {
        if (event instanceof Error) {
            return;
        }
        if (event === null) {
            return;
        }
        if (event.value === event.oldValue) {
            return;
        }
        const appId = event.value;
        this.platform.log.warn(`Current App: ${appId}`);
        const index = this.inputs.findIndex((e) => e.pyatvApp.id === appId);
        if (index !== -1) {
            this.service.setCharacteristic(this.platform.Characteristic.ActiveIdentifier, index);
        }
    }

    private getAppConfigs(): IAppConfigs {
        if (this.appConfigs === undefined) {
            const dir = `${this.platform.api.user.storagePath()}/appletv-enhanced`;
            if (!fs.existsSync(dir)){
                fs.mkdirSync(dir);
            }
            const jsonPath = `${dir}/apps.json`;
            try {
                fs.writeFileSync(jsonPath, '{}', { encoding:'utf8', flag: 'wx' });
            } catch (err) { /* empty */ }
            this.appConfigs = JSON.parse(fs.readFileSync(jsonPath, 'utf8')) as IAppConfigs;
        }
        return this.appConfigs;
    }

    private setAppConfigs(value: IAppConfigs): void {
        this.appConfigs = value;
        const jsonPath = `${this.platform.api.user.storagePath()}/appletv-enhanced/apps.json`;
        fs.writeFileSync(jsonPath, JSON.stringify(value, null, 4), { encoding:'utf8', flag:'w' });
    }

    private async handleActiveGet(): Promise<Nullable<CharacteristicValue>> {
        return this.service.getCharacteristic(this.platform.Characteristic.Active).value;
    }

    private async handleActiveSet(state: CharacteristicValue): Promise<void> {
        if (state as boolean) {
            this.device?.turnOn();
        } else {
            this.device?.turnOff();
        }
    }

    private handleActiveUpdate(event: NodePyATVDeviceEvent | Error) {
        if (event instanceof Error) {
            return;
        }
        if (event.value === null) {
            return;
        }
        if (event.value === event.oldValue) {
            return;
        }
        this.platform.log.info(`New Active State: ${event.value}`);
        const value = event.value === 'on' ? this.platform.Characteristic.Active.ACTIVE : this.platform.Characteristic.Active.INACTIVE;
        this.service.setCharacteristic(this.platform.Characteristic.Active, value);
    }

    private async handleActiveIdentifierGet(): Promise<Nullable<CharacteristicValue>> {
        return this.service.getCharacteristic(this.platform.Characteristic.ActiveIdentifier).value;
    }

    private async handleActiveIdentifierSet(state: CharacteristicValue): Promise<void> {
        const app = this.inputs[state as number];
        this.platform.log.info(`Launching App: ${app.pyatvApp.name}`);
        app.pyatvApp.launch();
    }

    private async handleConfiguredNameGet(): Promise<Nullable<CharacteristicValue>> {
        return this.service.getCharacteristic(this.platform.Characteristic.ConfiguredName).value;
    }

    private async handleConfiguredNameSet(state: CharacteristicValue): Promise<void> {
        this.accessory.displayName = state as string;
    }

    private async handleSleepDiscoveryModeGet(): Promise<Nullable<CharacteristicValue>> {
        return this.service.getCharacteristic(this.platform.Characteristic.SleepDiscoveryMode).value;
    }

    private async handleRemoteKeySet(state: CharacteristicValue): Promise<void> {
        switch (state) {
        case this.platform.Characteristic.RemoteKey.REWIND:
            this.platform.log.info('rewind');
            break;
        case this.platform.Characteristic.RemoteKey.FAST_FORWARD:
            this.platform.log.info('fast forward');
            break;
        case this.platform.Characteristic.RemoteKey.NEXT_TRACK:
            this.platform.log.info('next rack');
            this.device?.skipForward();
            break;
        case this.platform.Characteristic.RemoteKey.PREVIOUS_TRACK:
            this.platform.log.info('previous track');
            this.device?.skipBackward();
            break;
        case this.platform.Characteristic.RemoteKey.ARROW_UP:
            this.platform.log.info('arrow up');
            this.device?.up();
            break;
        case this.platform.Characteristic.RemoteKey.ARROW_DOWN:
            this.platform.log.info('arrow down');
            this.device?.down();
            break;
        case this.platform.Characteristic.RemoteKey.ARROW_LEFT:
            this.platform.log.info('arrow left');
            this.device?.left();
            break;
        case this.platform.Characteristic.RemoteKey.ARROW_RIGHT:
            this.platform.log.info('arrow right');
            this.device?.right();
            break;
        case this.platform.Characteristic.RemoteKey.SELECT:
            this.platform.log.info('select');
            this.device?.select();
            break;
        case this.platform.Characteristic.RemoteKey.BACK:
            this.platform.log.info('back');
            break;
        case this.platform.Characteristic.RemoteKey.EXIT:
            this.platform.log.info('exit');
            this.device?.home();
            break;
        case this.platform.Characteristic.RemoteKey.PLAY_PAUSE:
            this.platform.log.info('play pause');
            this.device?.playPause();
            break;
        case this.platform.Characteristic.RemoteKey.INFORMATION:
            this.platform.log.info('information');
            this.device?.topMenu();
            break;
        }
    }
}