import fs from 'fs';
import http, { type IncomingMessage, type ServerResponse } from 'http';
import type { Service, PlatformAccessory, CharacteristicValue, Nullable, PrimitiveTypes, ConstructorArgs } from 'homebridge';
import type { AppleTVEnhancedPlatform } from './appleTVEnhancedPlatform';
import { NodePyATVDeviceState, NodePyATVMediaType } from '@sebbo2002/node-pyatv';
import type {NodePyATVDevice, NodePyATVDeviceEvent, NodePyATVEventValueType } from '@sebbo2002/node-pyatv';
import md5 from 'md5';
import { type ChildProcessWithoutNullStreams, spawn } from 'child_process';
import path from 'path';
import CustomPyAtvInstance from './CustomPyAtvInstance';
import {
    capitalizeFirstLetter,
    delay,
    removeSpecialCharacters,
    getLocalIP,
    trimSpecialCharacters,
    snakeCaseToTitleCase,
    trimToMaxLength,
} from './utils';
import type {
    AppleTVEnhancedPlatformConfig,
    DeviceConfigOverride,
    IAppConfig,
    IAppConfigs,
    ICommonConfig,
    ICustomInput,
    IInputs,
    NodePyATVApp,
} from './interfaces';
import PrefixLogger from './PrefixLogger';
import { DisplayOrderTypes, RocketRemoteKey } from './enums';
import type { TDeviceStateConfigs, TMediaConfigs, TRemoteKeysAsSwitchConfigs } from './types';
import RocketRemote from './RocketRemote';


const HIDE_BY_DEFAULT_APPS: string[] = [
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

const DEFAULT_APP_RENAME: Record<string, string> = {
    'com.apple.TVWatchList': 'Apple TV',
    'com.apple.TVMusic': 'Apple Music',
};

const MAX_SERVICES: number = 100;

const HOME_IDENTIFIER: number = 69;
const AVADA_KEDAVRA_IDENTIFIER: number = 42;

/**
 * Platform Accessory
 * An instance of this class is created for each accessory your platform registers
 * Each accessory may expose multiple services of different service types.
 */
export class AppleTVEnhancedAccessory {
    private service: Service | undefined = undefined;
    private device: NodePyATVDevice;
    private inputs: IInputs = {};
    private deviceStateServices: Partial<Record<NodePyATVDeviceState, Service>> = {};
    private mediaTypeServices: Partial<Record<NodePyATVMediaType, Service>> = {};
    private remoteKeyServices: Partial<Record<RocketRemoteKey, Service>> = {};
    private avadaKedavraService: Service | undefined = undefined;
    private homeInputService: Service | undefined = undefined;
    private televisionSpeakerService: Service | undefined = undefined;
    private rocketRemote: RocketRemote | undefined = undefined;

    private config: AppleTVEnhancedPlatformConfig;

    private appConfigs: IAppConfigs | undefined = undefined;
    private commonConfig: ICommonConfig | undefined = undefined;

    private deviceStateConfigs: TDeviceStateConfigs | undefined = undefined;
    private mediaConfigs: TMediaConfigs | undefined = undefined;
    private remoteKeyAsSwitchConfigs: TRemoteKeysAsSwitchConfigs | undefined = undefined;

    private booted: boolean = false;
    private offline: boolean = false;
    private lastTurningOnEvent: number = 0;
    private lastDeviceStateChange: number = 0;
    private lastDeviceState: NodePyATVDeviceState | null = null;

    private credentials: string | undefined = undefined;

    private readonly log: PrefixLogger;

    public constructor(
        private readonly platform: AppleTVEnhancedPlatform,
        private readonly accessory: PlatformAccessory,
    ) {
        this.config = this.applyConfigOverrides(this.platform.config, this.accessory.context.mac);

        this.device = CustomPyAtvInstance.deviceAdvanced({ mac: this.accessory.context.mac as string })!;

        this.log = new PrefixLogger(this.platform.logLevelLogger, `${this.device.name} (${this.device.mac})`);

        const credentials: string | undefined = this.getCredentials();
        this.device = CustomPyAtvInstance.deviceAdvanced({
            mac: this.accessory.context.mac as string,
            airplayCredentials: credentials,
            companionCredentials: credentials,
        })!;

        const pairingRequired = async (): Promise<void> => {
            return this.pair(this.device.host, this.device.name).then((c) => {
                this.setCredentials(c);
                this.device = CustomPyAtvInstance.deviceAdvanced({
                    mac: this.device.mac!,
                    airplayCredentials: c,
                    companionCredentials: c,
                })!;
                this.log.warn('Paring was successful. Add it to your home in the Home app: com.apple.home://launch');
            });
        };

        const validationLoop = (): void => {
            this.credentialsValid().then((valid: boolean): void => {
                if (valid) {
                    this.log.info('Credentials are still valid. Continuing ...');
                    this.startUp();
                } else {
                    this.log.warn('Credentials are no longer valid. Need to repair ...');
                    pairingRequired().then(validationLoop.bind(this));
                }
            });
        };

        validationLoop();
    }

    public async untilBooted(): Promise<void> {
        while (!this.booted) {
            await delay(100);
        }
        this.log.debug('Reporting as booted.');
    }

    private async startUp(): Promise<void> {
        this.accessory.category = this.platform.api.hap.Categories.APPLE_TV;

        // set accessory information
        this.accessory.getService(this.platform.Service.AccessoryInformation)!
            .setCharacteristic(this.platform.Characteristic.Manufacturer, 'Apple Inc.')
            .setCharacteristic(this.platform.Characteristic.Model, this.device.modelName!)
            .setCharacteristic(this.platform.Characteristic.SerialNumber, this.device.mac!)
            .setCharacteristic(this.platform.Characteristic.Name, removeSpecialCharacters(this.device.name))
            .setCharacteristic(this.platform.Characteristic.FirmwareRevision, this.device.version!);

        const configuredName: string = this.getCommonConfig().configuredName || removeSpecialCharacters(this.accessory.displayName);

        // create the service
        this.service =
            this.accessory.getService(this.platform.Service.Television) || this.addServiceSave(this.platform.Service.Television)!;
        this.service.addCharacteristic(this.platform.Characteristic.FirmwareRevision);
        this.service
            .setCharacteristic(this.platform.Characteristic.Active, this.platform.Characteristic.Active.INACTIVE)
            .setCharacteristic(
                this.platform.Characteristic.ActiveIdentifier,
                this.getCommonConfig().activeIdentifier || this.appIdToNumber('com.apple.TVSettings'),
            )
            .setCharacteristic(this.platform.Characteristic.ConfiguredName, configuredName)
            .setCharacteristic(
                this.platform.Characteristic.SleepDiscoveryMode,
                this.platform.Characteristic.SleepDiscoveryMode.ALWAYS_DISCOVERABLE,
            )
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

        this.log.setPrefix(`${configuredName} (${this.device.mac})`);

        // create television speaker
        this.createTelevisionSpeaker();

        // create input and sensor services
        this.createDeviceStateSensors();
        this.createMediaTypeSensors();
        this.createRemoteKeysAsSwitches();
        this.createAvadaKedavra();
        this.createHomeInput();
        const apps: NodePyATVApp[] = await this.device.listApps();
        this.createInputs(apps, this.config.customInputURIs || []);

        // create event listeners to keep everything up-to-date
        this.createListeners();

        // create remote
        this.createRemote();

        this.log.info('Finished initializing');
        this.booted = true;
    }

    private createTelevisionSpeaker(): void {
        this.log.debug('Adding television speaker.');

        this.televisionSpeakerService = this.accessory.getService('televisionSpeaker') ||
            this.addServiceSave(this.platform.Service.TelevisionSpeaker, 'televisionSpeaker', 'televisionSpeaker')!;
        this.televisionSpeakerService.setCharacteristic(this.platform.Characteristic.Active, this.platform.Characteristic.Active.ACTIVE);
        this.televisionSpeakerService.setCharacteristic(this.platform.Characteristic.Mute, false);

        if (this.config.disableVolumeControlRemote !== true) {
            this.televisionSpeakerService.setCharacteristic(
                this.platform.Characteristic.VolumeControlType,
                this.platform.Characteristic.VolumeControlType.RELATIVE,
            );
            this.televisionSpeakerService.getCharacteristic(this.platform.Characteristic.VolumeSelector)
                .onSet(async (value: CharacteristicValue): Promise<void> => {
                    if (value === this.platform.Characteristic.VolumeSelector.INCREMENT) {
                        this.rocketRemote?.volumeUp();
                    } else {
                        this.rocketRemote?.volumeDown();
                    }
                });
        }

    }

    private createListeners(): void {
        this.log.debug('recreating listeners');

        const filterErrorHandler = (event: Error | NodePyATVDeviceEvent, listener: (event: NodePyATVDeviceEvent) => void): void => {
            if (!(event instanceof Error)) {
                if (this.offline && event.value !== null) {
                    this.log.info('Reestablished the connection');
                    this.offline = false;
                }
                this.log.debug(`event ${event.key}: ${event.value}`);
                listener(event);
            }
        };

        const powerStateListener = (e: Error | NodePyATVDeviceEvent): void => filterErrorHandler(e, this.handleActiveUpdate.bind(this));
        const appIdListener = (e: Error | NodePyATVDeviceEvent): void => filterErrorHandler(e, this.handleInputUpdate.bind(this));
        const deviceStateListener = (e: Error | NodePyATVDeviceEvent): void => filterErrorHandler(
            e, this.handleDeviceStateUpdate.bind(this));
        const mediaTypeListener = (e: Error | NodePyATVDeviceEvent): void => filterErrorHandler(e, this.handleMediaTypeUpdate.bind(this));

        this.device.on('update:powerState', powerStateListener);
        this.device.on('update:appId', appIdListener);
        this.device.on('update:deviceState', deviceStateListener);
        this.device.on('update:mediaType', mediaTypeListener);

        this.device.once('error', ((e: Error | NodePyATVDeviceEvent): void => {
            this.log.debug(e as unknown as string);
            this.offline = true;
            this.log.warn('Lost connection. Trying to reconnect ...');

            this.device.removeListener('update:powerState', powerStateListener);
            this.device.removeListener('update:appId', appIdListener);
            this.device.removeListener('update:deviceState', deviceStateListener);
            this.device.removeListener('update:mediaType', mediaTypeListener);

            const credentials: string | undefined = this.getCredentials();
            this.device = CustomPyAtvInstance.deviceAdvanced({
                mac: this.device.mac!,
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
            this.device.host,
            CustomPyAtvInstance.getAtvremotePath(),
            this.getCredentials()!,
            this.getCredentials()!,
            this.log,
            this.config.avadaKedavraAppAmount || 15,
        );

        this.rocketRemote.onHome((async (): Promise<void> => {
            this.service?.updateCharacteristic(this.platform.Characteristic.ActiveIdentifier, HOME_IDENTIFIER);
        }).bind(this));

        this.rocketRemote.onClose((async (): Promise<void> => {
            await delay(5000);
            this.createRemote();
        }).bind(this));
    }

    private createMediaTypeSensors(): void {
        const mediaTypes: NodePyATVMediaType[] = Object.keys(NodePyATVMediaType) as NodePyATVMediaType[];
        for (const mediaType of mediaTypes) {
            if (this.config.mediaTypes === undefined || !this.config.mediaTypes.includes(mediaType)) {
                continue;
            }
            const configuredName: string = this.getMediaConfigs()[mediaType] || capitalizeFirstLetter(mediaType);
            this.log.debug(`Adding media type ${mediaType} as a motion sensor. (named: ${configuredName})`);
            const s: Service = this.accessory.getService(mediaType) ||
                this.addServiceSave(this.platform.Service.MotionSensor, mediaType, mediaType)!;
            s.addOptionalCharacteristic(this.platform.Characteristic.ConfiguredName);
            s
                .setCharacteristic(this.platform.Characteristic.MotionDetected, false)
                .setCharacteristic(this.platform.Characteristic.Name, capitalizeFirstLetter(mediaType))
                .setCharacteristic(this.platform.Characteristic.ConfiguredName, configuredName);
            s.getCharacteristic(this.platform.Characteristic.ConfiguredName)
                .onSet(async (value: CharacteristicValue) => {
                    if (value === '') {
                        return;
                    }
                    const oldConfiguredName: Nullable<CharacteristicValue> =
                        s.getCharacteristic(this.platform.Characteristic.ConfiguredName).value;
                    if (oldConfiguredName === value) {
                        return;
                    }
                    this.log.info(`Changing configured name of media type sensor ${mediaType} from ${oldConfiguredName} to ${value}.`);
                    this.setMediaTypeConfig(mediaType, value.toString());
                });
            s.getCharacteristic(this.platform.Characteristic.MotionDetected)
                .onGet(async (): Promise<CharacteristicValue> => {
                    if (this.offline) {
                        throw new this.platform.api.hap.HapStatusError(this.platform.api.hap.HAPStatus.SERVICE_COMMUNICATION_FAILURE);
                    }
                    return s.getCharacteristic(this.platform.Characteristic.MotionDetected).value as CharacteristicValue;
                });
            this.service!.addLinkedService(s);
            this.mediaTypeServices[mediaType] = s;
        }
    }

    private createRemoteKeysAsSwitches(): void {
        const remoteKeys: RocketRemoteKey[] = Object.values(RocketRemoteKey) as RocketRemoteKey[];
        for (const remoteKey of remoteKeys) {
            if (this.config.remoteKeysAsSwitch === undefined || !this.config.remoteKeysAsSwitch.includes(remoteKey)) {
                continue;
            }
            const configuredName: string = this.getRemoteKeyAsSwitchConfigs()[remoteKey] || snakeCaseToTitleCase(remoteKey);
            this.log.debug(`Adding remote key ${remoteKey} as a switch. (named: ${configuredName})`);
            const s: Service = this.accessory.getService(remoteKey) ||
                this.addServiceSave(this.platform.Service.Switch, remoteKey, remoteKey)!;
            s.addOptionalCharacteristic(this.platform.Characteristic.ConfiguredName);
            s
                .setCharacteristic(this.platform.Characteristic.Name, capitalizeFirstLetter(remoteKey))
                .setCharacteristic(this.platform.Characteristic.ConfiguredName, configuredName)
                .setCharacteristic(this.platform.Characteristic.On, false);
            s.getCharacteristic(this.platform.Characteristic.ConfiguredName)
                .onSet(async (value: CharacteristicValue): Promise<void> => {
                    if (value === '') {
                        return;
                    }
                    const oldConfiguredName: Nullable<CharacteristicValue> =
                        s.getCharacteristic(this.platform.Characteristic.ConfiguredName).value;
                    if (oldConfiguredName === value) {
                        return;
                    }
                    this.log.info(`Changing configured name of remote key switch ${remoteKey} from ${oldConfiguredName} to ${value}.`);
                    this.setRemoteKeyAsSwitchConfig(remoteKey, value.toString());
                });
            s.getCharacteristic(this.platform.Characteristic.On)
                .onSet(async (value: CharacteristicValue): Promise<void> => {
                    if (value) {
                        this.rocketRemote?.sendCommand(remoteKey);
                    }
                    await delay(1000);
                    s.updateCharacteristic(this.platform.Characteristic.On, false);
                })
                .onGet(async (): Promise<CharacteristicValue> => {
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
            const s: Service = this.mediaTypeServices[event.oldValue];
            s.updateCharacteristic(this.platform.Characteristic.MotionDetected, false);
        }
        if (this.service?.getCharacteristic(this.platform.Characteristic.Active).value === this.platform.Characteristic.Active.INACTIVE) {
            return;
        }
        this.log.info(`New Media Type State: ${event.value}`);
        if (event.value !== null && this.mediaTypeServices[event.value]) {
            const s: Service = this.mediaTypeServices[event.value];
            s.updateCharacteristic(this.platform.Characteristic.MotionDetected, true);
        }
    }

    private createDeviceStateSensors(): void {
        const deviceStates: NodePyATVDeviceState[] = Object.keys(NodePyATVDeviceState) as NodePyATVDeviceState[];
        for (const deviceState of deviceStates) {
            if (this.config.deviceStates === undefined || !this.config.deviceStates.includes(deviceState)) {
                continue;
            }
            const configuredName: string = this.getDeviceStateConfigs()[deviceState] || capitalizeFirstLetter(deviceState);
            this.log.debug(`Adding device state ${deviceState} as a motion sensor. (named: ${configuredName})`);
            const s: Service = this.accessory.getService(deviceState) ||
                this.addServiceSave(this.platform.Service.MotionSensor, deviceState, deviceState)!;
            s.addOptionalCharacteristic(this.platform.Characteristic.ConfiguredName);
            s
                .setCharacteristic(this.platform.Characteristic.MotionDetected, false)
                .setCharacteristic(this.platform.Characteristic.Name, capitalizeFirstLetter(deviceState))
                .setCharacteristic(this.platform.Characteristic.ConfiguredName, configuredName);
            s.getCharacteristic(this.platform.Characteristic.ConfiguredName)
                .onSet(async (value: CharacteristicValue) => {
                    if (value === '') {
                        return;
                    }
                    const oldConfiguredName: Nullable<CharacteristicValue> =
                        s.getCharacteristic(this.platform.Characteristic.ConfiguredName).value;
                    if (oldConfiguredName === value) {
                        return;
                    }
                    this.log.info(`Changing configured name of device state sensor ${deviceState} from ${oldConfiguredName} to ${value}.`);
                    this.setDeviceStateConfig(deviceState, value.toString());
                });
            s.getCharacteristic(this.platform.Characteristic.MotionDetected)
                .onGet(async (): Promise<CharacteristicValue> => {
                    if (this.offline) {
                        throw new this.platform.api.hap.HapStatusError(this.platform.api.hap.HAPStatus.SERVICE_COMMUNICATION_FAILURE);
                    }
                    return s.getCharacteristic(this.platform.Characteristic.MotionDetected).value as CharacteristicValue;
                });
            this.service!.addLinkedService(s);
            this.deviceStateServices[deviceState] = s;
        }
    }

    private async handleDeviceStateUpdate(event: NodePyATVDeviceEvent): Promise<void> {
        this.lastDeviceStateChange = Date.now();

        // check if the state has changed
        if (this.lastDeviceState === event.value) {
            return;
        }

        const deviceStateDelay: number = (this.config.deviceStateDelay || 0) * 1000;
        this.log.debug(`New Device State Draft (might be discarded if there are state changes until the configured delay of \
${deviceStateDelay}ms is over): ${event.value}`);
        // wait for the delay to expire
        await delay(deviceStateDelay);
        // abort if there was another device state update in the meantime
        if (this.lastDeviceStateChange + deviceStateDelay > Date.now()) {
            this.log.debug(`New Device State Draft discarded (since there was another state change): ${event.value}`);
            return;
        }
        // set all device state sensors to inactive
        for (const deviceState of Object.keys(this.deviceStateServices)) {
            if (deviceState === event.value) {
                continue;
            }
            const s: Service = this.deviceStateServices[deviceState];
            s.updateCharacteristic(this.platform.Characteristic.MotionDetected, false);
        }
        // only make device state changes if Apple TV is on
        if (this.service?.getCharacteristic(this.platform.Characteristic.Active).value === this.platform.Characteristic.Active.INACTIVE) {
            this.log.debug(`New Device State Draft discarded (since Apple TV is off): ${event.value}`);
            this.lastDeviceState = null;
            return;
        }
        this.lastDeviceState = event.value as NodePyATVDeviceState | null;
        this.log.info(`New Device State: ${event.value}`);
        if (event.value !== null && this.deviceStateServices[event.value] !== undefined) {
            const s: Service = this.deviceStateServices[event.value];
            s.updateCharacteristic(this.platform.Characteristic.MotionDetected, true);
        }
        switch (event.value) {
        case NodePyATVDeviceState.playing:
            this.service?.updateCharacteristic(
                this.platform.Characteristic.CurrentMediaState,
                this.platform.Characteristic.CurrentMediaState.PLAY,
            );
            break;
        case NodePyATVDeviceState.paused:
            this.service?.updateCharacteristic(
                this.platform.Characteristic.CurrentMediaState,
                this.platform.Characteristic.CurrentMediaState.PAUSE,
            );
            break;
        case NodePyATVDeviceState.stopped:
            this.service?.updateCharacteristic(
                this.platform.Characteristic.CurrentMediaState,
                this.platform.Characteristic.CurrentMediaState.STOP,
            );
            break;
        case NodePyATVDeviceState.loading:
            this.service?.updateCharacteristic(
                this.platform.Characteristic.CurrentMediaState,
                this.platform.Characteristic.CurrentMediaState.LOADING,
            );
            break;
        case null:
            this.service?.updateCharacteristic(
                this.platform.Characteristic.CurrentMediaState,
                this.platform.Characteristic.CurrentMediaState.INTERRUPTED,
            );
            break;
        default:
            break;
        }
    }

    private createAvadaKedavra(): void {
        const visibilityState: number =
            this.getCommonConfig().showAvadaKedavra === this.platform.Characteristic.CurrentVisibilityState.HIDDEN
                ? this.platform.Characteristic.CurrentVisibilityState.HIDDEN
                : this.platform.Characteristic.CurrentVisibilityState.SHOWN;

        const configuredName: string = this.getCommonConfig().avadaKedavraName || 'Avada Kedavra';
        this.log.debug(`Adding Avada Kedavra as an input. (named: ${configuredName})`);

        this.avadaKedavraService = this.accessory.getService('Avada Kedavra') ||
            this.addServiceSave(this.platform.Service.InputSource, 'Avada Kedavra', 'avadaKedavra')!
                .setCharacteristic(this.platform.Characteristic.ConfiguredName, configuredName)
                .setCharacteristic(this.platform.Characteristic.InputSourceType, this.platform.Characteristic.InputSourceType.OTHER)
                .setCharacteristic(this.platform.Characteristic.IsConfigured, this.platform.Characteristic.IsConfigured.CONFIGURED)
                .setCharacteristic(this.platform.Characteristic.Name, 'Avada Kedavra')
                .setCharacteristic(this.platform.Characteristic.CurrentVisibilityState, visibilityState)
                .setCharacteristic(this.platform.Characteristic.InputDeviceType, this.platform.Characteristic.InputDeviceType.OTHER)
                .setCharacteristic(this.platform.Characteristic.TargetVisibilityState, visibilityState)
                .setCharacteristic(this.platform.Characteristic.Identifier, AVADA_KEDAVRA_IDENTIFIER);

        this.avadaKedavraService.getCharacteristic(this.platform.Characteristic.ConfiguredName)
            .onSet(async (value: CharacteristicValue) => {
                if (value === '') {
                    return;
                }
                const oldValue: Nullable<CharacteristicValue> =
                    this.avadaKedavraService!.getCharacteristic(this.platform.Characteristic.ConfiguredName).value;
                if (oldValue === value) {
                    return;
                }
                this.log.info(`Changing configured name of Avada Kedavra from ${oldValue} to ${value}.`);
                this.setCommonConfig('avadaKedavraName', value.toString());
            })
            .onGet(async (): Promise<Nullable<CharacteristicValue>> => {
                if (this.offline) {
                    throw new this.platform.api.hap.HapStatusError(this.platform.api.hap.HAPStatus.SERVICE_COMMUNICATION_FAILURE);
                }
                return this.avadaKedavraService!.getCharacteristic(this.platform.Characteristic.ConfiguredName).value;
            });

        this.avadaKedavraService.getCharacteristic(this.platform.Characteristic.TargetVisibilityState)
            .onSet(async (value: CharacteristicValue) => {
                const current: Nullable<CharacteristicValue> =
                    this.avadaKedavraService!.getCharacteristic(this.platform.Characteristic.TargetVisibilityState).value;
                this.log.info(`Changing visibility state of Avada Kedavra from ${current} to ${value}.`);
                this.avadaKedavraService!.updateCharacteristic(this.platform.Characteristic.CurrentVisibilityState, value);
                this.setCommonConfig('showAvadaKedavra', value as number);
            });

        this.service?.addLinkedService(this.avadaKedavraService);
    }

    private createHomeInput(): void {
        const visibilityState: number =
            this.getCommonConfig().showHomeInput === this.platform.Characteristic.CurrentVisibilityState.SHOWN
                ? this.platform.Characteristic.CurrentVisibilityState.SHOWN
                : this.platform.Characteristic.CurrentVisibilityState.HIDDEN;

        const configuredName: string = this.getCommonConfig().homeInputName || 'Home';
        this.log.debug(`Adding Home as an input. (named: ${configuredName})`);

        this.homeInputService = this.accessory.getService('HomeInput') ||
            this.addServiceSave(this.platform.Service.InputSource, 'HomeInput', 'homeInput')!
                .setCharacteristic(this.platform.Characteristic.ConfiguredName, configuredName)
                .setCharacteristic(this.platform.Characteristic.InputSourceType, this.platform.Characteristic.InputSourceType.OTHER)
                .setCharacteristic(this.platform.Characteristic.IsConfigured, this.platform.Characteristic.IsConfigured.CONFIGURED)
                .setCharacteristic(this.platform.Characteristic.Name, 'Home')
                .setCharacteristic(this.platform.Characteristic.CurrentVisibilityState, visibilityState)
                .setCharacteristic(this.platform.Characteristic.InputDeviceType, this.platform.Characteristic.InputDeviceType.OTHER)
                .setCharacteristic(this.platform.Characteristic.TargetVisibilityState, visibilityState)
                .setCharacteristic(this.platform.Characteristic.Identifier, HOME_IDENTIFIER);

        this.homeInputService.getCharacteristic(this.platform.Characteristic.ConfiguredName)
            .onSet(async (value: CharacteristicValue) => {
                if (value === '') {
                    return;
                }
                const oldValue: Nullable<CharacteristicValue> =
                    this.homeInputService!.getCharacteristic(this.platform.Characteristic.ConfiguredName).value;
                if (oldValue === value) {
                    return;
                }
                this.log.info(`Changing configured name of Home Input from ${oldValue} to ${value}.`);
                this.setCommonConfig('homeInputName', value.toString());
            })
            .onGet(async (): Promise<Nullable<CharacteristicValue>> => {
                if (this.offline) {
                    throw new this.platform.api.hap.HapStatusError(this.platform.api.hap.HAPStatus.SERVICE_COMMUNICATION_FAILURE);
                }
                return this.homeInputService!.getCharacteristic(this.platform.Characteristic.ConfiguredName).value;
            });

        this.homeInputService.getCharacteristic(this.platform.Characteristic.TargetVisibilityState)
            .onSet(async (value: CharacteristicValue) => {
                const current: Nullable<CharacteristicValue> =
                    this.homeInputService!.getCharacteristic(this.platform.Characteristic.TargetVisibilityState).value;
                this.log.info(`Changing visibility state of Home Input from ${current} to ${value}.`);
                this.homeInputService!.updateCharacteristic(this.platform.Characteristic.CurrentVisibilityState, value);
                this.setCommonConfig('showHomeInput', value as number);
            });

        this.service?.addLinkedService(this.homeInputService);
    }

    private createInputs(apps: NodePyATVApp[], customURIs: string[]): void {
        const appsAndCustomInputs: (ICustomInput | NodePyATVApp)[] = [...customURIs.map((uri) => {
            return { id: uri, name: uri };
        }), ...apps];

        const appConfigs: IAppConfigs = this.getAppConfigs();

        appsAndCustomInputs.forEach((app: ICustomInput | NodePyATVApp) => {
            if (!Object.keys(appConfigs).includes(app.id)) {
                appConfigs[app.id] = {
                    configuredName: DEFAULT_APP_RENAME[app.id] || trimSpecialCharacters(trimToMaxLength(app.name, 64)),
                    isConfigured: this.platform.Characteristic.IsConfigured.CONFIGURED,
                    visibilityState: HIDE_BY_DEFAULT_APPS.includes(app.id)
                        ? this.platform.Characteristic.CurrentVisibilityState.HIDDEN
                        : this.platform.Characteristic.CurrentVisibilityState.SHOWN,
                    identifier: this.appIdToNumber(app.id),
                };
            }
        });
        this.setAppConfigs(appConfigs);

        appsAndCustomInputs.sort((a, b) => {
            if (customURIs.includes(a.id) === customURIs.includes(b.id)) {
                return appConfigs[a.id].configuredName > appConfigs[b.id].configuredName ? 1 : -1;
            } else {
                return customURIs.includes(a.id) ? 1 : -1;
            }
        });

        let addedApps: number = 0;
        appsAndCustomInputs.slice().reverse().every((app: ICustomInput | NodePyATVApp) => {
            this.log.debug(`Adding ${app.id} as an input. (named: ${appConfigs[app.id].configuredName})`);
            const s: Service | undefined =
                this.accessory.getService(app.name) || this.addServiceSave(this.platform.Service.InputSource, app.name, app.id);

            if (s === undefined) {
                this.log.warn(`\nThe maximum of ${MAX_SERVICES} services on a single accessory is reached. \
The following services have been added:
- 01 One service for Accessory Information
- 01 The television service (Apple TV) itself
- 01 Television speaker service to control the volume with the iOS remote
- ${Object.keys(this.deviceStateServices).length.toString().padStart(2, '0')} motion sensors for device states
- ${Object.keys(this.mediaTypeServices).length.toString().padStart(2, '0')} motion sensors for media types
- ${Object.keys(this.remoteKeyServices).length.toString().padStart(2, '0')} switches for remote keys
- ${Object.keys(this.remoteKeyServices).length.toString().padStart(2, '0')} switches for remote keys
- 01 Avada Kedavra as an input
- 01 Home as an input
- ${addedApps.toString().padStart(2, '0')} apps as inputs have been added (${apps.length - addedApps} apps could not be added; including \
custom Inputs)
It might be a good idea to uninstall unused apps.`);
                return false;
            }

            s.setCharacteristic(this.platform.Characteristic.ConfiguredName, appConfigs[app.id].configuredName)
                .setCharacteristic(this.platform.Characteristic.InputSourceType, this.platform.Characteristic.InputSourceType.APPLICATION)
                .setCharacteristic(this.platform.Characteristic.IsConfigured, appConfigs[app.id].isConfigured)
                .setCharacteristic(this.platform.Characteristic.Name, trimSpecialCharacters(trimToMaxLength(app.name, 64)))
                .setCharacteristic(this.platform.Characteristic.CurrentVisibilityState, appConfigs[app.id].visibilityState)
                .setCharacteristic(this.platform.Characteristic.InputDeviceType, this.platform.Characteristic.InputDeviceType.OTHER)
                .setCharacteristic(this.platform.Characteristic.TargetVisibilityState, appConfigs[app.id].visibilityState)
                .setCharacteristic(this.platform.Characteristic.Identifier, appConfigs[app.id].identifier);
            s.getCharacteristic(this.platform.Characteristic.ConfiguredName)
                .onSet(async (value: CharacteristicValue) => {
                    if (value === '') {
                        return;
                    }
                    if (appConfigs[app.id].configuredName === value) {
                        return;
                    }
                    this.log.info(`Changing configured name of ${app.id} from ${appConfigs[app.id].configuredName} to ${value}.`);
                    s.updateCharacteristic(this.platform.Characteristic.ConfiguredName, value.toString());
                    appConfigs[app.id].configuredName = value.toString();
                    this.setAppConfigs(appConfigs);
                })
                .onGet(async (): Promise<Nullable<CharacteristicValue>> => {
                    if (this.offline) {
                        throw new this.platform.api.hap.HapStatusError(this.platform.api.hap.HAPStatus.SERVICE_COMMUNICATION_FAILURE);
                    }
                    return appConfigs[app.id].configuredName;
                });
            s.getCharacteristic(this.platform.Characteristic.IsConfigured)
                .onSet(async (value: CharacteristicValue) => {
                    this.log.info(`Changing is configured of ${appConfigs[app.id].configuredName} (${app.id}) \
from ${appConfigs[app.id].isConfigured} to ${value}.`);
                    appConfigs[app.id].isConfigured = value as 0 | 1;
                    this.setAppConfigs(appConfigs);
                });
            s.getCharacteristic(this.platform.Characteristic.TargetVisibilityState)
                .onSet(async (value: CharacteristicValue) => {
                    this.log.info(`Changing visibility state of ${appConfigs[app.id].configuredName} (${app.id}) \
from ${appConfigs[app.id].visibilityState} to ${value}.`);
                    appConfigs[app.id].visibilityState = value as 0 | 1;
                    s.updateCharacteristic(this.platform.Characteristic.CurrentVisibilityState, value);
                    this.setAppConfigs(appConfigs);
                });
            this.service!.addLinkedService(s);
            this.inputs[app.id] = s;

            addedApps++;

            return true;
        });

        const appOrderIdentifiers: number[] =
            appsAndCustomInputs.slice(appsAndCustomInputs.length - addedApps).map((e) => appConfigs[e.id].identifier);
        const appOrderIdentifiersWithAvadaKedavra: number[] = [AVADA_KEDAVRA_IDENTIFIER, HOME_IDENTIFIER].concat(appOrderIdentifiers);
        const tlv8: string = this.appIdentifiersOrderToTLV8(appOrderIdentifiersWithAvadaKedavra);
        this.log.debug(`Input display order: ${tlv8}`);
        this.service!.setCharacteristic(this.platform.Characteristic.DisplayOrder, tlv8);
    }

    private async handleInputUpdate(event: NodePyATVDeviceEvent): Promise<void> {
        if (event.value === null || event.value === '') {
            return;
        }
        if (event.value === event.oldValue) {
            return;
        }
        const appId: NodePyATVEventValueType = event.value;
        this.log.info(`Current App: ${appId}`);
        const appConfig: IAppConfig = this.getAppConfigs()[appId];
        if (appConfig) {
            const appIdentifier: number = appConfig.identifier;
            this.setCommonConfig('activeIdentifier', appIdentifier);
            this.service!.updateCharacteristic(this.platform.Characteristic.ActiveIdentifier, appIdentifier);
        } else {
            this.log.warn(`Could not update the input to ${appId} since the app is unknown.`);
        }
    }

    private getAppConfigs(): IAppConfigs {
        if (this.appConfigs === undefined) {
            const jsonPath: string = this.getPath('apps.json');
            this.appConfigs = JSON.parse(fs.readFileSync(jsonPath, 'utf8')) as IAppConfigs;
        }
        return this.appConfigs;
    }

    private setAppConfigs(value: IAppConfigs): void {
        this.appConfigs = value;
        const jsonPath: string = this.getPath('apps.json');
        fs.writeFileSync(jsonPath, JSON.stringify(value, null, 4), { encoding:'utf8', flag:'w' });
    }

    private getCommonConfig(): ICommonConfig {
        if (this.commonConfig === undefined) {
            const jsonPath: string = this.getPath('common.json');
            this.commonConfig = JSON.parse(fs.readFileSync(jsonPath, 'utf8')) as IAppConfigs;
        }
        return this.commonConfig;
    }

    private setCommonConfig(key: string, value: PrimitiveTypes): void {
        if (this.commonConfig === undefined) {
            this.commonConfig = {};
        }
        this.commonConfig[key] = value;
        const jsonPath: string = this.getPath('common.json');
        fs.writeFileSync(jsonPath, JSON.stringify(this.commonConfig, null, 4), { encoding:'utf8', flag:'w' });
    }

    private getMediaConfigs(): TMediaConfigs {
        if (this.mediaConfigs === undefined) {
            const jsonPath: string = this.getPath('mediaTypes.json');
            this.mediaConfigs = JSON.parse(fs.readFileSync(jsonPath, 'utf8')) as TMediaConfigs;
        }
        return this.mediaConfigs;
    }

    private setMediaTypeConfig(key: NodePyATVMediaType, value: string): void {
        if (this.mediaConfigs === undefined) {
            this.mediaConfigs = {};
        }
        this.mediaConfigs[key] = value;
        const jsonPath: string = this.getPath('mediaTypes.json');
        fs.writeFileSync(jsonPath, JSON.stringify(this.mediaConfigs, null, 4), { encoding:'utf8', flag:'w' });
    }

    private getDeviceStateConfigs(): TDeviceStateConfigs {
        if (this.deviceStateConfigs === undefined) {
            const jsonPath: string = this.getPath('deviceStates.json');
            this.deviceStateConfigs = JSON.parse(fs.readFileSync(jsonPath, 'utf8')) as TDeviceStateConfigs;
        }
        return this.deviceStateConfigs;
    }

    private setDeviceStateConfig(key: NodePyATVDeviceState, value: string): void {
        if (this.deviceStateConfigs === undefined) {
            this.deviceStateConfigs = {};
        }
        this.deviceStateConfigs[key] = value;
        const jsonPath: string = this.getPath('deviceStates.json');
        fs.writeFileSync(jsonPath, JSON.stringify(this.deviceStateConfigs, null, 4), { encoding:'utf8', flag:'w' });
    }

    private getRemoteKeyAsSwitchConfigs(): TRemoteKeysAsSwitchConfigs {
        if (this.remoteKeyAsSwitchConfigs === undefined) {
            const jsonPath: string = this.getPath('remoteKeySwitches.json');
            this.remoteKeyAsSwitchConfigs = JSON.parse(fs.readFileSync(jsonPath, 'utf8')) as TRemoteKeysAsSwitchConfigs;
        }
        return this.remoteKeyAsSwitchConfigs;
    }

    private setRemoteKeyAsSwitchConfig(key: RocketRemoteKey, value: string): void {
        if (this.remoteKeyAsSwitchConfigs === undefined) {
            this.remoteKeyAsSwitchConfigs = {};
        }
        this.remoteKeyAsSwitchConfigs[key] = value;
        const jsonPath: string = this.getPath('remoteKeySwitches.json');
        fs.writeFileSync(jsonPath, JSON.stringify(this.remoteKeyAsSwitchConfigs, null, 4), { encoding:'utf8', flag:'w' });
    }

    private async handleActiveGet(): Promise<Nullable<CharacteristicValue>> {
        if (this.offline) {
            throw new this.platform.api.hap.HapStatusError(this.platform.api.hap.HAPStatus.SERVICE_COMMUNICATION_FAILURE);
        }
        return this.service!.getCharacteristic(this.platform.Characteristic.Active).value as Nullable<CharacteristicValue>;
    }

    private async handleActiveSet(state: CharacteristicValue): Promise<void> {
        const WAIT_MAX_FOR_STATES: number = 30; // seconds
        const STEPS: number = 500; // milliseconds

        if (state === this.platform.Characteristic.Active.ACTIVE) {
            this.rocketRemote?.turnOn();
            for (let i: number = STEPS; i <= WAIT_MAX_FOR_STATES * 1000; i += STEPS) {
                const { mediaType, deviceState } = await this.device.getState();
                if (deviceState === null || mediaType === null) {
                    await delay(STEPS);
                    this.log.debug(`Waiting until mediaType and deviceState is reported: ${i}ms`);
                    continue;
                }
                if (
                    this.mediaTypeServices[mediaType] &&
                    this.deviceStateServices[deviceState]
                ) {
                    this.log.info(`New Media Type State: ${mediaType}`);
                    this.mediaTypeServices[mediaType]!.updateCharacteristic(this.platform.Characteristic.MotionDetected, true);
                    this.log.info(`New Device State: ${deviceState}`);
                    this.deviceStateServices[deviceState]!.updateCharacteristic(this.platform.Characteristic.MotionDetected, true);
                    break;
                }
            }
        } else if (state === this.platform.Characteristic.Active.INACTIVE) {
            this.rocketRemote?.turnOff();
        }
    }

    private handleActiveUpdate(event: NodePyATVDeviceEvent): void {
        if (event.value === null) {
            return;
        }
        if (event.value === event.oldValue) {
            return;
        }
        const value: 0 | 1 =
            event.value === 'on' ? this.platform.Characteristic.Active.ACTIVE : this.platform.Characteristic.Active.INACTIVE;
        if (value === this.platform.Characteristic.Active.INACTIVE && this.lastTurningOnEvent + 7500 > Date.now()) {
            return;
        }
        this.lastTurningOnEvent = Date.now();
        this.log.info(`New Active State: ${event.value}`);
        this.service!.updateCharacteristic(this.platform.Characteristic.Active, value);
    }

    private async handleActiveIdentifierGet(): Promise<Nullable<CharacteristicValue>> {
        if (this.offline) {
            throw new this.platform.api.hap.HapStatusError(this.platform.api.hap.HAPStatus.SERVICE_COMMUNICATION_FAILURE);
        }
        return this.service!.getCharacteristic(this.platform.Characteristic.ActiveIdentifier).value as Nullable<CharacteristicValue>;
    }

    private async handleActiveIdentifierSet(state: CharacteristicValue): Promise<void> {
        if (state === HOME_IDENTIFIER) {
            this.rocketRemote?.home();
            return;
        }

        if (state === AVADA_KEDAVRA_IDENTIFIER) {
            this.setCommonConfig('activeIdentifier', state as number);
            this.rocketRemote?.avadaKedavra();
            return;
        }

        const appConfigs: IAppConfigs = this.getAppConfigs();
        let appId: string | undefined = undefined;
        for (const key in appConfigs) {
            if (appConfigs[key].identifier === state) {
                appId = key;
            }
        }
        if (appId !== undefined) {
            this.setCommonConfig('activeIdentifier', state as number);
            this.rocketRemote?.openApp(appId);
        }
    }

    private async handleConfiguredNameGet(): Promise<Nullable<CharacteristicValue>> {
        return this.service!.getCharacteristic(this.platform.Characteristic.ConfiguredName).value as Nullable<CharacteristicValue>;
    }

    private async handleConfiguredNameSet(value: CharacteristicValue): Promise<void> {
        if (value === '') {
            return;
        }
        const oldConfiguredName: Nullable<CharacteristicValue> =
            this.service!.getCharacteristic(this.platform.Characteristic.ConfiguredName).value;
        if (oldConfiguredName === value) {
            return;
        }
        this.log.info(`Changed Configured Name from ${oldConfiguredName} to ${value}`);
        this.setCommonConfig('configuredName', value.toString());
        this.log.setPrefix(`${value} (${this.device.mac})`);
    }

    private async handleSleepDiscoveryModeGet(): Promise<Nullable<CharacteristicValue>> {
        return this.service!.getCharacteristic(this.platform.Characteristic.SleepDiscoveryMode).value as Nullable<CharacteristicValue>;
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
        default:
            break;
        }
    }

    private appIdToNumber(appId: string): number {
        const hash: Uint8Array = new Uint8Array(md5(appId, { asBytes: true }));
        const view: DataView = new DataView(hash.buffer);
        return view.getUint32(0);
    }

    private getPath(file: string, defaultContent = '{}'): string {
        const dir: string = path.join(this.platform.api.user.storagePath(), 'appletv-enhanced', this.device.mac!.replaceAll(':', ''));
        if (!fs.existsSync(dir)){
            fs.mkdirSync(dir);
        }
        const filePath: string = path.join(dir, file);
        try {
            fs.writeFileSync(filePath, defaultContent, { encoding:'utf8', flag: 'wx' });
        } catch (err) { /* empty */ }
        return filePath;
    }

    private getCredentials(): string | undefined {
        if (this.credentials === undefined) {
            const path: string = this.getPath('credentials.txt', '');
            const fileContent: string = fs.readFileSync(path, 'utf8').trim();
            this.credentials = fileContent === '' ? undefined : fileContent;
            this.log.debug(`Loaded credentials: ${this.credentials}`);
        }
        return this.credentials;
    }

    private setCredentials(value: string): void {
        this.credentials = value;
        const path: string = this.getPath('credentials.txt', '');
        fs.writeFileSync(path, value, { encoding:'utf8', flag:'w' });
    }

    private async pair(ip: string, appleTVName: string): Promise<string> {
        this.log.debug('Got empty credentials, initiating pairing process.');

        const ipSplitted: string[] = ip.split('.');
        const ipEnd: string = ipSplitted[ipSplitted.length - 1];
        const httpPort: number = 42000 + parseInt(ipEnd);

        const htmlInput: string = fs.readFileSync(path.join(__dirname, 'html', 'input.html'), 'utf8');
        const htmlAfterPost: string = fs.readFileSync(path.join(__dirname, 'html', 'afterPost.html'), 'utf8');

        let goOn: boolean = false;
        let success: boolean = false;

        const localIP: string = getLocalIP();
        let credentials: string = '';

        while (!success) {
            let backOffSeconds: number = 0;
            let processClosed: boolean = false;

            const process: ChildProcessWithoutNullStreams = spawn(CustomPyAtvInstance.getAtvremotePath(), [
                '--scan-hosts', ip,
                '--protocol', 'companion',
                '--remote-name', 'Homebridge Apple TV Enhanced',
                '--storage', 'none',
                'pair',
            ]);
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
                if (data.toUpperCase().includes('ERROR') && !data.includes('Error=Authentication, SeqNo=M4')) {
                    this.log.error('stdout: ' + data);
                    return;
                }
                if (data.includes('You may now use these credentials: ')) {
                    const split: string[] = data.split(': ');
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
                    let reqBody: string = '';
                    req.on('data', (chunk) => {
                        reqBody += chunk;
                    });
                    req.on('end', () => {
                        const [a, b, c, d]: string[] = reqBody.split('&').map((e) => e.charAt(2));
                        const pin: string = `${a}${b}${c}${d}`;
                        this.log.info(`Got PIN ${pin} for Apple TV ${appleTVName}.`);
                        process.stdin.write(`${pin}\n`);
                        res.end(htmlAfterPost);
                    });
                }
            };
            const server: http.Server = http.createServer(requestListener);
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

    private async credentialsValid(): Promise<boolean> {
        if (this.getCredentials() === undefined) {
            return false;
        }

        for (let i: number = 0; i < 5; i++) {
            this.log.info('verifying credentials ...');
            try {
                await this.device.listApps();
                return true;
            } catch (error: unknown) {
                if (error instanceof Error && error.message.includes('pyatv.exceptions.ProtocolError: Command _systemInfo failed')) {
                    this.log.debug(error.message);
                    this.log.debug(error.stack as string);
                    continue;
                }

                if (
                    error instanceof Error &&
                    error.message.includes('asyncio.exceptions.CancelledError') &&
                    error.message.includes('raise asyncio.TimeoutError')
                ) {
                    this.log.debug(error.message);
                    this.log.debug(error.stack as string);
                    while (true) {
                        this.log.warn('The plugin is receiving errors that look like you have not set the access level of Speakers & TVs \
in your home app to "Everybody" or "Anybody On the Same Network". Fix this and restart the plugin to continue initializing the Apple TV \
device. Enable debug logging to see the original errors.');
                        await delay(300000);
                    }
                }

                if (
                    error instanceof Error &&
                    error.message.includes('Could not find any Apple TV on current network')
                ) {
                    while (true) {
                        this.log.warn('Apple TV can be reached on OSI Layer 2 but not on 3. This is likely a network problem. Restart \
the plugin after you have fixed the root cause.');
                        await delay(300000);
                    }
                }

                if (error instanceof Error) {
                    this.log.error(error.message);
                    this.log.error(error.stack as string);
                    process.exit(1);
                }

                throw error;
            }
        }
        return false;
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
        if (this.accessory.services.length + 1 === MAX_SERVICES) {
            return undefined;
        }
        this.log.debug(`Total services ${this.accessory.services.length + 1} (${MAX_SERVICES - this.accessory.services.length - 1} \
remaining)`);
        return this.accessory.addService(serviceConstructor, ...constructorArgs);
    }

    private applyConfigOverrides(config: AppleTVEnhancedPlatformConfig, mac: string): AppleTVEnhancedPlatformConfig {
        if (config.deviceSpecificOverrides === undefined) {
            return config;
        }

        const override: DeviceConfigOverride | undefined =
            config.deviceSpecificOverrides.find((e) => e.mac?.toUpperCase() === mac.toUpperCase());

        if (override === undefined) {
            return config;
        }

        if (override.overrideMediaTypes === true) {
            config.mediaTypes = override.mediaTypes;
        }
        if (override.overrideDeviceStates === true) {
            config.deviceStates = override.deviceStates;
        }
        if (override.overrideDeviceStateDelay === true) {
            config.deviceStateDelay = override.deviceStateDelay;
        }
        if (override.overrideRemoteKeysAsSwitch === true) {
            config.remoteKeysAsSwitch = override.remoteKeysAsSwitch;
        }
        if (override.overrideAvadaKedavraAppAmount === true) {
            config.avadaKedavraAppAmount = override.avadaKedavraAppAmount;
        }
        if (override.overrideCustomInputURIs === true) {
            config.customInputURIs = override.customInputURIs;
        }
        if (override.overrideDisableVolumeControlRemote === true) {
            config.disableVolumeControlRemote = override.disableVolumeControlRemote;
        }

        return config;
    }
}
