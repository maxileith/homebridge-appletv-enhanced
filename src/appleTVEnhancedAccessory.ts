import fs from 'fs';
import http, { IncomingMessage, ServerResponse } from 'http';
import { Service, PlatformAccessory, CharacteristicValue, Nullable, PrimitiveTypes, ConstructorArgs } from 'homebridge';

import { AppleTVEnhancedPlatform } from './appleTVEnhancedPlatform';
import { NodePyATVDevice, NodePyATVDeviceEvent, NodePyATVDeviceState, NodePyATVMediaType } from '@sebbo2002/node-pyatv';
import md5 from 'md5';
import { spawn } from 'child_process';
import path from 'path';
import CustomPyAtvInstance from './CustomPyAtvInstance';
import { capitalizeFirstLetter, delay, removeSpecialCharacters, getLocalIP, trimSpecialCharacters, camelCaseToTitleCase } from './utils';
import { IAppConfigs, ICommonConfig, IInputs, IMediaConfigs, IRemoteKeysAsSwitchConfigs, IStateConfigs, NodePyATVApp } from './interfaces';
import PrefixLogger from './PrefixLogger';
import { DisplayOrderTypes, RemoteControlCommands } from './enums';
import RocketRemote from './RocketRemote';


const HIDE_BY_DEFAULT_APPS = [
    'com.apple.podcasts',
    'com.apple.TVAppStore',
    'com.apple.TVSearch',
    'com.apple.Arcade',
    'com.apple.TVHomeSharing',
    'com.apple.TVSettings',
    'com.apple.Fitness',
    'com.apple.TVShows',
    'com.apple.TVMovies',
    'com.apple.facetime',
];

const DEFAULT_APP_RENAME = {
    'com.apple.TVWatchList': 'Apple TV',
    'com.apple.TVMusic': 'Apple Music',
};

const MAX_SERVICES = 100;

/**
 * Platform Accessory
 * An instance of this class is created for each accessory your platform registers
 * Each accessory may expose multiple services of different service types.
 */
export class AppleTVEnhancedAccessory {
    private service: Service | undefined = undefined;
    private device: NodePyATVDevice;
    private inputs: IInputs = {};
    private deviceStateServices: { [k: string]: Service } = {};
    private mediaTypeServices: { [k: string]: Service } = {};
    private remoteKeyServices: { [k: string]: Service } = {};
    private rocketRemote: RocketRemote | undefined = undefined;

    private appConfigs: IAppConfigs | undefined = undefined;
    private commonConfig: ICommonConfig | undefined = undefined;

    private stateConfigs: IStateConfigs | undefined = undefined;
    private mediaConfigs: IMediaConfigs | undefined = undefined;
    private remoteKeyAsSwitchConfigs: IRemoteKeysAsSwitchConfigs | undefined = undefined;

    private booted: boolean = false;
    private offline: boolean = false;
    private turningOn: boolean = false;
    private lastActiveSet: number = 0;
    private isFirstActiveSet: boolean = true;
    private totalServices: number = 0;

    private credentials: string | undefined = undefined;

    private readonly log: PrefixLogger;

    constructor(
        private readonly platform: AppleTVEnhancedPlatform,
        private readonly accessory: PlatformAccessory,
    ) {
        this.device = CustomPyAtvInstance.deviceAdvanced({ id: this.accessory.context.id as string })!;

        this.log = new PrefixLogger(this.platform.ogLog, `${this.device.name} (${this.device.id})`);

        const pairingRequired = () => {
            this.pair(this.device.host, this.accessory.context.id, this.device.name).then((c) => {
                this.setCredentials(c);
                this.device = CustomPyAtvInstance.deviceAdvanced({
                    id: this.device.id!,
                    airplayCredentials: c,
                    companionCredentials: c,
                })!;
                this.startUp();
                this.log.warn('Paring was successful. Add it to your home in the Home app: com.apple.home://launch');
            });
        };

        const credentials = this.getCredentials();
        if (!credentials) {
            pairingRequired();
        } else {
            this.device = CustomPyAtvInstance.deviceAdvanced({
                id: this.device.id!,
                airplayCredentials: credentials,
                companionCredentials: credentials,
            })!;
            this.credentialsValid().then((valid) => {
                if (valid) {
                    this.log.info('Credentials are still valid. Continuing ...');
                    this.startUp();
                } else {
                    this.log.warn('Credentials are no longer valid. Need to repair ...');
                    pairingRequired();
                }
            });
        }
    }

    private async startUp(): Promise<void> {
        this.accessory.category = this.platform.api.hap.Categories.TV_SET_TOP_BOX;

        // set accessory information
        this.accessory.getService(this.platform.Service.AccessoryInformation)!
            .setCharacteristic(this.platform.Characteristic.Manufacturer, 'Apple Inc.')
            .setCharacteristic(this.platform.Characteristic.Model, this.device.modelName!)
            .setCharacteristic(this.platform.Characteristic.SerialNumber, this.device.id!)
            .setCharacteristic(this.platform.Characteristic.Name, removeSpecialCharacters(this.device.name))
            .setCharacteristic(this.platform.Characteristic.FirmwareRevision, this.device.version!);

        const configuredName: string = this.getCommonConfig().configuredName || removeSpecialCharacters(this.accessory.displayName);

        // create the service
        this.service = this.accessory.getService(this.platform.Service.Television) || this.accessory.addService(this.platform.Service.Television);
        this.service
            .setCharacteristic(this.platform.Characteristic.Active, this.platform.Characteristic.Active.INACTIVE)
            .setCharacteristic(this.platform.Characteristic.ActiveIdentifier, this.getCommonConfig().activeIdentifier || this.appIdToNumber('com.apple.TVSettings'))
            .setCharacteristic(this.platform.Characteristic.ConfiguredName, configuredName)
            .setCharacteristic(this.platform.Characteristic.SleepDiscoveryMode, this.platform.Characteristic.SleepDiscoveryMode.ALWAYS_DISCOVERABLE)
            .setCharacteristic(this.platform.Characteristic.CurrentMediaState, this.platform.Characteristic.CurrentMediaState.INTERRUPTED)
            .setCharacteristic(this.platform.Characteristic.FirmwareRevision, this.device.version!);
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

        this.log.setPrefix(`${configuredName} (${this.device.id})`);

        // create input and sensor services
        this.createDeviceStateSensors();
        this.createMediaTypeSensors();
        this.createRemoteKeysAsSwitches();
        const apps = await this.device.listApps();
        this.createInputs(apps);

        // create event listeners to keep everything up-to-date
        this.createListeners();

        // create remote
        this.createRemote();

        this.log.info('Finished initializing');
        this.booted = true;
    }

    private createListeners(): void {
        this.log.debug('recreating listeners');

        const filterErrorHandler = (event: NodePyATVDeviceEvent | Error, listener: (event: NodePyATVDeviceEvent) => void): void => {
            if (!(event instanceof Error)) {
                if (this.offline && event.value !== null) {
                    this.log.info('Reestablished the connection');
                    this.offline = false;
                }
                this.log.debug(`event ${event.key}: ${event.value}`);
                listener(event);
            }
        };

        const powerStateListener = (e: Error | NodePyATVDeviceEvent) => filterErrorHandler(e, this.handleActiveUpdate.bind(this));
        // const appIdListener = (e: Error | NodePyATVDeviceEvent) => filterErrorHandler(e, this.handleInputUpdate.bind(this));
        const deviceStateListener = (e: Error | NodePyATVDeviceEvent) => filterErrorHandler(e, this.handleDeviceStateUpdate.bind(this));
        const mediaTypeListener = (e: Error | NodePyATVDeviceEvent) => filterErrorHandler(e, this.handleMediaTypeUpdate.bind(this));

        this.device.on('update:powerState', powerStateListener);
        // this.device.on('update:appId', appIdListener);
        this.device.on('update:deviceState', deviceStateListener);
        this.device.on('update:mediaType', mediaTypeListener);

        this.device.once('error', ((e: Error | NodePyATVDeviceEvent) => {
            this.log.debug(e as unknown as string);
            this.offline = true;
            this.log.warn('Lost connection. Trying to reconnect ...');

            this.device.removeListener('update:powerState', powerStateListener);
            // this.device.removeListener('update:appId', appIdListener);
            this.device.removeListener('update:deviceState', deviceStateListener);
            this.device.removeListener('update:mediaType', mediaTypeListener);

            const credentials = this.getCredentials();
            this.device = CustomPyAtvInstance.deviceAdvanced({
                id: this.device.id!,
                airplayCredentials: credentials,
                companionCredentials: credentials,
            }) || this.device;
            this.log.debug(`New internal device: ${this.device}`);

            this.createListeners();

        }).bind(this));
    }

    private createRemote(): void {
        this.log.debug('recreating rocket remote');

        this.rocketRemote = new RocketRemote(
            this.device.id!,
            CustomPyAtvInstance.getAtvremotePath(),
            this.getCredentials()!,
            this.getCredentials()!,
            this.log,
        );

        this.rocketRemote.onClose((async () => {
            await delay(5000);
            this.createRemote();
        }).bind(this));
    }

    private createMediaTypeSensors(): void {
        const mediaTypes = Object.keys(NodePyATVMediaType) as NodePyATVMediaType[];
        for (let i = 0; i < mediaTypes.length; i++) {
            const mediaType = mediaTypes[i];
            if (this.platform.config.mediaTypes !== undefined && !this.platform.config.mediaTypes.includes(mediaType)) {
                continue;
            }
            this.log.debug(`Adding media type ${mediaType} as a motion sensor.`);
            const s = this.accessory.getService(mediaType) || this.addServiceSave(this.platform.Service.MotionSensor, mediaType, mediaType)!
                .setCharacteristic(this.platform.Characteristic.MotionDetected, false)
                .setCharacteristic(this.platform.Characteristic.Name, capitalizeFirstLetter(mediaType))
                .setCharacteristic(this.platform.Characteristic.ConfiguredName, this.getMediaConfigs()[mediaType] || capitalizeFirstLetter(mediaType));
            s.getCharacteristic(this.platform.Characteristic.ConfiguredName)
                .onSet(async (value: CharacteristicValue) => {
                    if (value === '') {
                        return;
                    }
                    const oldConfiguredName = s.getCharacteristic(this.platform.Characteristic.ConfiguredName).value;
                    if (oldConfiguredName === value) {
                        return;
                    }
                    this.log.info(`Changing configured name of media type sensor ${mediaType} from ${oldConfiguredName} to ${value}.`);
                    this.setMediaTypeConfig(mediaType, value.toString());
                });
            s.getCharacteristic(this.platform.Characteristic.MotionDetected)
                .onGet(async () => {
                    if (this.offline) {
                        throw new this.platform.api.hap.HapStatusError(this.platform.api.hap.HAPStatus.SERVICE_COMMUNICATION_FAILURE);
                    }
                    return s.getCharacteristic(this.platform.Characteristic.MotionDetected).value;
                });
            this.service!.addLinkedService(s);
            this.mediaTypeServices[mediaType] = s;
        }
    }

    private createRemoteKeysAsSwitches(): void {
        const remoteKeys = Object.values(RemoteControlCommands) as RemoteControlCommands[];
        for (let i = 0; i < remoteKeys.length; i++) {
            const remoteKey = remoteKeys[i];
            if (this.platform.config.remoteKeysAsSwitch !== undefined && !this.platform.config.remoteKeysAsSwitch.includes(remoteKey)) {
                continue;
            }
            this.log.debug(`Adding remote key ${remoteKey} as a switch.`);
            const s = this.accessory.getService(remoteKey) || this.addServiceSave(this.platform.Service.Switch, remoteKey, remoteKey)!
                .setCharacteristic(this.platform.Characteristic.Name, capitalizeFirstLetter(remoteKey))
                .setCharacteristic(this.platform.Characteristic.ConfiguredName, this.getRemoteKeyAsSwitchConfigs()[remoteKey] || camelCaseToTitleCase(remoteKey))
                .setCharacteristic(this.platform.Characteristic.On, false);
            s.getCharacteristic(this.platform.Characteristic.ConfiguredName)
                .onSet(async (value: CharacteristicValue) => {
                    if (value === '') {
                        return;
                    }
                    const oldConfiguredName = s.getCharacteristic(this.platform.Characteristic.ConfiguredName).value;
                    if (oldConfiguredName === value) {
                        return;
                    }
                    this.log.info(`Changing configured name of remote key switch ${remoteKey} from ${oldConfiguredName} to ${value}.`);
                    this.setRemoteKeyAsSwitchConfig(remoteKey, value.toString());
                });
            s.getCharacteristic(this.platform.Characteristic.On)
                .onSet(async (value: CharacteristicValue) => {
                    if (value) {
                        this.log.info(`remote ${remoteKey}`);
                        this.rocketRemote?.sendCommand(remoteKey);
                        await delay(1000);
                        s.setCharacteristic(this.platform.Characteristic.On, false);
                    }
                })
                .onGet(async () => {
                    if (this.offline) {
                        throw new this.platform.api.hap.HapStatusError(this.platform.api.hap.HAPStatus.SERVICE_COMMUNICATION_FAILURE);
                    }
                    return false;
                });
            this.service!.addLinkedService(s);
            this.remoteKeyServices[remoteKey] = s;
        }
    }

    private async handleMediaTypeUpdate(event: NodePyATVDeviceEvent): Promise<void> {
        if (event.oldValue !== null && this.mediaTypeServices[event.oldValue]) {
            const s = this.mediaTypeServices[event.oldValue];
            s.setCharacteristic(this.platform.Characteristic.MotionDetected, false);
        }
        if (this.service?.getCharacteristic(this.platform.Characteristic.Active).value === this.platform.Characteristic.Active.INACTIVE) {
            return;
        }
        this.log.info(`New Media Type State: ${event.value}`);
        if (event.value !== null && this.mediaTypeServices[event.value]) {
            const s = this.mediaTypeServices[event.value];
            s.setCharacteristic(this.platform.Characteristic.MotionDetected, true);
        }
    }

    private createDeviceStateSensors(): void {
        const deviceStates = Object.keys(NodePyATVDeviceState) as NodePyATVDeviceState[];
        for (let i = 0; i < deviceStates.length; i++) {
            const deviceState = deviceStates[i];
            if (this.platform.config.deviceStates !== undefined && !this.platform.config.deviceStates.includes(deviceState)) {
                continue;
            }
            this.log.debug(`Adding device state ${deviceState} as a motion sensor.`);
            const s = this.accessory.getService(deviceState) || this.addServiceSave(this.platform.Service.MotionSensor, deviceState, deviceState)!
                .setCharacteristic(this.platform.Characteristic.MotionDetected, false)
                .setCharacteristic(this.platform.Characteristic.Name, capitalizeFirstLetter(deviceState))
                .setCharacteristic(this.platform.Characteristic.ConfiguredName, this.getDeviceStateConfigs()[deviceState] || capitalizeFirstLetter(deviceState));
            s.getCharacteristic(this.platform.Characteristic.ConfiguredName)
                .onSet(async (value) => {
                    if (value === '') {
                        return;
                    }
                    const oldConfiguredName = s.getCharacteristic(this.platform.Characteristic.ConfiguredName).value;
                    if (oldConfiguredName === value) {
                        return;
                    }
                    this.log.info(`Changing configured name of device state sensor ${deviceState} from ${oldConfiguredName} to ${value}.`);
                    this.setDeviceStateConfig(deviceState, value.toString());
                });
            s.getCharacteristic(this.platform.Characteristic.MotionDetected)
                .onGet(async () => {
                    if (this.offline) {
                        throw new this.platform.api.hap.HapStatusError(this.platform.api.hap.HAPStatus.SERVICE_COMMUNICATION_FAILURE);
                    }
                    return s.getCharacteristic(this.platform.Characteristic.MotionDetected).value;
                });
            this.service!.addLinkedService(s);
            this.deviceStateServices[deviceState] = s;
        }
    }

    private async handleDeviceStateUpdate(event: NodePyATVDeviceEvent): Promise<void> {
        if (event.oldValue !== null && this.deviceStateServices[event.oldValue] !== undefined) {
            const s = this.deviceStateServices[event.oldValue];
            s.setCharacteristic(this.platform.Characteristic.MotionDetected, false);
        }
        if (this.service?.getCharacteristic(this.platform.Characteristic.Active).value === this.platform.Characteristic.Active.INACTIVE) {
            return;
        }
        this.log.info(`New Device State: ${event.value}`);
        if (event.value !== null && this.deviceStateServices[event.value] !== undefined) {
            const s = this.deviceStateServices[event.value];
            s.setCharacteristic(this.platform.Characteristic.MotionDetected, true);
        }
        switch (event.value) {
        case NodePyATVDeviceState.playing:
            this.service?.setCharacteristic(
                this.platform.Characteristic.CurrentMediaState,
                this.platform.Characteristic.CurrentMediaState.PLAY,
            );
            break;
        case NodePyATVDeviceState.paused:
            this.service?.setCharacteristic(
                this.platform.Characteristic.CurrentMediaState,
                this.platform.Characteristic.CurrentMediaState.PAUSE,
            );
            break;
        case NodePyATVDeviceState.stopped:
            this.service?.setCharacteristic(
                this.platform.Characteristic.CurrentMediaState,
                this.platform.Characteristic.CurrentMediaState.STOP,
            );
            break;
        case NodePyATVDeviceState.loading:
            this.service?.setCharacteristic(
                this.platform.Characteristic.CurrentMediaState,
                this.platform.Characteristic.CurrentMediaState.LOADING,
            );
            break;
        case null:
            this.service?.setCharacteristic(
                this.platform.Characteristic.CurrentMediaState,
                this.platform.Characteristic.CurrentMediaState.INTERRUPTED,
            );
            break;
        }
    }

    private createInputs(apps: NodePyATVApp[]): void {
        const appConfigs = this.getAppConfigs();

        apps.forEach((app) => {
            if (!Object.keys(appConfigs).includes(app.id)) {
                appConfigs[app.id] = {
                    configuredName: DEFAULT_APP_RENAME[app.id] || trimSpecialCharacters(app.name),
                    isConfigured: this.platform.Characteristic.IsConfigured.CONFIGURED,
                    visibilityState: HIDE_BY_DEFAULT_APPS.includes(app.id)
                        ? this.platform.Characteristic.CurrentVisibilityState.HIDDEN
                        : this.platform.Characteristic.CurrentVisibilityState.SHOWN,
                    identifier: this.appIdToNumber(app.id),
                };
            }
        });

        apps.sort((a, b) => appConfigs[a.id].configuredName > appConfigs[b.id].configuredName ? 1 : -1);

        let addedApps: number = 0;
        apps.every((app) => {
            this.log.debug(`Adding ${appConfigs[app.id].configuredName} (${app.id}) as an input.`);
            const s = this.accessory.getService(app.name) || this.addServiceSave(this.platform.Service.InputSource, app.name, app.id);

            if (s === undefined) {
                this.log.warn(`\nThe maximum of ${MAX_SERVICES} on a single accessory is reached. The following services have been added:
- ${Object.keys(this.deviceStateServices).length} motion sensors for device states 
- ${Object.keys(this.mediaTypeServices).length} motion sensors for media types 
- ${Object.keys(this.remoteKeyServices).length} switches for remote keys 
- ${addedApps} apps have been added (${apps.length - addedApps} apps could not be added)
It might be a good idea to uninstall unused apps.`);
                return false;
            }

            s.setCharacteristic(this.platform.Characteristic.ConfiguredName, appConfigs[app.id].configuredName)
                .setCharacteristic(this.platform.Characteristic.InputSourceType, this.platform.Characteristic.InputSourceType.APPLICATION)
                .setCharacteristic(this.platform.Characteristic.IsConfigured, appConfigs[app.id].isConfigured)
                .setCharacteristic(this.platform.Characteristic.Name, app.name)
                .setCharacteristic(this.platform.Characteristic.CurrentVisibilityState, appConfigs[app.id].visibilityState)
                .setCharacteristic(this.platform.Characteristic.InputDeviceType, this.platform.Characteristic.InputDeviceType.OTHER)
                .setCharacteristic(this.platform.Characteristic.TargetVisibilityState, appConfigs[app.id].visibilityState)
                .setCharacteristic(this.platform.Characteristic.Identifier, appConfigs[app.id].identifier);
            s.getCharacteristic(this.platform.Characteristic.ConfiguredName)
                .onSet(async (value) => {
                    if (value === '') {
                        return;
                    }
                    if (appConfigs[app.id].configuredName === value) {
                        return;
                    }
                    this.log.info(`Changing configured name of ${app.id} from ${appConfigs[app.id].configuredName} to ${value}.`);
                    appConfigs[app.id].configuredName = value.toString();
                    this.setAppConfigs(appConfigs);
                })
                .onGet(async () => {
                    return appConfigs[app.id].configuredName;
                });
            s.getCharacteristic(this.platform.Characteristic.IsConfigured)
                .onSet(async (value) => {
                    this.log.info(`Changing is configured of ${appConfigs[app.id].configuredName} (${app.id}) from ${appConfigs[app.id].isConfigured} to ${value}.`);
                    appConfigs[app.id].isConfigured = value as 0 | 1;
                    this.setAppConfigs(appConfigs);
                });
            s.getCharacteristic(this.platform.Characteristic.TargetVisibilityState)
                .onSet(async (value) => {
                    this.log.info(`Changing visibility state of ${appConfigs[app.id].configuredName} (${app.id}) from ${appConfigs[app.id].visibilityState} to ${value}.`);
                    appConfigs[app.id].visibilityState = value as 0 | 1;
                    s.setCharacteristic(this.platform.Characteristic.CurrentVisibilityState, value);
                    this.setAppConfigs(appConfigs);
                });
            this.service!.addLinkedService(s);
            this.inputs[app.id] = {
                pyatvApp: app,
                service: s,
            };

            addedApps++;

            return true;
        });
        this.setAppConfigs(appConfigs);

        const appOrderIdentifiers: number[] = apps.slice(0, addedApps).map((e) => appConfigs[e.id].identifier);
        const tlv8 = this.appIdentifiersOrderToTLV8(appOrderIdentifiers);
        this.log.debug(`Input display order: ${tlv8}`);
        this.service!.setCharacteristic(this.platform.Characteristic.DisplayOrder, tlv8);
    }

    private async handleInputUpdate(event: NodePyATVDeviceEvent): Promise<void> {
        if (event === null) {
            return;
        }
        if (event.value === event.oldValue) {
            return;
        }
        const appId = event.value;
        this.log.info(`Current App: ${appId}`);
        const appConfig = this.getAppConfigs()[appId];
        if (appConfig) {
            const appIdentifier = appConfig.identifier;
            this.setCommonConfig('activeIdentifier', appIdentifier);
            this.service!.setCharacteristic(this.platform.Characteristic.ActiveIdentifier, appIdentifier);
        } else {
            this.log.warn(`Could not update the input to ${appId} since the app is unknown.`);
        }
    }

    private getAppConfigs(): IAppConfigs {
        if (this.appConfigs === undefined) {
            const jsonPath = this.getPath('apps.json');
            this.appConfigs = JSON.parse(fs.readFileSync(jsonPath, 'utf8')) as IAppConfigs;
        }
        return this.appConfigs;
    }

    private setAppConfigs(value: IAppConfigs): void {
        this.appConfigs = value;
        const jsonPath = this.getPath('apps.json');
        fs.writeFileSync(jsonPath, JSON.stringify(value, null, 4), { encoding:'utf8', flag:'w' });
    }

    private getCommonConfig(): ICommonConfig {
        if (this.commonConfig === undefined) {
            const jsonPath = this.getPath('common.json');
            this.commonConfig = JSON.parse(fs.readFileSync(jsonPath, 'utf8')) as IAppConfigs;
        }
        return this.commonConfig;
    }

    private setCommonConfig(key: string, value: PrimitiveTypes): void {
        if (this.commonConfig === undefined) {
            this.commonConfig = {};
        }
        this.commonConfig[key] = value;
        const jsonPath = this.getPath('common.json');
        fs.writeFileSync(jsonPath, JSON.stringify(this.commonConfig, null, 4), { encoding:'utf8', flag:'w' });
    }

    private getMediaConfigs(): IMediaConfigs {
        if (this.mediaConfigs === undefined) {
            const jsonPath = this.getPath('mediaTypes.json');
            this.mediaConfigs = JSON.parse(fs.readFileSync(jsonPath, 'utf8')) as IMediaConfigs;
        }
        return this.mediaConfigs;
    }

    private setMediaTypeConfig(key: string, value: string): void {
        if (this.mediaConfigs === undefined) {
            this.mediaConfigs = {};
        }
        this.mediaConfigs[key] = value;
        const jsonPath = this.getPath('mediaTypes.json');
        fs.writeFileSync(jsonPath, JSON.stringify(this.mediaConfigs, null, 4), { encoding:'utf8', flag:'w' });
    }

    private getDeviceStateConfigs(): IStateConfigs {
        if (this.stateConfigs === undefined) {
            const jsonPath = this.getPath('deviceStates.json');
            this.stateConfigs = JSON.parse(fs.readFileSync(jsonPath, 'utf8')) as IStateConfigs;
        }
        return this.stateConfigs;
    }

    private setDeviceStateConfig(key: string, value: string): void {
        if (this.stateConfigs === undefined) {
            this.stateConfigs = {};
        }
        this.stateConfigs[key] = value;
        const jsonPath = this.getPath('deviceStates.json');
        fs.writeFileSync(jsonPath, JSON.stringify(this.stateConfigs, null, 4), { encoding:'utf8', flag:'w' });
    }

    private getRemoteKeyAsSwitchConfigs(): IRemoteKeysAsSwitchConfigs {
        if (this.remoteKeyAsSwitchConfigs === undefined) {
            const jsonPath = this.getPath('remoteKeySwitches.json');
            this.remoteKeyAsSwitchConfigs = JSON.parse(fs.readFileSync(jsonPath, 'utf8')) as IRemoteKeysAsSwitchConfigs;
        }
        return this.remoteKeyAsSwitchConfigs;
    }

    private setRemoteKeyAsSwitchConfig(key: string, value: string): void {
        if (this.remoteKeyAsSwitchConfigs === undefined) {
            this.remoteKeyAsSwitchConfigs = {};
        }
        this.remoteKeyAsSwitchConfigs[key] = value;
        const jsonPath = this.getPath('remoteKeySwitches.json');
        fs.writeFileSync(jsonPath, JSON.stringify(this.remoteKeyAsSwitchConfigs, null, 4), { encoding:'utf8', flag:'w' });
    }

    private async handleActiveGet(): Promise<Nullable<CharacteristicValue>> {
        if (this.offline) {
            throw new this.platform.api.hap.HapStatusError(this.platform.api.hap.HAPStatus.SERVICE_COMMUNICATION_FAILURE);
        }
        return this.service!.getCharacteristic(this.platform.Characteristic.Active).value;
    }

    private async handleActiveSet(state: CharacteristicValue): Promise<void> {
        // prevent turning on the Apple TV when starting up the plugin when HomePods are selected as audio output
        if (this.isFirstActiveSet) {
            this.log.debug('Not setting the active state since this is the initial update');
            this.isFirstActiveSet = false;
            return;
        }

        const WAIT_MAX_FOR_STATES = 30; // seconds
        const STEPS = 500; // milliseconds

        if (state === this.platform.Characteristic.Active.ACTIVE && !this.turningOn) {
            this.turningOn = true;
            this.lastActiveSet = Date.now();
            this.log.info('Turning on');
            this.device?.turnOn();
            for (let i = STEPS; i <= WAIT_MAX_FOR_STATES * 1000; i += STEPS) {
                const { mediaType, deviceState } = await this.device.getState();
                if (deviceState === null || mediaType === null) {
                    await delay(STEPS);
                    this.log.debug(`Waiting until mediaType and deviceState is reported: ${i}ms`);
                    continue;
                }
                if (this.mediaTypeServices[mediaType]) {
                    this.log.info(`New Media Type State: ${mediaType}`);
                    this.mediaTypeServices[mediaType].setCharacteristic(this.platform.Characteristic.MotionDetected, true);
                }
                if (this.deviceStateServices[deviceState]) {
                    this.log.info(`New Device State: ${deviceState}`);
                    this.deviceStateServices[deviceState].setCharacteristic(this.platform.Characteristic.MotionDetected, true);
                }
                break;
            }
            this.turningOn = false;
        } else if (state === this.platform.Characteristic.Active.INACTIVE && this.lastActiveSet + 7500 < Date.now()) {
            this.log.info('Turning off');
            this.device?.turnOff();
        }
    }

    private handleActiveUpdate(event: NodePyATVDeviceEvent) {
        if (event.value === null) {
            return;
        }
        if (event.value === event.oldValue) {
            return;
        }
        const value = event.value === 'on' ? this.platform.Characteristic.Active.ACTIVE : this.platform.Characteristic.Active.INACTIVE;
        if (value === this.platform.Characteristic.Active.INACTIVE && this.lastActiveSet + 7500 > Date.now()) {
            return;
        }
        this.log.info(`New Active State: ${event.value}`);
        this.service!.setCharacteristic(this.platform.Characteristic.Active, value);
    }

    private async handleActiveIdentifierGet(): Promise<Nullable<CharacteristicValue>> {
        return this.service!.getCharacteristic(this.platform.Characteristic.ActiveIdentifier).value;
    }

    private async handleActiveIdentifierSet(state: CharacteristicValue): Promise<void> {
        const appConfigs = this.getAppConfigs();
        let appId: string | undefined = undefined;
        for (const key in appConfigs) {
            if (appConfigs[key].identifier === state) {
                appId = key;
            }
        }
        if (appId !== undefined) {
            this.setCommonConfig('activeIdentifier', state as number);
            const app = this.inputs[appId];
            this.log.info(`Launching App: ${app.pyatvApp.name}`);
            app.pyatvApp.launch();
        }
    }

    private async handleConfiguredNameGet(): Promise<Nullable<CharacteristicValue>> {
        return this.service!.getCharacteristic(this.platform.Characteristic.ConfiguredName).value;
    }

    private async handleConfiguredNameSet(state: CharacteristicValue): Promise<void> {
        if (state === '') {
            return;
        }
        const oldConfiguredName = this.service!.getCharacteristic(this.platform.Characteristic.ConfiguredName).value;
        if (oldConfiguredName === state) {
            return;
        }
        this.log.info(`Changed Configured Name from ${oldConfiguredName} to ${state}`);
        this.setCommonConfig('configuredName', state.toString());
        this.log.setPrefix(`${state} (${this.device.id})`);
    }

    private async handleSleepDiscoveryModeGet(): Promise<Nullable<CharacteristicValue>> {
        return this.service!.getCharacteristic(this.platform.Characteristic.SleepDiscoveryMode).value;
    }

    private async handleRemoteKeySet(state: CharacteristicValue): Promise<void> {
        switch (state) {
        case this.platform.Characteristic.RemoteKey.REWIND:
            this.rocketRemote?.skipBackward();
            break;
        case this.platform.Characteristic.RemoteKey.FAST_FORWARD:
            this.rocketRemote?.skipForward();
            break;
        case this.platform.Characteristic.RemoteKey.NEXT_TRACK:
            this.rocketRemote?.next();
            break;
        case this.platform.Characteristic.RemoteKey.PREVIOUS_TRACK:
            this.rocketRemote?.previous();
            break;
        case this.platform.Characteristic.RemoteKey.ARROW_UP:
            this.rocketRemote?.up();
            break;
        case this.platform.Characteristic.RemoteKey.ARROW_DOWN:
            this.rocketRemote?.down();
            break;
        case this.platform.Characteristic.RemoteKey.ARROW_LEFT:
            this.rocketRemote?.left();
            break;
        case this.platform.Characteristic.RemoteKey.ARROW_RIGHT:
            this.rocketRemote?.right();
            break;
        case this.platform.Characteristic.RemoteKey.SELECT:
            this.rocketRemote?.select();
            break;
        case this.platform.Characteristic.RemoteKey.BACK:
            this.rocketRemote?.menu();
            break;
        case this.platform.Characteristic.RemoteKey.EXIT:
            this.rocketRemote?.home();
            break;
        case this.platform.Characteristic.RemoteKey.PLAY_PAUSE:
            this.rocketRemote?.playPause();
            break;
        case this.platform.Characteristic.RemoteKey.INFORMATION:
            this.rocketRemote?.topMenu();
            break;
        }
    }

    private appIdToNumber(appId: string): number {
        const hash = new Uint8Array(md5(appId, { asBytes: true }));
        const view = new DataView(hash.buffer);
        return view.getUint32(0);
    }

    private getPath(file: string, defaultContent = '{}'): string {
        let dir = path.join(this.platform.api.user.storagePath(), 'appletv-enhanced');
        if (!fs.existsSync(dir)){
            fs.mkdirSync(dir);
        }
        dir += `/${this.device.id!.replaceAll(':', '')}`;
        if (!fs.existsSync(dir)){
            fs.mkdirSync(dir);
        }
        const filePath = path.join(dir, file);
        try {
            fs.writeFileSync(filePath, defaultContent, { encoding:'utf8', flag: 'wx' });
        } catch (err) { /* empty */ }
        return filePath;
    }

    private getCredentials(): string | undefined {
        if (!this.credentials) {
            const path = this.getPath('credentials.txt', '');
            const fileContent = fs.readFileSync(path, 'utf8').trim();
            this.credentials = fileContent === '' ? undefined : fileContent;
            this.log.debug(`Loaded credentials: ${this.credentials}`);
        }
        return this.credentials;
    }

    private setCredentials(value: string): void {
        const path = this.getPath('credentials.txt', '');
        fs.writeFileSync(path, value, { encoding:'utf8', flag:'w' });
    }

    private async pair(ip: string, mac: string, appleTVName: string): Promise<string> {
        this.log.debug('Got empty credentials, initiating pairing process.');

        const ipSplitted = ip.split('.');
        const ipEnd = ipSplitted[ipSplitted.length - 1];
        const httpPort = 42000 + parseInt(ipEnd);

        const htmlInput = fs.readFileSync(path.join(__dirname, 'html', 'input.html'), 'utf8');
        const htmlAfterPost = fs.readFileSync(path.join(__dirname, 'html', 'afterPost.html'), 'utf8');

        let goOn = false;
        let success = false;

        const localIP = getLocalIP();
        let credentials = '';

        while (!success) {
            let backOffSeconds = 0;
            let processClosed = false;

            const process = spawn(CustomPyAtvInstance.getAtvremotePath(), ['--id', mac, '--protocol', 'companion', 'pair']);
            process.stderr.setEncoding('utf8');
            process.stderr.on('data', (data: string) => {
                this.log.error('stderr: ' + data);
                goOn = true;
            });
            process.stdout.setEncoding('utf8');
            process.stdout.on('data', (data: string) => {
                this.log.debug('stdout: ' + data);
                if (data.includes('Enter PIN on screen:')) {
                    return;
                }
                if (data.includes('BackOff=')) {
                    backOffSeconds = parseInt(data.substring(data.search('BackOff=') + 8).split('s', 2)[0]) + 5;
                    goOn = true;
                    return;
                }
                if (data.toUpperCase().includes('ERROR')) {
                    goOn = true;
                    return;
                }
                if (data.includes('You may now use these credentials: ')) {
                    const split = data.split(': ');
                    credentials = split[1].trim();
                    this.log.debug(`Extracted credentials: ${split[1]}`);
                    goOn = true;
                    success = true;
                }
            });
            process.on('close', () => {
                processClosed = true;
            });

            setTimeout(() => {
                if (!processClosed) {
                    this.log.warn('Pairing request timed out, retrying ...');
                    this.log.debug('Send \\n to the stdout of the atvremote process to terminate it.');
                    process.stdin.write('\n');
                }
            }, 32000);

            const requestListener = (req: IncomingMessage, res: ServerResponse<IncomingMessage> & { req: IncomingMessage }): void => {
                res.setHeader('Content-Security-Policy', 'default-src * \'self\' data: \'unsafe-inline\' \'unsafe-hashes\' \'unsafe-eval\';\
                script-src * \'self\' data: \'unsafe-inline\' \'unsafe-hashes\' \'unsafe-eval\';\
                script-src-elem * \'self\' data: \'unsafe-inline\' \'unsafe-hashes\' \'unsafe-eval\';\
                script-src-attr * \'self\' data: \'unsafe-inline\' \'unsafe-hashes\' \'unsafe-eval\';\
                media-src * \'self\'');
                res.setHeader('Cache-Control', 'max-age=0, no-cache, must-revalidate, proxy-revalidate');
                res.writeHead(200);
                if (req.method === 'GET') {
                    res.end(htmlInput);
                } else {
                    let reqBody = '';
                    req.on('data', (chunk) => {
                        reqBody += chunk;
                    });
                    req.on('end', () => {
                        const [a, b, c, d] = reqBody.split('&').map((e) => e.charAt(2));
                        const pin = `${a}${b}${c}${d}`;
                        this.log.info(`Got PIN ${pin} for Apple TV ${appleTVName}.`);
                        process.stdin.write(`${pin}\n`);
                        res.end(htmlAfterPost);
                    });
                }
            };
            const server = http.createServer(requestListener);
            server.listen(httpPort, '0.0.0.0', () => {
                // eslint-disable-next-line max-len
                this.log.warn(`You need to pair your Apple TV before the plugin can connect to it. Enter the PIN that is currently displayed on the device here: http://${localIP}:${httpPort}/`);
            });

            this.log.debug('Wait for the atvremote process to terminate');
            while (!goOn || !processClosed) {
                await delay(100);
            }
            server.close();

            if (backOffSeconds !== 0) {
                this.log.warn(`Apple TV ${appleTVName}: Too many attempts. Waiting for ${backOffSeconds} seconds before retrying.`);
                for (; backOffSeconds > 0; backOffSeconds--) {
                    this.log.debug(`${backOffSeconds} seconds remaining.`);
                    await delay(1000);
                }
            }
        }

        return credentials;
    }

    public async untilBooted(): Promise<void> {
        while (!this.booted) {
            await delay(100);
        }
        this.log.debug('Reporting as booted.');
    }

    private async credentialsValid(): Promise<boolean> {
        return this.device.listApps()
            .then(() => true)
            .catch((error: unknown) => {
                if (error instanceof Error && error.message.includes('pyatv.exceptions.ProtocolError: Command _systemInfo failed')) {
                    this.log.debug(error.message);
                    return false;
                }
                throw error;
            });
    }

    // https://github.com/homebridge/HAP-NodeJS/issues/644#issue-409099368
    private appIdentifiersOrderToTLV8(listOfIdentifiers: number[]): string {
        let identifiersTLV: Buffer = Buffer.alloc(0);
        listOfIdentifiers.forEach((identifier: number, index: number) => {
            if (index !== 0) {
                identifiersTLV= Buffer.concat([
                    identifiersTLV,
                    this.platform.api.hap.encode(DisplayOrderTypes.ARRAY_ELEMENT_END, Buffer.alloc(0)),
                ]);
            }

            const element: Buffer = Buffer.alloc(4);
            element.writeUInt32LE(identifier, 0);
            identifiersTLV = Buffer.concat([
                identifiersTLV,
                this.platform.api.hap.encode(DisplayOrderTypes.ARRAY_ELEMENT_START, element),
            ]);
        });
        return identifiersTLV.toString('base64');
    }

    private addServiceSave<S extends typeof Service>(serviceConstructor: S, ...constructorArgs: ConstructorArgs<S>): Service | undefined {
        if (this.totalServices >= MAX_SERVICES) {
            return undefined;
        }
        this.totalServices++;
        this.log.debug(`Total services ${this.totalServices} (${MAX_SERVICES - this.totalServices} remaining)`);
        return this.accessory.addService(serviceConstructor, ...constructorArgs);
    }
}
