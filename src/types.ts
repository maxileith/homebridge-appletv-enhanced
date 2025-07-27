import type { NodePyATVDeviceState, NodePyATVMediaType } from '@sebbo2002/node-pyatv';
import type { RocketRemoteKey } from './enums.ts';

export type TMediaConfigs = Partial<Record<NodePyATVMediaType, string>>;
export type TDeviceStateConfigs = Partial<Record<NodePyATVDeviceState, string>>;
export type TRemoteKeysAsSwitchConfigs = Partial<Record<RocketRemoteKey, string>>;

export type TUpdateCheckLevel = 'beta' | 'stable';
export type TAutoUpdate = 'auto' | 'off' | 'on';
export type TUpdateCheckTime = Mapped<24>[number];

type Mapped<
    N extends number,
    Result extends unknown[] = [],
> =
    Result['length'] extends N
        ? Result
        : Mapped<N, [...Result, Result['length']]>
    ;
