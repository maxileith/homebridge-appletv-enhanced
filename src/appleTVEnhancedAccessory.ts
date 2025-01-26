import fs from 'fs';
import http, { type IncomingMessage, type ServerResponse } from 'http';
import type { Characteristic } from 'homebridge';
import {
    type Service,
    type PlatformAccessory,
    type CharacteristicValue,
    type Nullable,
    type PrimitiveTypes,
    type ConstructorArgs,
    Formats,
} from 'homebridge';
import type { AppleTVEnhancedPlatform } from './appleTVEnhancedPlatform';
import {
    NodePyATVDeviceState,
    NodePyATVMediaType,
    NodePyATVPowerState,
    NodePyATVRepeatState,
    NodePyATVShuffleState,
} from '@sebbo2002/node-pyatv';
import type { NodePyATVDevice, NodePyATVDeviceEvent, NodePyATVEventValueType } from '@sebbo2002/node-pyatv';
import md5 from 'md5';
import { type ChildProcessWithoutNullStreams, spawn } from 'child_process';
import path from 'path';
import CustomPyAtvInstance from './CustomPyAtvInstance';
import {
    capitalizeFirstLetter,
    delay,
    removeSpecialCharacters,
    getLocalIP,
    snakeCaseToTitleCase,
    trimToMaxLength,
} from './utils';
import type {
    AppleTVEnhancedPlatformConfig,
    CustomPyATVCommandConfig,
    DeviceConfigOverride,
    IAppConfig,
    IAppConfigs,
    ICommonConfig,
    IInputs,
    NodePyATVApp,
} from './interfaces';
import PrefixLogger from './PrefixLogger';
import { DisplayOrderTypes, PyATVCustomCharacteristicID, RocketRemoteKey } from './enums';
import type { TDeviceStateConfigs, TMediaConfigs, TRemoteKeysAsSwitchConfigs } from './types';
import RocketRemote from './RocketRemote';
import tvOS18InputBugSolver from './tvOS18InputBugSolver';
import { newPyatvCharacteristic, newStringCharacteristic } from './Characteristics';

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
    // eslint-disable-next-line @typescript-eslint/naming-convention
    'com.apple.TVWatchList': 'Apple TV',
    // eslint-disable-next-line @typescript-eslint/naming-convention
    'com.apple.TVMusic': 'Apple Music',
};

const AIR_PLAY_URI: string = 'com.apple.TVAirPlay';

const MAX_SERVICES: number = 100;

const HOME_IDENTIFIER: number = 69;
const AVADA_KEDAVRA_IDENTIFIER: number = 42;
const AIR_PLAY_IDENTIFIER: number = 7567;

/**
 * Platform Accessory
 * An instance of this class is created for each accessory your platform registers
 * Each accessory may expose multiple services of different service types.
 */
export class AppleTVEnhancedAccessory {
    private airPlayInputService: Service | undefined = undefined;
    private appConfigs: IAppConfigs | undefined = undefined;
    private avadaKedavraService: Service | undefined = undefined;
    private booted: boolean = false;
    private commonConfig: ICommonConfig | undefined = undefined;
    private config: AppleTVEnhancedPlatformConfig;
    private credentials: string | undefined = undefined;
    private readonly customPyatvCommandServices: Record<string, Service> = {};
    private device: NodePyATVDevice;
    private deviceStateConfigs: TDeviceStateConfigs | undefined = undefined;
    private readonly deviceStateServices: Partial<Record<NodePyATVDeviceState, Service>> = {};
    private homeInputService: Service | undefined = undefined;
    private readonly inputs: IInputs = {};
    private lastDeviceState: NodePyATVDeviceState | null = null;
    private lastDeviceStateChange: number = 0;
    private lastDeviceStateDraft: NodePyATVDeviceState | null = null;
    private lastNonZeroVolume: number = 50;
    private lastTurningOnEvent: number = 0;
    private readonly log: PrefixLogger;
    private mediaConfigs: TMediaConfigs | undefined = undefined;
    private readonly mediaTypeServices: Partial<Record<NodePyATVMediaType, Service>> = {};
    private offline: boolean = false;
    private readonly pyatvCharacteristics: Partial<Record<PyATVCustomCharacteristicID, Characteristic>> = {};
    private readonly pyatvListenerHandlers: Partial<Record<PyATVCustomCharacteristicID, (e: Error | NodePyATVDeviceEvent) => void>> = {};
    private remoteKeyAsSwitchConfigs: TRemoteKeysAsSwitchConfigs | undefined = undefined;
    private readonly remoteKeyServices: Partial<Record<RocketRemoteKey, Service>> = {};
    private rocketRemote: RocketRemote | undefined = undefined;
    private service: Service | undefined = undefined;
    private televisionSpeakerService: Service | undefined = undefined;
    private volumeFanService: Service | undefined = undefined;

    public constructor(
        private readonly platform: AppleTVEnhancedPlatform,
        private readonly accessory: PlatformAccessory,
    ) {
        this.config = this.applyConfigOverrides(this.platform.config, this.accessory.context.mac);

        this.device = CustomPyAtvInstance.deviceAdvanced({ mac: this.accessory.context.mac as string })!;

        this.log = new PrefixLogger(this.platform.logLevelLogger, `${this.device.name} (${this.device.mac})`);

        this.log.debug(`Accessory Config: ${JSON.stringify(this.config)}`);

        tvOS18InputBugSolver(this.log, this.platform.api.user.storagePath(), this.device.mac!);

        const credentials: string | undefined = this.getCredentials();
        this.device = CustomPyAtvInstance.deviceAdvanced({
            mac: this.accessory.context.mac as string,
            airplayCredentials: credentials,
            companionCredentials: credentials,
        })!;

        const pairingRequired = async (): Promise<void> => {
            return this.pair(this.device.host, this.device.mac!, this.device.name).then((c) => {
                this.setCredentials(c);
                this.device = CustomPyAtvInstance.deviceAdvanced({
                    mac: this.device.mac!,
                    airplayCredentials: c,
                    companionCredentials: c,
                })!;
                this.log.success('Paring was successful. Add it to your home in the Home app: com.apple.home://launch');
            });
        };

        const validationLoop = (): void => {
            //FIXME: catch errors / remove void
            void this.credentialsValid().then((valid: boolean): void => {
                if (valid) {
                    this.log.success('Credentials are still valid. Continuing ...');
                    void this.startUp();
                } else {
                    this.log.warn('Credentials are no longer valid. Need to repair ...');
                    //FIXME: catch errors / remove void
                    void pairingRequired().then(validationLoop.bind(this));
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

    private addServiceSave<S extends typeof Service>(serviceConstructor: S, ...constructorArgs: ConstructorArgs<S>): Service | undefined {
        if (this.accessory.services.length + 1 === MAX_SERVICES) {
            return undefined;
        }
        this.log.debug(`Total services ${this.accessory.services.length + 1} (${MAX_SERVICES - this.accessory.services.length - 1} \
remaining)`);
        return this.accessory.addService(serviceConstructor, ...constructorArgs);
    }

    private airPlayInputUpdateName(event: NodePyATVDeviceEvent): void {
        if (event.value === null || event.value === '') {
            return;
        }
        const configuredName: string = event.value !== undefined && event.value !== 'AirPlay'
            ? trimToMaxLength(removeSpecialCharacters(`AirPlay ${event.value}`), 64)
            : 'AirPlay';
        this.log.debug(`AirPlay: Set dynamic input name to ${configuredName}.`);
        this.airPlayInputService!.updateCharacteristic(this.platform.characteristic.ConfiguredName, configuredName);
    }

    private appIdToNumber(appId: string): number {
        const hash: Uint8Array = new Uint8Array(md5(appId, { asBytes: true }));
        const view: DataView = new DataView(hash.buffer);
        return view.getUint32(0);
    }

    // https://github.com/homebridge/HAP-NodeJS/issues/644#issue-409099368
    private appIdentifiersOrderToTLV8(listOfIdentifiers: number[]): string {
        let identifiersTLV: Buffer = Buffer.alloc(0);
        listOfIdentifiers.forEach((identifier: number, index: number) => {
            if (index !== 0) {
                identifiersTLV = Buffer.concat([
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

    private applyConfigOverrides(config: AppleTVEnhancedPlatformConfig, mac: string): AppleTVEnhancedPlatformConfig {
        if (config.deviceSpecificOverrides === undefined) {
            return config;
        }

        const override: DeviceConfigOverride | undefined =
            config.deviceSpecificOverrides.find((e) => e.mac?.toUpperCase() === mac.toUpperCase());

        if (override === undefined) {
            return config;
        }

        config = structuredClone(config);

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
        if (override.overrideCustomPyatvCommands === true) {
            config.customPyatvCommands = override.customPyatvCommands;
        }
        if (override.overrideDisableVolumeControlRemote === true) {
            config.disableVolumeControlRemote = override.disableVolumeControlRemote;
        }
        if (override.overrideAbsoluteVolumeControl === true) {
            config.absoluteVolumeControl = override.absoluteVolumeControl;
        }
        if (override.overrideSetTopBox === true) {
            config.setTopBox = override.setTopBox;
        }

        return config;
    }

    private createAirPlayInput(): void {
        this.log.debug(`Adding ${AIR_PLAY_URI} as an input. (named: AirPlay)`);
        this.airPlayInputService =
            this.accessory.getService('AirPlay') || this.addServiceSave(this.platform.service.InputSource, 'AirPlay', AIR_PLAY_URI)!
                .setCharacteristic(this.platform.characteristic.ConfiguredName, 'AirPlay')
                .setCharacteristic(this.platform.characteristic.InputSourceType, this.platform.characteristic.InputSourceType.AIRPLAY)
                .setCharacteristic(this.platform.characteristic.IsConfigured, this.platform.characteristic.IsConfigured.NOT_CONFIGURED)
                .setCharacteristic(this.platform.characteristic.Name, 'AirPlay')
                .setCharacteristic(
                    this.platform.characteristic.CurrentVisibilityState,
                    this.platform.characteristic.CurrentVisibilityState.HIDDEN,
                )
                .setCharacteristic(this.platform.characteristic.InputDeviceType, this.platform.characteristic.InputDeviceType.OTHER)
                .setCharacteristic(
                    this.platform.characteristic.TargetVisibilityState,
                    this.platform.characteristic.TargetVisibilityState.HIDDEN,
                )
                .setCharacteristic(this.platform.characteristic.Identifier, AIR_PLAY_IDENTIFIER);

        this.service!.addLinkedService(this.airPlayInputService!);
    }

    private createAvadaKedavra(): void {
        const visibilityState: number =
            this.getCommonConfig().showAvadaKedavra === this.platform.characteristic.CurrentVisibilityState.HIDDEN
                ? this.platform.characteristic.CurrentVisibilityState.HIDDEN
                : this.platform.characteristic.CurrentVisibilityState.SHOWN;

        const name: string = 'Avada Kedavra';
        const configuredName: string = this.getCommonConfig().avadaKedavraName ?? name;
        this.log.debug(`Adding Avada Kedavra as an input. (named: ${configuredName})`);

        this.avadaKedavraService = this.accessory.getService(name) ||
            this.addServiceSave(this.platform.service.InputSource, name, 'avadaKedavra')!
                .setCharacteristic(this.platform.characteristic.ConfiguredName, configuredName)
                .setCharacteristic(this.platform.characteristic.InputSourceType, this.platform.characteristic.InputSourceType.OTHER)
                .setCharacteristic(this.platform.characteristic.IsConfigured, this.platform.characteristic.IsConfigured.CONFIGURED)
                .setCharacteristic(this.platform.characteristic.Name, name)
                .setCharacteristic(this.platform.characteristic.CurrentVisibilityState, visibilityState)
                .setCharacteristic(this.platform.characteristic.InputDeviceType, this.platform.characteristic.InputDeviceType.OTHER)
                .setCharacteristic(this.platform.characteristic.TargetVisibilityState, visibilityState)
                .setCharacteristic(this.platform.characteristic.Identifier, AVADA_KEDAVRA_IDENTIFIER);

        this.avadaKedavraService.getCharacteristic(this.platform.characteristic.ConfiguredName)
            .onSet(async (value: CharacteristicValue) => {
                if (value === '') {
                    return;
                }
                value = trimToMaxLength(removeSpecialCharacters(value.toString()), 64);
                const oldValue: Nullable<CharacteristicValue> =
                    this.avadaKedavraService!.getCharacteristic(this.platform.characteristic.ConfiguredName).value;
                if (oldValue === value) {
                    return;
                }
                if (oldValue !== '') {
                    this.log.info(`Changing configured name of Avada Kedavra from ${oldValue} to ${value}.`);
                }
                this.setCommonConfig('avadaKedavraName', value.toString());
            })
            .onGet(async (): Promise<Nullable<CharacteristicValue>> => {
                if (this.offline) {
                    throw new this.platform.api.hap.HapStatusError(this.platform.api.hap.HAPStatus.SERVICE_COMMUNICATION_FAILURE);
                }
                return this.avadaKedavraService!.getCharacteristic(this.platform.characteristic.ConfiguredName).value;
            });

        this.avadaKedavraService.getCharacteristic(this.platform.characteristic.TargetVisibilityState)
            .onSet(async (value: CharacteristicValue) => {
                const current: Nullable<CharacteristicValue> =
                    this.avadaKedavraService!.getCharacteristic(this.platform.characteristic.TargetVisibilityState).value;
                this.log.info(`Changing visibility state of Avada Kedavra from ${current} to ${value}.`);
                this.avadaKedavraService!.updateCharacteristic(this.platform.characteristic.CurrentVisibilityState, value);
                this.setCommonConfig('showAvadaKedavra', value as number);
            });

        this.service!.addLinkedService(this.avadaKedavraService);
    }

    private createCustomPyatvCommandSwitches(commandConfigs: CustomPyATVCommandConfig[]): void {
        for (const commandConfig of commandConfigs) {
            const name: string = trimToMaxLength(removeSpecialCharacters(commandConfig.name), 64);
            this.log.debug(`Adding custom PyATV command ${name} as a switch.`);
            const s: Service = this.accessory.getService(name) ||
                this.addServiceSave(this.platform.service.Switch, name, `custom-pyatv-command-${name.replace(' ', '-')}`)!;
            s.addOptionalCharacteristic(this.platform.characteristic.ConfiguredName);
            s
                .setCharacteristic(this.platform.characteristic.Name, name)
                .setCharacteristic(this.platform.characteristic.ConfiguredName, name)
                .setCharacteristic(this.platform.characteristic.On, false);
            s.getCharacteristic(this.platform.characteristic.On)
                .onSet(async (value: CharacteristicValue): Promise<void> => {
                    if (value === true) {
                        this.rocketRemote?.sendCommand(commandConfig.command, false, true);
                        setTimeout(() => {
                            s.updateCharacteristic(this.platform.characteristic.On, false);
                        }, 700);
                    }
                })
                .onGet(async (): Promise<CharacteristicValue> => {
                    if (this.offline) {
                        throw new this.platform.api.hap.HapStatusError(this.platform.api.hap.HAPStatus.SERVICE_COMMUNICATION_FAILURE);
                    }
                    return false;
                });
            this.service!.addLinkedService(s);
            this.customPyatvCommandServices[name] = s;
        }
    }

    private createDeviceStateSensors(): void {
        const deviceStates: NodePyATVDeviceState[] = Object.keys(NodePyATVDeviceState) as NodePyATVDeviceState[];
        for (const deviceState of deviceStates) {
            if (this.config.deviceStates === undefined || this.config.deviceStates.includes(deviceState) === false) {
                continue;
            }
            const name: string = capitalizeFirstLetter(deviceState);
            const configuredName: string = this.getDeviceStateConfigs()[deviceState] ?? name;
            this.log.debug(`Adding device state ${deviceState} as a motion sensor. (named: ${configuredName})`);
            const s: Service = this.accessory.getService(name) ||
                this.addServiceSave(this.platform.service.MotionSensor, name, deviceState)!;
            s.addOptionalCharacteristic(this.platform.characteristic.ConfiguredName);
            s
                .setCharacteristic(this.platform.characteristic.MotionDetected, false)
                .setCharacteristic(this.platform.characteristic.Name, name)
                .setCharacteristic(this.platform.characteristic.ConfiguredName, configuredName);
            s.getCharacteristic(this.platform.characteristic.ConfiguredName)
                .onSet(async (value: CharacteristicValue) => {
                    if (value === '') {
                        return;
                    }
                    value = trimToMaxLength(removeSpecialCharacters(value.toString()), 64);
                    const oldConfiguredName: Nullable<CharacteristicValue> =
                        s.getCharacteristic(this.platform.characteristic.ConfiguredName).value;
                    if (oldConfiguredName === value) {
                        return;
                    }
                    if (oldConfiguredName !== '') {
                        this.log.info(`Changing configured name of device state sensor ${deviceState} from ${oldConfiguredName} to \
${value}.`);
                    }
                    this.setDeviceStateConfig(deviceState, value.toString());
                });
            s.getCharacteristic(this.platform.characteristic.MotionDetected)
                .onGet(async (): Promise<CharacteristicValue> => {
                    if (this.offline) {
                        throw new this.platform.api.hap.HapStatusError(this.platform.api.hap.HAPStatus.SERVICE_COMMUNICATION_FAILURE);
                    }
                    return s.getCharacteristic(this.platform.characteristic.MotionDetected).value as CharacteristicValue;
                });
            this.service!.addLinkedService(s);
            this.deviceStateServices[deviceState] = s;
        }
    }

    private createHomeInput(): void {
        const visibilityState: number =
            this.getCommonConfig().showHomeInput === this.platform.characteristic.CurrentVisibilityState.SHOWN
                ? this.platform.characteristic.CurrentVisibilityState.SHOWN
                : this.platform.characteristic.CurrentVisibilityState.HIDDEN;

        const configuredName: string = this.getCommonConfig().homeInputName ?? 'Home';
        this.log.debug(`Adding Home as an input. (named: ${configuredName})`);

        this.homeInputService = this.accessory.getService('HomeInput') ||
            this.addServiceSave(this.platform.service.InputSource, 'HomeInput', 'homeInput')!
                .setCharacteristic(this.platform.characteristic.ConfiguredName, configuredName)
                .setCharacteristic(this.platform.characteristic.InputSourceType, this.platform.characteristic.InputSourceType.OTHER)
                .setCharacteristic(this.platform.characteristic.IsConfigured, this.platform.characteristic.IsConfigured.CONFIGURED)
                .setCharacteristic(this.platform.characteristic.Name, 'Home')
                .setCharacteristic(this.platform.characteristic.CurrentVisibilityState, visibilityState)
                .setCharacteristic(this.platform.characteristic.InputDeviceType, this.platform.characteristic.InputDeviceType.OTHER)
                .setCharacteristic(this.platform.characteristic.TargetVisibilityState, visibilityState)
                .setCharacteristic(this.platform.characteristic.Identifier, HOME_IDENTIFIER);

        this.homeInputService.getCharacteristic(this.platform.characteristic.ConfiguredName)
            .onSet(async (value: CharacteristicValue) => {
                if (value === '') {
                    return;
                }
                value = trimToMaxLength(removeSpecialCharacters(value.toString()), 64);
                const oldValue: Nullable<CharacteristicValue> =
                    this.homeInputService!.getCharacteristic(this.platform.characteristic.ConfiguredName).value;
                if (oldValue === value) {
                    return;
                }
                if (oldValue !== '') {
                    this.log.info(`Changing configured name of Home Input from ${oldValue} to ${value}.`);
                }
                this.setCommonConfig('homeInputName', value.toString());
            })
            .onGet(async (): Promise<Nullable<CharacteristicValue>> => {
                if (this.offline) {
                    throw new this.platform.api.hap.HapStatusError(this.platform.api.hap.HAPStatus.SERVICE_COMMUNICATION_FAILURE);
                }
                return this.homeInputService!.getCharacteristic(this.platform.characteristic.ConfiguredName).value;
            });

        this.homeInputService.getCharacteristic(this.platform.characteristic.TargetVisibilityState)
            .onSet(async (value: CharacteristicValue) => {
                const current: Nullable<CharacteristicValue> =
                    this.homeInputService!.getCharacteristic(this.platform.characteristic.TargetVisibilityState).value;
                this.log.info(`Changing visibility state of Home Input from ${current} to ${value}.`);
                this.homeInputService!.updateCharacteristic(this.platform.characteristic.CurrentVisibilityState, value);
                this.setCommonConfig('showHomeInput', value as number);
            });

        this.service!.addLinkedService(this.homeInputService);
    }

    private createInputs(apps: NodePyATVApp[], customURIs: string[]): void {
        const appsAndCustomInputs: NodePyATVApp[] = [
            ...customURIs.map((uri) => {
                return { id: uri, name: uri };
            }), ...apps,
        ];

        const appConfigs: IAppConfigs = this.getAppConfigs();

        appsAndCustomInputs.forEach((app: NodePyATVApp) => {
            if (!Object.keys(appConfigs).includes(app.id)) {
                appConfigs[app.id] = {
                    configuredName: DEFAULT_APP_RENAME[app.id] || trimToMaxLength(removeSpecialCharacters(app.name), 64),
                    isConfigured: this.platform.characteristic.IsConfigured.CONFIGURED,
                    visibilityState: HIDE_BY_DEFAULT_APPS.includes(app.id)
                        ? this.platform.characteristic.CurrentVisibilityState.HIDDEN
                        : this.platform.characteristic.CurrentVisibilityState.SHOWN,
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
        appsAndCustomInputs.slice().reverse().every((app: NodePyATVApp) => {
            this.log.debug(`Adding ${app.id} as an input. (named: ${appConfigs[app.id].configuredName})`);
            const name: string = trimToMaxLength(removeSpecialCharacters(app.name), 64);
            const s: Service | undefined =
                this.accessory.getService(name) || this.addServiceSave(this.platform.service.InputSource, name, app.id);

            if (s === undefined) {
                this.log.warn(`\nThe maximum of ${MAX_SERVICES} services on a single accessory is reached. \
The following services have been added:
- 01 One service for Accessory Information
- 01 The television service (Apple TV) itself
- 01 Television speaker service to control the volume with the iOS remote
- ${this.config.absoluteVolumeControl === true ? '01' : '00'} Fans for volume control
- ${Object.keys(this.deviceStateServices).length.toString().padStart(2, '0')} motion sensors for device states
- ${Object.keys(this.mediaTypeServices).length.toString().padStart(2, '0')} motion sensors for media types
- ${Object.keys(this.remoteKeyServices).length.toString().padStart(2, '0')} switches for remote keys
- 01 Avada Kedavra as an input
- 01 Home as an input
- 01 AirPlay as an dynamic input
- ${(this.config.customPyatvCommands ?? '0').length.toString().padStart(2, '0')} switches for custom PyATV commands
- ${addedApps.toString().padStart(2, '0')} apps as inputs have been added (${apps.length - addedApps} apps could not be added; including \
custom Inputs)
It might be a good idea to uninstall unused apps.`);
                return false;
            }

            s.setCharacteristic(this.platform.characteristic.ConfiguredName, appConfigs[app.id].configuredName)
                .setCharacteristic(this.platform.characteristic.InputSourceType, this.platform.characteristic.InputSourceType.APPLICATION)
                .setCharacteristic(this.platform.characteristic.IsConfigured, appConfigs[app.id].isConfigured)
                .setCharacteristic(this.platform.characteristic.Name, name)
                .setCharacteristic(this.platform.characteristic.CurrentVisibilityState, appConfigs[app.id].visibilityState)
                .setCharacteristic(this.platform.characteristic.InputDeviceType, this.platform.characteristic.InputDeviceType.OTHER)
                .setCharacteristic(this.platform.characteristic.TargetVisibilityState, appConfigs[app.id].visibilityState)
                .setCharacteristic(this.platform.characteristic.Identifier, appConfigs[app.id].identifier);
            s.getCharacteristic(this.platform.characteristic.ConfiguredName)
                .onSet(async (value: CharacteristicValue) => {
                    if (value === '') {
                        return;
                    }
                    value = trimToMaxLength(removeSpecialCharacters(value.toString()), 64);
                    if (appConfigs[app.id].configuredName === value) {
                        return;
                    }
                    this.log.info(`Changing configured name of ${app.id} from ${appConfigs[app.id].configuredName} to ${value}.`);
                    appConfigs[app.id].configuredName = value;
                    this.setAppConfigs(appConfigs);
                })
                .onGet(async (): Promise<Nullable<CharacteristicValue>> => {
                    if (this.offline) {
                        throw new this.platform.api.hap.HapStatusError(this.platform.api.hap.HAPStatus.SERVICE_COMMUNICATION_FAILURE);
                    }
                    return appConfigs[app.id].configuredName;
                });
            s.getCharacteristic(this.platform.characteristic.IsConfigured)
                .onSet(async (value: CharacteristicValue) => {
                    this.log.info(`Changing is configured of ${appConfigs[app.id].configuredName} (${app.id}) \
from ${appConfigs[app.id].isConfigured} to ${value}.`);
                    appConfigs[app.id].isConfigured = value as 0 | 1;
                    this.setAppConfigs(appConfigs);
                });
            s.getCharacteristic(this.platform.characteristic.TargetVisibilityState)
                .onSet(async (value: CharacteristicValue) => {
                    this.log.info(`Changing visibility state of ${appConfigs[app.id].configuredName} (${app.id}) \
from ${appConfigs[app.id].visibilityState} to ${value}.`);
                    appConfigs[app.id].visibilityState = value as 0 | 1;
                    s.updateCharacteristic(this.platform.characteristic.CurrentVisibilityState, value);
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
        this.service!.setCharacteristic(this.platform.characteristic.DisplayOrder, tlv8);
    }

    private createListeners(): void {
        this.log.debug('recreating listeners');

        const filterErrorHandler = (
            event: Error | NodePyATVDeviceEvent,
            listener: (event: NodePyATVDeviceEvent) => Promise<void> | void,
        ): void => {
            if (!(event instanceof Error)) {
                if (this.offline && event.value !== null) {
                    this.log.success('Reestablished the connection');
                    this.offline = false;
                }
                this.log.debug(`event ${event.key}: ${event.value}`);
                void listener(event);
            }
        };

        const powerStateListener = (e: Error | NodePyATVDeviceEvent): void => {
            filterErrorHandler(e, this.handleActiveUpdate.bind(this));
        };
        const appIdListener = (e: Error | NodePyATVDeviceEvent): void => {
            filterErrorHandler(e, this.handleInputUpdate.bind(this));
        };
        const appListener = (e: Error | NodePyATVDeviceEvent): void => {
            filterErrorHandler(e, this.airPlayInputUpdateName.bind(this));
        };
        const deviceStateListener = (e: Error | NodePyATVDeviceEvent): void => {
            filterErrorHandler(e, this.handleDeviceStateUpdate.bind(this));
        };
        const mediaTypeListener = (e: Error | NodePyATVDeviceEvent): void => {
            filterErrorHandler(e, this.handleMediaTypeUpdate.bind(this));
        };
        const volumeListener = (e: Error | NodePyATVDeviceEvent): void => {
            filterErrorHandler(e, this.handleVolumeUpdate.bind(this));
        };

        const pyatvCharacteristicListener = (e: Error | NodePyATVDeviceEvent, characteristicID: PyATVCustomCharacteristicID): void => {
            filterErrorHandler(e, this.handlePyatvCharacteristicUpdate.bind(this, characteristicID));
        };

        this.device.on('update:powerState', powerStateListener);
        this.device.on('update:appId', appIdListener);
        this.device.on('update:app', appListener);
        this.device.on('update:deviceState', deviceStateListener);
        this.device.on('update:mediaType', mediaTypeListener);
        this.device.on('update:volume', volumeListener);

        for (const characteristicID of Object.values(PyATVCustomCharacteristicID)) {
            const handler: (e: Error | NodePyATVDeviceEvent) => void = (e): void => {
                pyatvCharacteristicListener(e, characteristicID);
            };
            this.pyatvListenerHandlers[characteristicID] = handler;
            this.device.on(`update:${characteristicID}`, handler);
        }

        this.device.once('error', ((e: Error | NodePyATVDeviceEvent): void => {
            this.log.debug(e as unknown as string);
            this.offline = true;
            this.log.warn('Lost connection. Trying to reconnect ...');

            this.device.removeListener('update:powerState', powerStateListener);
            this.device.removeListener('update:appId', appIdListener);
            this.device.removeListener('update:app', appListener);
            this.device.removeListener('update:deviceState', deviceStateListener);
            this.device.removeListener('update:mediaType', mediaTypeListener);
            this.device.removeListener('update:volume', volumeListener);

            for (const characteristic in this.pyatvListenerHandlers) {
                this.device.removeListener(`update:${characteristic}`, this.pyatvListenerHandlers[characteristic]);
            }

            const credentials: string | undefined = this.getCredentials();
            this.device = CustomPyAtvInstance.deviceAdvanced({
                mac: this.device.mac!,
                airplayCredentials: credentials,
                companionCredentials: credentials,
            }) || this.device;
            this.log.debug(`New internal device: ${this.device}`);

            setTimeout(this.createListeners.bind(this), 5000);

        }).bind(this));
    }

    private createMediaTypeSensors(): void {
        const mediaTypes: NodePyATVMediaType[] = Object.keys(NodePyATVMediaType) as NodePyATVMediaType[];
        for (const mediaType of mediaTypes) {
            if (this.config.mediaTypes === undefined || this.config.mediaTypes.includes(mediaType) === false) {
                continue;
            }
            const name: string = capitalizeFirstLetter(mediaType);
            const configuredName: string = this.getMediaConfigs()[mediaType] ?? name;
            this.log.debug(`Adding media type ${mediaType} as a motion sensor. (named: ${configuredName})`);
            const s: Service = this.accessory.getService(name) ||
                this.addServiceSave(this.platform.service.MotionSensor, name, mediaType)!;
            s.addOptionalCharacteristic(this.platform.characteristic.ConfiguredName);
            s
                .setCharacteristic(this.platform.characteristic.MotionDetected, false)
                .setCharacteristic(this.platform.characteristic.Name, name)
                .setCharacteristic(this.platform.characteristic.ConfiguredName, configuredName);
            s.getCharacteristic(this.platform.characteristic.ConfiguredName)
                .onSet(async (value: CharacteristicValue) => {
                    if (value === '') {
                        return;
                    }
                    value = trimToMaxLength(removeSpecialCharacters(value.toString()), 64);
                    const oldConfiguredName: Nullable<CharacteristicValue> =
                        s.getCharacteristic(this.platform.characteristic.ConfiguredName).value;
                    if (oldConfiguredName === value) {
                        return;
                    }
                    if (oldConfiguredName !== '') {
                        this.log.info(`Changing configured name of media type sensor ${mediaType} from ${oldConfiguredName} to ${value}.`);
                    }
                    this.setMediaTypeConfig(mediaType, value);
                });
            s.getCharacteristic(this.platform.characteristic.MotionDetected)
                .onGet(async (): Promise<CharacteristicValue> => {
                    if (this.offline) {
                        throw new this.platform.api.hap.HapStatusError(this.platform.api.hap.HAPStatus.SERVICE_COMMUNICATION_FAILURE);
                    }
                    return s.getCharacteristic(this.platform.characteristic.MotionDetected).value as CharacteristicValue;
                });
            this.service!.addLinkedService(s);
            this.mediaTypeServices[mediaType] = s;
        }
    }

    private async createPyATVCharacteristics(): Promise<void> {
        for (const pyatvChar of Object.values(PyATVCustomCharacteristicID)) {
            const characteristic: Characteristic =
                this.service!.addCharacteristic(newPyatvCharacteristic(this.platform.api.hap, pyatvChar));
            this.pyatvCharacteristics[pyatvChar] = characteristic;

            this.log.debug(`Adding custom characteristic ${characteristic.displayName}.`);

            switch (pyatvChar) {
                case PyATVCustomCharacteristicID.ALBUM:
                    characteristic.setValue(await this.device.getAlbum() ?? '');
                    break;
                case PyATVCustomCharacteristicID.ARTIST:
                    characteristic.setValue(await this.device.getArtist() ?? '');
                    break;
                case PyATVCustomCharacteristicID.CONTENT_IDENTIFIER:
                    characteristic.setValue(await this.device.getContentIdentifier() ?? '');
                    break;
                case PyATVCustomCharacteristicID.EPISODE_NUMBER:
                    characteristic.setValue(await this.device.getEpisodeNumber() ?? 0);
                    break;
                case PyATVCustomCharacteristicID.GENRE:
                    characteristic.setValue(await this.device.getGenre() ?? '');
                    break;
                case PyATVCustomCharacteristicID.POSITION:
                    characteristic.setValue(await this.device.getPosition() ?? 0);
                    break;
                case PyATVCustomCharacteristicID.REPEAT:
                    characteristic.setValue(await this.device.getRepeat() ?? NodePyATVRepeatState.off);
                    break;
                case PyATVCustomCharacteristicID.SEASON_NUMBER:
                    characteristic.setValue(await this.device.getSeasonNumber() ?? 0);
                    break;
                case PyATVCustomCharacteristicID.SERIES_NAME:
                    characteristic.setValue(await this.device.getSeriesName() ?? '');
                    break;
                case PyATVCustomCharacteristicID.SHUFFLE:
                    characteristic.setValue(await this.device.getShuffle() ?? NodePyATVShuffleState.off);
                    break;
                case PyATVCustomCharacteristicID.TITLE:
                    characteristic.setValue(await this.device.getTitle() ?? '');
                    break;
                case PyATVCustomCharacteristicID.TOTAL_TIME:
                    characteristic.setValue(await this.device.getTotalTime() ?? 0);
                    break;
            }

            if (characteristic.value !== '' && characteristic.value !== null) {
                this.log.info(`Setting characteristic ${characteristic.displayName} to "${characteristic.value}".`);
            } else {
                this.log.debug(`Setting characteristic ${characteristic.displayName} to "${characteristic.value}".`);
            }
        }
    }

    private createRemote(): void {
        this.log.debug('recreating rocket remote');

        this.rocketRemote = new RocketRemote(
            this.device.mac!,
            CustomPyAtvInstance.getAtvremotePath(),
            this.getCredentials()!,
            this.getCredentials()!,
            this.log,
            this.config.avadaKedavraAppAmount ?? 15,
        );

        this.rocketRemote.onHome(((): void => {
            this.service!.updateCharacteristic(this.platform.characteristic.ActiveIdentifier, HOME_IDENTIFIER);
        }).bind(this));

        this.rocketRemote.onClose((async (): Promise<void> => {
            await delay(5000);
            this.createRemote();
        }).bind(this));
    }

    private createRemoteKeysAsSwitches(): void {
        const remoteKeys: RocketRemoteKey[] = Object.values(RocketRemoteKey) as RocketRemoteKey[];
        for (const remoteKey of remoteKeys) {
            if (this.config.remoteKeysAsSwitch === undefined || this.config.remoteKeysAsSwitch.includes(remoteKey) === false) {
                continue;
            }
            const name: string = snakeCaseToTitleCase(remoteKey);
            const configuredName: string = this.getRemoteKeyAsSwitchConfigs()[remoteKey] ?? name;
            this.log.debug(`Adding remote key ${remoteKey} as a switch. (named: ${configuredName})`);
            const s: Service = this.accessory.getService(name) ||
                this.addServiceSave(this.platform.service.Switch, name, remoteKey)!;
            s.addOptionalCharacteristic(this.platform.characteristic.ConfiguredName);
            s
                .setCharacteristic(this.platform.characteristic.Name, name)
                .setCharacteristic(this.platform.characteristic.ConfiguredName, configuredName)
                .setCharacteristic(this.platform.characteristic.On, false);
            s.getCharacteristic(this.platform.characteristic.ConfiguredName)
                .onSet(async (value: CharacteristicValue): Promise<void> => {
                    if (value === '') {
                        return;
                    }
                    value = trimToMaxLength(removeSpecialCharacters(value.toString()), 64);
                    const oldConfiguredName: Nullable<CharacteristicValue> =
                        s.getCharacteristic(this.platform.characteristic.ConfiguredName).value;
                    if (oldConfiguredName === value) {
                        return;
                    }
                    if (oldConfiguredName !== '') {
                        this.log.info(`Changing configured name of remote key switch ${remoteKey} from ${oldConfiguredName} to ${value}.`);
                    }
                    this.setRemoteKeyAsSwitchConfig(remoteKey, value);
                });
            s.getCharacteristic(this.platform.characteristic.On)
                .onSet(async (value: CharacteristicValue): Promise<void> => {
                    if (value === true) {
                        this.rocketRemote?.sendCommand(remoteKey);
                        setTimeout(() => {
                            s.updateCharacteristic(this.platform.characteristic.On, false);
                        }, 200);
                    }
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

    private createTelevisionSpeaker(): void {
        this.log.debug('Adding television speaker.');

        this.televisionSpeakerService = this.accessory.getService('televisionSpeaker') ||
            this.addServiceSave(this.platform.service.TelevisionSpeaker, 'televisionSpeaker', 'televisionSpeaker')!;
        this.televisionSpeakerService.setCharacteristic(this.platform.characteristic.Active, this.platform.characteristic.Active.ACTIVE);
        this.televisionSpeakerService.setCharacteristic(this.platform.characteristic.Mute, false);

        if (this.config.disableVolumeControlRemote !== true) {
            this.televisionSpeakerService.setCharacteristic(
                this.platform.characteristic.VolumeControlType,
                this.platform.characteristic.VolumeControlType.RELATIVE,
            );
            this.televisionSpeakerService.getCharacteristic(this.platform.characteristic.VolumeSelector)
                .onSet(async (value: CharacteristicValue): Promise<void> => {
                    if (value === this.platform.characteristic.VolumeSelector.INCREMENT) {
                        this.rocketRemote?.volumeUp();
                    } else {
                        this.rocketRemote?.volumeDown();
                    }
                });
            this.televisionSpeakerService.getCharacteristic(this.platform.characteristic.Mute)
                .onSet(async (value: CharacteristicValue): Promise<void> => {
                    if (value === true) {
                        this.unmute();
                    } else {
                        this.mute();
                    }
                });
        }

        this.service!.addLinkedService(this.televisionSpeakerService);
    }

    private async createVolumeFan(): Promise<void> {
        if (this.config.absoluteVolumeControl !== true) {
            this.log.debug('Adding no fan for volume control as it has not been configured on this Apple TV.');
            return;
        }

        this.log.debug('Adding fan for volume control.');

        const volTmp: number | null = (await this.device.getState({ maxAge: 600000 })).volume; // TTL 10min
        const vol: number = volTmp !== null ? volTmp : 50;

        const name: string = 'Volume';
        const configuredName: string = this.getCommonConfig().volumeFanName ?? name;

        this.volumeFanService = this.accessory.getService(name) ||
            this.addServiceSave(this.platform.service.Fanv2, name, 'fanVolumeControl')!;

        this.volumeFanService.addOptionalCharacteristic(this.platform.characteristic.ConfiguredName);
        this.volumeFanService.setCharacteristic(this.platform.characteristic.Name, name);
        this.volumeFanService.setCharacteristic(this.platform.characteristic.ConfiguredName, configuredName);
        this.volumeFanService.getCharacteristic(this.platform.characteristic.ConfiguredName)
            .onSet(async (value: CharacteristicValue) => {
                if (value === '') {
                    return;
                }
                value = trimToMaxLength(removeSpecialCharacters(value.toString()), 64);
                const oldValue: Nullable<CharacteristicValue> =
                    this.volumeFanService!.getCharacteristic(this.platform.characteristic.ConfiguredName).value;
                if (oldValue === value) {
                    return;
                }
                this.log.info(`Changing configured name of Volume Fan from ${oldValue} to ${value}.`);
                this.setCommonConfig('volumeFanName', value);
            })
            .onGet(async (): Promise<Nullable<CharacteristicValue>> => {
                if (this.offline) {
                    throw new this.platform.api.hap.HapStatusError(this.platform.api.hap.HAPStatus.SERVICE_COMMUNICATION_FAILURE);
                }
                return this.volumeFanService!.getCharacteristic(this.platform.characteristic.ConfiguredName).value;
            });

        this.volumeFanService.setCharacteristic(
            this.platform.characteristic.Active,
            vol !== 0 ? this.platform.characteristic.Active.ACTIVE : this.platform.characteristic.Active.INACTIVE,
        );
        this.volumeFanService.getCharacteristic(this.platform.characteristic.Active)
            .onSet(async (value: CharacteristicValue): Promise<void> => {
                if (value === this.platform.characteristic.Active.ACTIVE) {
                    this.unmute();
                } else {
                    this.mute();
                }
            });

        this.volumeFanService.setCharacteristic(this.platform.characteristic.RotationSpeed, vol);
        this.volumeFanService.getCharacteristic(this.platform.characteristic.RotationSpeed)
            .onSet(async (value: CharacteristicValue): Promise<void> => {
                this.log.info(`Setting volume to ${value}%`);
                this.rocketRemote?.setVolume(value as number, true);
            });

        this.service!.addLinkedService(this.volumeFanService);
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
                    error.message.includes('TimeoutError')
                ) {
                    this.log.debug(error.message);
                    this.log.debug(error.stack as string);
                    while (true) {
                        this.log.error('The plugin is receiving errors that look like you have not set the access level of Speakers & TVs \
in your home app to "Everybody" or "Anybody On the Same Network" with no password. Fix this and restart the plugin to continue \
initializing the Apple TV device. Additionally, make sure to check the TV\'s HomeKit settings. Enable debug logging to see the original \
errors.');
                        await delay(300000);
                    }
                }

                if (
                    error instanceof Error &&
                    error.message.includes('Could not find any Apple TV on current network')
                ) {
                    this.log.debug(error.message);
                    this.log.debug(error.stack as string);
                    while (true) {
                        this.log.error('Apple TV could not be reached on your network. This is likely a network problem. Restart the \
plugin after you have fixed the root cause. Enable debug logging to see the original errors.');
                        await delay(300000);
                    }
                }

                if (error instanceof Error) {
                    this.log.error(error.message);
                    this.log.debug(error.stack as string);
                    while (true) {
                        await delay(300000);
                    }
                }

                throw error;
            }
        }
        return false;
    }

    private getAppConfigs(): IAppConfigs {
        if (this.appConfigs === undefined) {
            const jsonPath: string = this.getPath('apps.json');
            this.log.debug(`Loading app config from ${jsonPath}`);
            try {
                this.appConfigs = JSON.parse(fs.readFileSync(jsonPath, 'utf8')) as IAppConfigs;
            } catch (err: unknown) {
                if (err instanceof Error && err.name === 'SyntaxError') {
                    this.log.warn(`The file ${jsonPath} does not contain a valid JSON. Resetting to its defaults ...`);
                    this.setAppConfigs({});
                    return {};
                } else {
                    throw err;
                }
            }
        }
        return this.appConfigs;
    }

    private getCommonConfig(): ICommonConfig {
        if (this.commonConfig === undefined) {
            const jsonPath: string = this.getPath('common.json');
            this.log.debug(`Loading common config from ${jsonPath}`);
            try {
                this.commonConfig = JSON.parse(fs.readFileSync(jsonPath, 'utf8')) as ICommonConfig;
            } catch (err: unknown) {
                if (err instanceof Error && err.name === 'SyntaxError') {
                    this.log.warn(`The file ${jsonPath} does not contain a valid JSON. Resetting to its defaults ...`);
                    this.commonConfig = {};
                } else {
                    throw err;
                }
            }
        }
        return this.commonConfig;
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

    private getDeviceStateConfigs(): TDeviceStateConfigs {
        if (this.deviceStateConfigs === undefined) {
            const jsonPath: string = this.getPath('deviceStates.json');
            this.log.debug(`Loading device states config from ${jsonPath}`);
            try {
                this.deviceStateConfigs = JSON.parse(fs.readFileSync(jsonPath, 'utf8')) as TDeviceStateConfigs;
            } catch (err: unknown) {
                if (err instanceof Error && err.name === 'SyntaxError') {
                    this.log.warn(`The file ${jsonPath} does not contain a valid JSON. Resetting to its defaults ...`);
                    this.deviceStateConfigs = {};
                } else {
                    throw err;
                }
            }
        }
        return this.deviceStateConfigs;
    }

    private getMediaConfigs(): TMediaConfigs {
        if (this.mediaConfigs === undefined) {
            const jsonPath: string = this.getPath('mediaTypes.json');
            this.log.debug(`Loading media types config from ${jsonPath}`);
            try {
                this.mediaConfigs = JSON.parse(fs.readFileSync(jsonPath, 'utf8')) as TMediaConfigs;
            } catch (err: unknown) {
                if (err instanceof Error && err.name === 'SyntaxError') {
                    this.log.warn(`The file ${jsonPath} does not contain a valid JSON. Resetting to its defaults ...`);
                    this.mediaConfigs = {};
                } else {
                    throw err;
                }
            }
        }
        return this.mediaConfigs;
    }

    private getPath(file: string, defaultContent = '{}'): string {
        const dir: string = path.join(this.platform.api.user.storagePath(), 'appletv-enhanced', this.device.mac!.replaceAll(':', ''));
        if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir);
        }
        const filePath: string = path.join(dir, file);
        try {
            this.log.verbose(`Trying to set the file ${filePath} to its default content`);
            fs.writeFileSync(filePath, defaultContent, { encoding: 'utf8', flag: 'wx' });
            this.log.verbose(`File ${filePath} has been set to its default content`);
        } catch (err) {
            if (typeof err === 'object' && err !== null && 'code' in err && err.code === 'EEXIST') {
                this.log.verbose(`File ${filePath} already exists.`);
                return filePath;
            }
            if (typeof err === 'object' && err !== null && 'code' in err && err.code === 'EACCES') {
                this.log.error(`File ${filePath} is not accessible by homebridge due to insufficient permissions.`);
            } else {
                this.log.error(`Error while accessing file ${filePath}: ${err}`);
            }
            // FIXME: stop from running
            // while (true) {
            //     this.log.warn('Please fix the file error above and restart the plugin afterwards');
            //     delaySync(10000);
            // }
        }
        return filePath;
    }

    private getRemoteKeyAsSwitchConfigs(): TRemoteKeysAsSwitchConfigs {
        if (this.remoteKeyAsSwitchConfigs === undefined) {
            const jsonPath: string = this.getPath('remoteKeySwitches.json');
            this.log.debug(`Loading remote key as switches config from ${jsonPath}`);
            try {
                this.remoteKeyAsSwitchConfigs = JSON.parse(fs.readFileSync(jsonPath, 'utf8')) as TRemoteKeysAsSwitchConfigs;
            } catch (err: unknown) {
                if (err instanceof Error && err.name === 'SyntaxError') {
                    this.log.warn(`The file ${jsonPath} does not contain a valid JSON. Resetting to its defaults ...`);
                    this.remoteKeyAsSwitchConfigs = {};
                } else {
                    throw err;
                }
            }
        }
        return this.remoteKeyAsSwitchConfigs;
    }

    private async handleActiveGet(): Promise<Nullable<CharacteristicValue>> {
        if (this.offline) {
            throw new this.platform.api.hap.HapStatusError(this.platform.api.hap.HAPStatus.SERVICE_COMMUNICATION_FAILURE);
        }
        return this.service!.getCharacteristic(this.platform.characteristic.Active).value as Nullable<CharacteristicValue>;
    }

    private async handleActiveIdentifierGet(): Promise<Nullable<CharacteristicValue>> {
        if (this.offline) {
            throw new this.platform.api.hap.HapStatusError(this.platform.api.hap.HAPStatus.SERVICE_COMMUNICATION_FAILURE);
        }
        return this.service!.getCharacteristic(this.platform.characteristic.ActiveIdentifier).value as Nullable<CharacteristicValue>;
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

    private async handleActiveSet(state: CharacteristicValue): Promise<void> {
        const WAIT_MAX_FOR_STATES: number = 30; // seconds
        const STEPS: number = 500; // milliseconds

        if (state === this.platform.characteristic.Active.ACTIVE) {
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
                    this.mediaTypeServices[mediaType]!.updateCharacteristic(this.platform.characteristic.MotionDetected, true);
                    this.log.info(`New Device State: ${deviceState}`);
                    this.deviceStateServices[deviceState]!.updateCharacteristic(this.platform.characteristic.MotionDetected, true);
                    break;
                }
            }
        } else if (state === this.platform.characteristic.Active.INACTIVE) {
            this.rocketRemote?.turnOff();
        }
    }

    private handleActiveUpdate(event: NodePyATVDeviceEvent): void {
        if (event.value === null) {
            return;
        }
        const value: 0 | 1 =
            event.value === 'on' ? this.platform.characteristic.Active.ACTIVE : this.platform.characteristic.Active.INACTIVE;
        if (value === this.platform.characteristic.Active.INACTIVE && this.lastTurningOnEvent + 7500 > Date.now()) {
            return;
        }
        this.log.info(`New Active State: ${event.value}`);
        if (value === this.platform.characteristic.Active.ACTIVE) {
            this.lastTurningOnEvent = Date.now();
        } else {
            this.log.debug('Reset all motion sensors.');
            // set all device state sensors to inactive
            for (const deviceState of Object.keys(this.deviceStateServices)) {
                const s: Service = this.deviceStateServices[deviceState];
                s.updateCharacteristic(this.platform.characteristic.MotionDetected, false);
            }
            // set all media type sensors to inactive
            for (const mediaType of Object.keys(this.mediaTypeServices)) {
                const s: Service = this.mediaTypeServices[mediaType];
                s.updateCharacteristic(this.platform.characteristic.MotionDetected, false);
            }
        }
        this.service!.updateCharacteristic(this.platform.characteristic.Active, value);
    }

    private async handleConfiguredNameGet(): Promise<Nullable<CharacteristicValue>> {
        return this.service!.getCharacteristic(this.platform.characteristic.ConfiguredName).value as Nullable<CharacteristicValue>;
    }

    private async handleConfiguredNameSet(value: CharacteristicValue): Promise<void> {
        if (value === '') {
            return;
        }
        const oldConfiguredName: Nullable<CharacteristicValue> =
            this.service!.getCharacteristic(this.platform.characteristic.ConfiguredName).value;
        if (oldConfiguredName === value) {
            return;
        }
        this.log.info(`Changed Configured Name from ${oldConfiguredName} to ${value}`);
        this.setCommonConfig('configuredName', value.toString());
        this.log.setPrefix(`${value} (${this.device.mac})`);
    }

    private async handleDeviceStateUpdate(event: NodePyATVDeviceEvent): Promise<void> {
        this.lastDeviceStateChange = Date.now();
        this.lastDeviceStateDraft = event.value as NodePyATVDeviceState | null;

        // check if the state has changed
        if (this.lastDeviceState === event.value) {
            return;
        }

        // only make device state changes if Apple TV is on
        if (this.service!.getCharacteristic(this.platform.characteristic.Active).value === this.platform.characteristic.Active.INACTIVE) {
            this.log.debug(`New Device State Draft discarded (since Apple TV is off): ${event.value}`);
            this.lastDeviceStateDraft = null;
            this.lastDeviceState = null;
            return;
        }

        const deviceStateDelay: number = (this.config.deviceStateDelay ?? 0) * 1000;
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
            s.updateCharacteristic(this.platform.characteristic.MotionDetected, false);
        }

        this.lastDeviceState = event.value as NodePyATVDeviceState | null;
        this.log.info(`New Device State: ${event.value}`);
        if (event.value !== null && this.deviceStateServices[event.value] !== undefined) {
            const s: Service = this.deviceStateServices[event.value];
            s.updateCharacteristic(this.platform.characteristic.MotionDetected, true);
        }

        switch (event.value) {
            case NodePyATVDeviceState.playing:
                this.service!.updateCharacteristic(
                    this.platform.characteristic.CurrentMediaState,
                    this.platform.characteristic.CurrentMediaState.PLAY,
                );
                break;
            case NodePyATVDeviceState.paused:
                this.service!.updateCharacteristic(
                    this.platform.characteristic.CurrentMediaState,
                    this.platform.characteristic.CurrentMediaState.PAUSE,
                );
                break;
            case NodePyATVDeviceState.stopped:
                this.service!.updateCharacteristic(
                    this.platform.characteristic.CurrentMediaState,
                    this.platform.characteristic.CurrentMediaState.STOP,
                );
                break;
            case NodePyATVDeviceState.loading:
                this.service!.updateCharacteristic(
                    this.platform.characteristic.CurrentMediaState,
                    this.platform.characteristic.CurrentMediaState.LOADING,
                );
                break;
            case null:
                this.service!.updateCharacteristic(
                    this.platform.characteristic.CurrentMediaState,
                    this.platform.characteristic.CurrentMediaState.INTERRUPTED,
                );
                break;
            default:
                break;
        }
    }

    private async handleInputUpdate(event: NodePyATVDeviceEvent): Promise<void> {
        if (event.value === null || event.value === '') {
            this.service!.updateCharacteristic(this.platform.characteristic.ActiveIdentifier, HOME_IDENTIFIER);
            return;
        }
        const appId: NodePyATVEventValueType = event.value;
        this.log.info(`Current App: ${appId}`);

        if (appId === AIR_PLAY_URI) {
            this.service!.updateCharacteristic(this.platform.characteristic.ActiveIdentifier, AIR_PLAY_IDENTIFIER);
        } else {
            const appConfig: IAppConfig = this.getAppConfigs()[appId];
            if (appConfig !== undefined) {
                const appIdentifier: number = appConfig.identifier;
                this.setCommonConfig('activeIdentifier', appIdentifier);
                this.service!.updateCharacteristic(this.platform.characteristic.ActiveIdentifier, appIdentifier);
            } else {
                this.log.warn(`Could not update the input to ${appId} since the app is unknown.`);
            }
        }
    }

    private async handleMediaTypeUpdate(event: NodePyATVDeviceEvent): Promise<void> {
        if (event.oldValue !== null && this.mediaTypeServices[event.oldValue] !== undefined) {
            const s: Service = this.mediaTypeServices[event.oldValue];
            s.updateCharacteristic(this.platform.characteristic.MotionDetected, false);
        }
        if (this.service!.getCharacteristic(this.platform.characteristic.Active).value === this.platform.characteristic.Active.INACTIVE) {
            return;
        }
        this.log.info(`New Media Type State: ${event.value}`);
        if (event.value !== null && this.mediaTypeServices[event.value] !== undefined) {
            const s: Service = this.mediaTypeServices[event.value];
            s.updateCharacteristic(this.platform.characteristic.MotionDetected, true);
        }
    }

    private handlePyatvCharacteristicUpdate(characteristicID: PyATVCustomCharacteristicID, event: NodePyATVDeviceEvent): void {
        const characteristic: Characteristic | undefined = this.pyatvCharacteristics[characteristicID];

        if (characteristic === undefined) {
            this.log.error(`Could not update ${characteristicID} since no corresponding characteristic was found.`);
            return;
        }

        let value: NodePyATVEventValueType = event.newValue;
        switch (characteristic.props.format as Formats) {
            case Formats.STRING:
                if (value === null) {
                    value = '';
                }
                value = trimToMaxLength(value as string, characteristic.props.maxLen ?? 64);
                break;
            case Formats.INT:
            case Formats.FLOAT:
            case Formats.UINT8:
            case Formats.UINT16:
            case Formats.UINT32:
            case Formats.UINT64:
                if (value === null) {
                    value = 0;
                }
                break;
        }

        const unit: string = characteristic.props.unit !== undefined
            ? ` ${characteristic.props.unit}`
            : '';

        this.log.info(`Updating characteristic ${characteristic.displayName} to "${value}${unit}".`);
        characteristic.setValue(value);
    }

    private async handleRemoteKeySet(state: CharacteristicValue): Promise<void> {
        switch (state) {
            case this.platform.characteristic.RemoteKey.REWIND:
                this.rocketRemote?.skipBackward();
                break;
            case this.platform.characteristic.RemoteKey.FAST_FORWARD:
                this.rocketRemote?.skipForward();
                break;
            case this.platform.characteristic.RemoteKey.NEXT_TRACK:
                this.rocketRemote?.next();
                break;
            case this.platform.characteristic.RemoteKey.PREVIOUS_TRACK:
                this.rocketRemote?.previous();
                break;
            case this.platform.characteristic.RemoteKey.ARROW_UP:
                this.rocketRemote?.up();
                break;
            case this.platform.characteristic.RemoteKey.ARROW_DOWN:
                this.rocketRemote?.down();
                break;
            case this.platform.characteristic.RemoteKey.ARROW_LEFT:
                this.rocketRemote?.left();
                break;
            case this.platform.characteristic.RemoteKey.ARROW_RIGHT:
                this.rocketRemote?.right();
                break;
            case this.platform.characteristic.RemoteKey.SELECT:
                this.rocketRemote?.select();
                break;
            case this.platform.characteristic.RemoteKey.BACK:
                this.rocketRemote?.menu();
                break;
            case this.platform.characteristic.RemoteKey.EXIT:
                this.rocketRemote?.home();
                break;
            case this.platform.characteristic.RemoteKey.PLAY_PAUSE:
                this.rocketRemote?.playPause();
                break;
            case this.platform.characteristic.RemoteKey.INFORMATION:
                this.rocketRemote?.topMenu();
                break;
            default:
                break;
        }
    }

    private async handleSleepDiscoveryModeGet(): Promise<Nullable<CharacteristicValue>> {
        return this.service!.getCharacteristic(this.platform.characteristic.SleepDiscoveryMode).value as Nullable<CharacteristicValue>;
    }

    private async handleVolumeUpdate(event: NodePyATVDeviceEvent): Promise<void> {
        if (this.config.absoluteVolumeControl !== true) {
            return;
        }

        if (typeof event.newValue !== 'number') {
            return;
        }

        const numericValue: number = Math.round(event.newValue);
        this.log.info(`Volume has been set to ${numericValue}`);
        this.volumeFanService?.updateCharacteristic(this.platform.characteristic.RotationSpeed, numericValue);
        if (numericValue !== 0) {
            this.lastNonZeroVolume = numericValue;
            if (this.volumeFanService?.getCharacteristic(
                this.platform.characteristic.Active).value === this.platform.characteristic.Active.INACTIVE) {
                this.log.debug('Activating the volume fan since volume !== 0');
                this.volumeFanService?.updateCharacteristic(
                    this.platform.characteristic.Active,
                    this.platform.characteristic.Active.ACTIVE,
                );
            }
        } else {
            if (this.volumeFanService?.getCharacteristic(
                this.platform.characteristic.Active).value === this.platform.characteristic.Active.ACTIVE) {
                this.log.debug('Deactivating the volume fan since volume === 0');
                this.volumeFanService?.updateCharacteristic(
                    this.platform.characteristic.Active,
                    this.platform.characteristic.Active.INACTIVE,
                );
            }
            setTimeout(() => {
                this.log.debug(`Setting the volume fan rotation speed back to ${this.lastNonZeroVolume}% to prevent 100% on unmute.`);
                this.volumeFanService?.updateCharacteristic(
                    this.platform.characteristic.RotationSpeed,
                    this.lastNonZeroVolume,
                );
            }, 500);
        }
    }

    private mute(): void {
        this.log.info('Muting');
        this.rocketRemote?.setVolume(0, true);
    }

    private async pair(ip: string, mac: string, appleTVName: string): Promise<string> {
        this.log.debug('Got empty credentials, initiating pairing process.');

        const ipSplitted: string[] = ip.split('.');
        const ipEnd: string = ipSplitted[ipSplitted.length - 1];
        const httpPort: number = 42000 + parseInt(ipEnd);

        const htmlInputHTML: string = fs.readFileSync(path.join(__dirname, 'html', 'input.html'), 'utf8');
        const htmlAfterPostHTML: string = fs.readFileSync(path.join(__dirname, 'html', 'afterPost.html'), 'utf8');
        const backOffHTML: string = fs.readFileSync(path.join(__dirname, 'html', 'backOff.html'), 'utf8');

        let goOn: boolean = false;
        let success: boolean = false;

        const localIP: string = getLocalIP();
        let credentials: string = '';

        while (!success) {
            let webPageOpened: boolean = false;
            const requestListener = (req: IncomingMessage, res: ServerResponse<IncomingMessage> & { req: IncomingMessage }): void => {
                res.setHeader('Content-Security-Policy', 'default-src * \'self\' data: \'unsafe-inline\' \'unsafe-hashes\' \'unsafe-eval\';\
script-src * \'self\' data: \'unsafe-inline\' \'unsafe-hashes\' \'unsafe-eval\';\
script-src-elem * \'self\' data: \'unsafe-inline\' \'unsafe-hashes\' \'unsafe-eval\';\
script-src-attr * \'self\' data: \'unsafe-inline\' \'unsafe-hashes\' \'unsafe-eval\';\
media-src * \'self\'');
                res.setHeader('Cache-Control', 'max-age=0, no-cache, must-revalidate, proxy-revalidate');
                res.writeHead(200);
                if (req.method === 'GET') {
                    webPageOpened = true;
                    res.end(htmlInputHTML);
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
                        res.end(htmlAfterPostHTML);
                    });
                }
            };
            const server: http.Server = http.createServer(requestListener);
            server.listen(httpPort, '0.0.0.0', () => {
                this.log.warn(`You need to pair your Apple TV before the plugin can connect to it. Open the webpage \
http://${localIP}:${httpPort}/. Then, enter the pairing code that will be displayed on your Apple TV.`);
            });

            // wait until the user opens the pairing page before starting the pairing process
            while (webPageOpened === false) {
                await delay(100);
            }

            let backOffSeconds: number = 0;
            let processClosed: boolean = false;

            const process: ChildProcessWithoutNullStreams = spawn(CustomPyAtvInstance.getAtvremotePath(), [
                '--id', mac,
                '--protocol', 'companion',
                '--remote-name', `Homebridge AppleTV Enhanced (${localIP})`,
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
                if (data.toUpperCase().includes('ERROR')) {
                    goOn = true;
                    let message: string = data;
                    let traceback: string | null = null;
                    if (data.includes('Traceback')) {
                        [message, traceback] = data.split('Traceback', 1);
                    }
                    this.log.error('stdout: ' + message.trim());
                    if (traceback !== null) {
                        this.log.debug(traceback);
                    }
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
                    this.log.warn('Pairing request timed out, starting over ...');
                    this.log.debug('Kill the pyatv pairing process.');
                    process.kill();
                    goOn = true;
                }
            }, 32000);

            this.log.debug('Wait for the atvremote process to terminate');
            while (!goOn || !processClosed) {
                await delay(100);
            }
            server.close();

            if (backOffSeconds !== 0) {
                this.log.warn(`Apple TV ${appleTVName}: Too many attempts. Waiting for ${backOffSeconds} seconds before retrying.`);
                const requestListenerBackOff = (
                    _req: IncomingMessage,
                    res: ServerResponse<IncomingMessage> & { req: IncomingMessage },
                ): void => {
                    res.setHeader('Content-Security-Policy', 'default-src * \'self\' data: \'unsafe-inline\' \'unsafe-hashes\' \
\'unsafe-eval\';script-src * \'self\' data: \'unsafe-inline\' \'unsafe-hashes\' \'unsafe-eval\';\
script-src-elem * \'self\' data: \'unsafe-inline\' \'unsafe-hashes\' \'unsafe-eval\';\
script-src-attr * \'self\' data: \'unsafe-inline\' \'unsafe-hashes\' \'unsafe-eval\';\
media-src * \'self\'');
                    res.setHeader('Cache-Control', 'max-age=0, no-cache, must-revalidate, proxy-revalidate');
                    res.writeHead(200);
                    res.end(backOffHTML.replace('let secondsLeft = 10;', `let secondsLeft = ${backOffSeconds};`));
                };
                const serverBackOff: http.Server = http.createServer(requestListenerBackOff);
                serverBackOff.listen(httpPort, '0.0.0.0');
                for (; backOffSeconds > 0; backOffSeconds--) {
                    this.log.debug(`${backOffSeconds} seconds remaining.`);
                    await delay(1000);
                }
                serverBackOff.close();
            }
        }

        return credentials;
    }

    private setAppConfigs(value: IAppConfigs): void {
        this.appConfigs = value;
        const jsonPath: string = this.getPath('apps.json');
        this.log.debug(`Updating app config at ${jsonPath}`);
        fs.writeFileSync(jsonPath, JSON.stringify(value, null, 4), { encoding: 'utf8', flag: 'w' });
    }

    private setCommonConfig(key: string, value: PrimitiveTypes): void {
        if (this.commonConfig === undefined) {
            this.commonConfig = {};
        }
        this.commonConfig[key] = value;
        const jsonPath: string = this.getPath('common.json');
        this.log.debug(`Updating common config at ${jsonPath}`);
        fs.writeFileSync(jsonPath, JSON.stringify(this.commonConfig, null, 4), { encoding: 'utf8', flag: 'w' });
    }

    private setCredentials(value: string): void {
        this.credentials = value;
        const path: string = this.getPath('credentials.txt', '');
        fs.writeFileSync(path, value, { encoding: 'utf8', flag: 'w' });
    }

    private setDeviceStateConfig(key: NodePyATVDeviceState, value: string): void {
        if (this.deviceStateConfigs === undefined) {
            this.deviceStateConfigs = {};
        }
        this.deviceStateConfigs[key] = value;
        const jsonPath: string = this.getPath('deviceStates.json');
        this.log.debug(`Updating devices states config at ${jsonPath}`);
        fs.writeFileSync(jsonPath, JSON.stringify(this.deviceStateConfigs, null, 4), { encoding: 'utf8', flag: 'w' });
    }

    private setMediaTypeConfig(key: NodePyATVMediaType, value: string): void {
        if (this.mediaConfigs === undefined) {
            this.mediaConfigs = {};
        }
        this.mediaConfigs[key] = value;
        const jsonPath: string = this.getPath('mediaTypes.json');
        this.log.debug(`Updating media types config at ${jsonPath}`);
        fs.writeFileSync(jsonPath, JSON.stringify(this.mediaConfigs, null, 4), { encoding: 'utf8', flag: 'w' });
    }

    private setRemoteKeyAsSwitchConfig(key: RocketRemoteKey, value: string): void {
        if (this.remoteKeyAsSwitchConfigs === undefined) {
            this.remoteKeyAsSwitchConfigs = {};
        }
        this.remoteKeyAsSwitchConfigs[key] = value;
        const jsonPath: string = this.getPath('remoteKeySwitches.json');
        this.log.debug(`Updating remote keys as switches config at ${jsonPath}`);
        fs.writeFileSync(jsonPath, JSON.stringify(this.remoteKeyAsSwitchConfigs, null, 4), { encoding: 'utf8', flag: 'w' });
    }

    private startPositionUpdate(): void {
        setInterval(((): void => {
            const characteristic: Characteristic | undefined = this.pyatvCharacteristics[PyATVCustomCharacteristicID.POSITION];
            if (characteristic === undefined) {
                this.log.debug('Skipping position update since characteristic does not exist yet.');
                return;
            }

            if (this.lastDeviceStateDraft !== NodePyATVDeviceState.playing) {
                this.log.verbose('Skipping position update since not playing.');
                return;
            }

            const value: number = characteristic.value === null
                ? 0
                : characteristic.value as number;
            const newValue: number = value + 1;

            this.log.verbose(`Updating characteristic ${PyATVCustomCharacteristicID.POSITION} to "${newValue} \
${characteristic.props.unit}".`);
            characteristic.setValue(newValue);
        }).bind(this), 1000);
    }

    private async startUp(): Promise<void> {
        this.log.info(`Exposing Apple TV as accessory of type ${this.config.setTopBox === true ? 'set-top box' : 'Apple TV'}.`);

        this.accessory.category = this.config.setTopBox === true
            ? this.platform.api.hap.Categories.TV_SET_TOP_BOX
            : this.platform.api.hap.Categories.APPLE_TV;

        const configuredName: string =
            this.getCommonConfig().configuredName ?? trimToMaxLength(removeSpecialCharacters(this.accessory.displayName), 64);

        // set accessory information
        this.accessory.getService(this.platform.service.AccessoryInformation)!
            .setCharacteristic(this.platform.characteristic.Manufacturer, 'Apple Inc.')
            .setCharacteristic(this.platform.characteristic.Model, this.device.modelName!)
            .setCharacteristic(this.platform.characteristic.SerialNumber, this.device.mac!)
            .setCharacteristic(this.platform.characteristic.Name, removeSpecialCharacters(this.device.name))
            .setCharacteristic(this.platform.characteristic.FirmwareRevision, this.device.version!);

        // create the service
        this.service =
            this.accessory.getService(this.platform.service.Television) || this.addServiceSave(this.platform.service.Television)!;
        this.service.addCharacteristic(this.platform.characteristic.FirmwareRevision);
        this.service
            .setCharacteristic(
                this.platform.characteristic.Active,
                await this.device.getPowerState() === NodePyATVPowerState.on
                    ? this.platform.characteristic.Active.ACTIVE
                    : this.platform.characteristic.Active.INACTIVE,
            )
            .setCharacteristic(
                this.platform.characteristic.ActiveIdentifier,
                this.getCommonConfig().activeIdentifier ?? HOME_IDENTIFIER,
            )
            .setCharacteristic(this.platform.characteristic.ConfiguredName, configuredName)
            .setCharacteristic(
                this.platform.characteristic.SleepDiscoveryMode,
                this.platform.characteristic.SleepDiscoveryMode.ALWAYS_DISCOVERABLE,
            )
            .setCharacteristic(this.platform.characteristic.CurrentMediaState, this.platform.characteristic.CurrentMediaState.INTERRUPTED)
            .setCharacteristic(this.platform.characteristic.FirmwareRevision, this.device.version!);

        // add custom static characteristics
        this.service
            .addCharacteristic(newStringCharacteristic(this.platform.api.hap, 'MAC Address'))
            .setValue(this.device.mac ?? '');
        this.service
            .addCharacteristic(newStringCharacteristic(this.platform.api.hap, 'Model'))
            .setValue(this.device.model ?? '');
        this.service
            .addCharacteristic(newStringCharacteristic(this.platform.api.hap, 'Model Name'))
            .setValue(this.device.modelName ?? '');
        this.service
            .addCharacteristic(newStringCharacteristic(this.platform.api.hap, 'OS'))
            .setValue(this.device.os ?? '');
        this.service
            .addCharacteristic(newStringCharacteristic(this.platform.api.hap, 'Host'))
            .setValue(this.device.host ?? '');

        // create handlers for required characteristics of the service
        this.service.getCharacteristic(this.platform.characteristic.Active)
            .onGet(this.handleActiveGet.bind(this))
            .onSet(this.handleActiveSet.bind(this));
        this.service.getCharacteristic(this.platform.characteristic.ActiveIdentifier)
            .onGet(this.handleActiveIdentifierGet.bind(this))
            .onSet(this.handleActiveIdentifierSet.bind(this));
        this.service.getCharacteristic(this.platform.characteristic.ConfiguredName)
            .onGet(this.handleConfiguredNameGet.bind(this))
            .onSet(this.handleConfiguredNameSet.bind(this));
        this.service.getCharacteristic(this.platform.characteristic.SleepDiscoveryMode)
            .onGet(this.handleSleepDiscoveryModeGet.bind(this));
        this.service.getCharacteristic(this.platform.characteristic.RemoteKey)
            .onSet(this.handleRemoteKeySet.bind(this));

        this.log.setPrefix(`${configuredName} (${this.device.mac})`);

        // create pyatv characteristics
        await this.createPyATVCharacteristics();

        // create television speaker
        this.createTelevisionSpeaker();

        // create input and sensor services
        this.createDeviceStateSensors();
        this.createMediaTypeSensors();
        this.createRemoteKeysAsSwitches();
        await this.createVolumeFan();
        this.createAvadaKedavra();
        this.createHomeInput();
        this.createAirPlayInput();
        this.createCustomPyatvCommandSwitches(this.config.customPyatvCommands || []);
        const apps: NodePyATVApp[] = await this.device.listApps();
        this.createInputs(apps, this.config.customInputURIs || []);

        // create event listeners to keep everything up-to-date
        this.createListeners();

        // create remote
        this.createRemote();

        // start updating the position update
        this.startPositionUpdate();

        this.log.info('Finished initializing');
        this.booted = true;
    }

    private unmute(): void {
        this.log.info(`Unmuting (Setting the volume to the last known state: ${this.lastNonZeroVolume}%)`);
        this.rocketRemote?.setVolume(this.lastNonZeroVolume, true);
    }
}
