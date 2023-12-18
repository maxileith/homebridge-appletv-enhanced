import type { PlatformConfig, Service } from 'homebridge';
import type { RocketRemoteKey } from './enums';
import type { NodePyATVDeviceState, NodePyATVMediaType } from '@sebbo2002/node-pyatv';
import type { LogLevel } from './LogLevelLogger';

export interface NodePyATVApp {
    id: string;
    name: string;
    launch: () => Promise<void>;
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

export interface AppleTVEnhancedPlatformConfig extends Pick<PlatformConfig, '_bridge' | 'name' | 'platform'> {
    mediaTypes?: NodePyATVMediaType[];
    deviceStates?: NodePyATVDeviceState[];
    deviceStateDelay?: number;
    remoteKeysAsSwitch?: RocketRemoteKey[];
    avadaKedavraAppAmount?: number;
    customInputURIs?: string[];
    disableVolumeControlRemote?: boolean;
    discover?: {
        multicast?: boolean;
        unicast?: string[];
        blacklist?: string[];
    };
    forceVenvRecreate?: boolean;
    logLevel?: LogLevel;
}

export interface AlternatePyATVDeviceOptions {
    id: string;
    airplayCredentials?: string;
    companionCredentials?: string;
}

export interface ICustomInput {
    id: string;
    name: string;
}
