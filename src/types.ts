import type { NodePyATVDeviceState, NodePyATVMediaType } from '@sebbo2002/node-pyatv';
import type { RocketRemoteKey } from './enums.ts';
import type { Characteristic, HAP } from 'homebridge';

export type TMediaConfigs = Partial<Record<NodePyATVMediaType, string>>;
export type TDeviceStateConfigs = Partial<Record<NodePyATVDeviceState, string>>;
export type TRemoteKeysAsSwitchConfigs = Partial<Record<RocketRemoteKey, string>>;

export type TUpdateCheckLevel = 'beta' | 'stable';
export type TAutoUpdate = 'off' | 'on';
export type TUpdateCheckTime = Mapped<24>[number];

export type TPyatvCharacteristicGenerator = (hap: HAP) => Characteristic;
export type TPyatvCharacteristicID =
    'album' |
    'artist' |
    'episodeNumber' |
    'genre' |
    'repeat' |
    'seasonNumber' |
    'seriesName' |
    'shuffle' |
    'title' |
    'totalTime';

type Mapped<
    N extends number,
    Result extends unknown[] = [],
> =
    (Result['length'] extends N
        ? Result
        : Mapped<N, [...Result, Result['length']]>
    );
