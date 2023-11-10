import { PlatformConfig, Service } from 'homebridge';
import { TNodePyATVDeviceState, TNodePyATVMediaType } from './types';
import { RemoteControlCommands } from './enums';

export interface NodePyATVApp {
    id: string;
    name: string;
    launch: () => Promise<void>;
}

export interface IInputs {
    [k: string]: Service;
}

export interface IAppConfig {
    configuredName: string;
    isConfigured: 0 | 1;
    visibilityState: 0 | 1;
    identifier: number;
}

export interface IAppConfigs {
    [k: string]: IAppConfig;
}

export interface ICommonConfig {
    configuredName?: string;
    activeIdentifier?: number;
    showAvadaKedavra?: number;
}

export interface IMediaConfigs {
    [k: string]: string;
}

export interface IStateConfigs {
    [k: string]: string;
}

export interface IRemoteKeysAsSwitchConfigs {
    [k: string]: string;
}

export interface AppleTVEnhancedPlatformConfig extends PlatformConfig {
    mediaTypes?: TNodePyATVMediaType[];
    deviceStates?: TNodePyATVDeviceState[];
    remoteKeysAsSwitch?: RemoteControlCommands[];
    avadaKedavraAppAmount?: number;
    discover?: {
        multicast?: boolean;
        unicast?: string[];
        blacklist?: string[];
    };
}

export interface AlternatePyATVDeviceOptions {
    id: string;
    airplayCredentials?: string;
    companionCredentials?: string;
}
