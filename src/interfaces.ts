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

export interface IAppConfig {
    configuredName: string;
    identifier: number;
    isConfigured: 0 | 1;
    visibilityState: 0 | 1;
}

export type IAppConfigs = Record<string, IAppConfig>;

export interface ICommonConfig {
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
    deviceStateDelay?: number;
    deviceStates?: NodePyATVDeviceState[];
    disableVolumeControlRemote?: boolean;
    mac?: string;
    mediaTypes?: NodePyATVMediaType[];
    overrideAbsoluteVolumeControl?: boolean;
    overrideAvadaKedavraAppAmount?: boolean;
    overrideCustomInputURIs?: boolean;
    overrideDeviceStateDelay?: boolean;
    overrideDeviceStates?: boolean;
    overrideDisableVolumeControlRemote?: boolean;
    overrideMediaTypes?: boolean;
    overrideRemoteKeysAsSwitch?: boolean;
    remoteKeysAsSwitch?: RocketRemoteKey[];
}

export interface AppleTVEnhancedPlatformConfig extends Pick<PlatformConfig, '_bridge' | 'name' | 'platform'> {
    absoluteVolumeControl?: boolean;
    autoUpdate?: TAutoUpdate;
    avadaKedavraAppAmount?: number;
    customInputURIs?: string[];
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
    updateCheckLevel?: TUpdateCheckLevel;
    updateCheckTime?: TUpdateCheckTime;
}

export interface AlternatePyATVDeviceOptions {
    airplayCredentials?: string;
    companionCredentials?: string;
    mac: string;
}
