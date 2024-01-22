import type { PlatformConfig, Service } from 'homebridge';
import type { RocketRemoteKey } from './enums';
import type { NodePyATVDeviceState, NodePyATVMediaType } from '@sebbo2002/node-pyatv';
import type { LogLevel } from './LogLevelLogger';

export interface NodePyATVApp {
    id: string;
    name: string;
}

export type IInputs = Record<string, Service>;

export interface IAppConfig {
    configuredName: string;
    isConfigured: 0 | 1;
    visibilityState: 0 | 1;
    identifier: number;
}

export type IAppConfigs = Record<string, IAppConfig>;

export interface ICommonConfig {
    configuredName?: string;
    activeIdentifier?: number;
    showAvadaKedavra?: number;
    avadaKedavraName?: string;
    showHomeInput?: number;
    homeInputName?: string;
}

export interface DeviceConfigOverride {
    mac?: string;
    overrideMediaTypes?: boolean;
    mediaTypes?: NodePyATVMediaType[];
    overrideDeviceStates?: boolean;
    deviceStates?: NodePyATVDeviceState[];
    overrideDeviceStateDelay?: boolean;
    deviceStateDelay?: number;
    overrideRemoteKeysAsSwitch?: boolean;
    remoteKeysAsSwitch?: RocketRemoteKey[];
    overrideAvadaKedavraAppAmount?: boolean;
    avadaKedavraAppAmount?: number;
    overrideCustomInputURIs?: boolean;
    customInputURIs?: string[];
    overrideDisableVolumeControlRemote?: boolean;
    disableVolumeControlRemote?: boolean;
    overrideSetTopBox?: boolean;
    setTopBox?: boolean;
}

export interface AppleTVEnhancedPlatformConfig extends Pick<PlatformConfig, '_bridge' | 'name' | 'platform'> {
    mediaTypes?: NodePyATVMediaType[];
    deviceStates?: NodePyATVDeviceState[];
    deviceStateDelay?: number;
    remoteKeysAsSwitch?: RocketRemoteKey[];
    avadaKedavraAppAmount?: number;
    customInputURIs?: string[];
    disableVolumeControlRemote?: boolean;
    setTopBox?: boolean;
    deviceSpecificOverrides?: DeviceConfigOverride[];
    discover?: {
        multicast?: boolean;
        unicast?: string[];
        blacklist?: string[];
    };
    forceVenvRecreate?: boolean;
    logLevel?: LogLevel;
}

export interface AlternatePyATVDeviceOptions {
    mac: string;
    airplayCredentials?: string;
    companionCredentials?: string;
}
