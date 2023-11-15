import type { NodePyATVDeviceState, NodePyATVMediaType } from '@sebbo2002/node-pyatv';
import type { RocketRemoteKey } from './enums.ts';

export type TMediaConfigs = Partial<Record<NodePyATVMediaType, string>>;
export type TDeviceStateConfigs = Partial<Record<NodePyATVDeviceState, string>>;
export type TRemoteKeysAsSwitchConfigs = Partial<Record<RocketRemoteKey, string>>;
