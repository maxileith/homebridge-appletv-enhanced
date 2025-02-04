import type { PlatformConfig, Service } from 'homebridge';
import type { RocketRemoteKey } from './enums';
import type { NodePyATVDeviceState, NodePyATVMediaType } from '@sebbo2002/node-pyatv';
import type { LogLevel } from './LogLevelLogger';
import type { TAutoUpdate, TUpdateCheckTime, TUpdateCheckLevel } from './types';

export interface NodePyATVApp {
    id: string;
    name: string;
}

export type IInputs = Record<string, Service>;

export interface AppConfig {
    configuredName: string;
    identifier: number;
    isConfigured: 0 | 1;
    visibilityState: 0 | 1;
}

export type AppConfigs = Record<string, AppConfig>;

export interface CommonConfig {
    activeIdentifier?: number;
    avadaKedavraName?: string;
    configuredName?: string;
    homeInputName?: string;
    showAvadaKedavra?: number;
    showHomeInput?: number;
    volumeFanName?: string;
}

export interface DeviceConfigOverride {
    absoluteVolumeControl?: boolean;
    avadaKedavraAppAmount?: number;
    customInputURIs?: string[];
    customPyatvCommands?: CustomPyATVCommandConfig[];
    deviceStateDelay?: number;
    deviceStates?: NodePyATVDeviceState[];
    disableVolumeControlRemote?: boolean;
    mac?: string;
    mediaTypes?: NodePyATVMediaType[];
    overrideAbsoluteVolumeControl?: boolean;
    overrideAvadaKedavraAppAmount?: boolean;
    overrideCustomInputURIs?: boolean;
    overrideCustomPyatvCommands?: boolean;
    overrideDeviceStateDelay?: boolean;
    overrideDeviceStates?: boolean;
    overrideDisableVolumeControlRemote?: boolean;
    overrideMediaTypes?: boolean;
    overrideRemoteKeysAsSwitch?: boolean;
    overrideSetTopBox?: boolean;
    remoteKeysAsSwitch?: RocketRemoteKey[];
    setTopBox?: boolean;
}

export interface AppleTVEnhancedPlatformConfig extends Pick<PlatformConfig, '_bridge' | 'name' | 'platform'> {
    absoluteVolumeControl?: boolean;
    autoUpdate?: TAutoUpdate;
    avadaKedavraAppAmount?: number;
    customInputURIs?: string[];
    customPyatvCommands?: CustomPyATVCommandConfig[];
    deviceSpecificOverrides?: DeviceConfigOverride[];
    deviceStateDelay?: number;
    deviceStates?: NodePyATVDeviceState[];
    disableVolumeControlRemote?: boolean;
    discover?: {
        blacklist?: string[];
        multicast?: boolean;
        unicast?: string[];
    };
    forceVenvRecreate?: boolean;
    logLevel?: LogLevel;
    mediaTypes?: NodePyATVMediaType[];
    pythonExecutable?: string;
    remoteKeysAsSwitch?: RocketRemoteKey[];
    setTopBox?: boolean;
    updateCheckLevel?: TUpdateCheckLevel;
    updateCheckTime?: TUpdateCheckTime;
}

export interface AlternatePyATVDeviceOptions {
    airplayCredentials?: string;
    companionCredentials?: string;
    mac: string;
}

export interface CustomPyATVCommandConfig {
    command: string;
    name: string;
}

export interface OutputDevice {
    identifier: string;
    name: string;
}
