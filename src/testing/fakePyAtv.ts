import { EventEmitter } from 'node:events';
import { NodePyATVDeviceState, NodePyATVMediaType, NodePyATVPowerState } from '@sebbo2002/node-pyatv';
import type { NodePyATVDevice } from '@sebbo2002/node-pyatv';

export interface FakeDeviceState {
    deviceState: NodePyATVDeviceState;
    mediaType: NodePyATVMediaType;
    position: number;
    powerState: NodePyATVPowerState;
    volume: number;
}

/**
 * Minimal stand-in for a `NodePyATVDevice`. It implements only the surface that
 * `AppleTVEnhancedAccessory` uses and is an EventEmitter so tests can emit
 * `update:*` events.
 */
export class FakePyAtvDevice extends EventEmitter {
    public readonly allIDs: string[] = [];
    public readonly host: string = '10.0.0.1';
    public readonly id: string = 'fake-device';
    public readonly mac: string;
    public readonly model: string = 'AppleTV6,2';
    public readonly modelName: string = 'Apple TV 4K';
    public readonly name: string = 'Apple TV Test';
    public readonly os: string = 'TvOS';
    public readonly services: unknown[] = [];
    public readonly version: string = '18.0';

    private state: FakeDeviceState;

    public constructor(mac: string) {
        super();
        this.mac = mac;
        this.state = {
            deviceState: NodePyATVDeviceState.paused,
            mediaType: NodePyATVMediaType.music,
            position: 0,
            powerState: NodePyATVPowerState.on,
            volume: 50,
        };
    }

    public async getAlbum(): Promise<string | null> {
        return null;
    }

    public async getArtist(): Promise<string | null> {
        return null;
    }

    public async getContentIdentifier(): Promise<string | null> {
        return null;
    }

    public async getDeviceState(): Promise<NodePyATVDeviceState> {
        return this.state.deviceState;
    }

    public async getEpisodeNumber(): Promise<number | null> {
        return null;
    }

    public async getGenre(): Promise<string | null> {
        return null;
    }

    public async getITunesStoreIdentifier(): Promise<number | null> {
        return null;
    }

    public async getMediaType(): Promise<NodePyATVMediaType> {
        return this.state.mediaType;
    }

    public async getOutputDevices(): Promise<null> {
        return null;
    }

    public async getPosition(): Promise<number> {
        return this.state.position;
    }

    public async getPowerState(): Promise<NodePyATVPowerState> {
        return this.state.powerState;
    }

    public async getRepeat(): Promise<string | null> {
        return null;
    }

    public async getSeasonNumber(): Promise<number | null> {
        return null;
    }

    public async getSeriesName(): Promise<string | null> {
        return null;
    }

    public async getShuffle(): Promise<string | null> {
        return null;
    }

    public async getState(): Promise<FakeDeviceState> {
        return { ...this.state };
    }

    public async getTitle(): Promise<string | null> {
        return null;
    }

    public async getTotalTime(): Promise<number | null> {
        return null;
    }

    public async listApps(): Promise<Array<{ id: string; name: string }>> {
        return [{ id: 'com.apple.TVMusic', name: 'Music' }];
    }

    public setState(state: Partial<FakeDeviceState>): void {
        this.state = { ...this.state, ...state };
    }
}

/** No-op stand-in for `RocketRemote` so no `atvremote` process is spawned. */
export class FakeRocketRemote {
    public close(): Promise<void> {
        return Promise.resolve();
    }

    public onClose(): void { }

    public onHome(): void { }

    public sendCommand(): void { }

    public setVolume(): void { }
}

let currentDevice: FakePyAtvDevice | undefined = undefined;

export function currentFakePyAtvDevice(): FakePyAtvDevice | undefined {
    return currentDevice;
}

export function resetFakePyAtvDevice(mac: string): FakePyAtvDevice {
    currentDevice = new FakePyAtvDevice(mac);
    return currentDevice;
}

/** Default export used to mock `./CustomPyAtvInstance`. */
export const fakePyAtvGateway: {
    customFind: () => Promise<{ devices: NodePyATVDevice[]; errors: unknown[] }>;
    deviceAdvanced: () => NodePyATVDevice | undefined;
    getAtvremotePath: () => string;
    getAtvscriptPath: () => string;
} = {
    customFind: async (): Promise<{ devices: NodePyATVDevice[]; errors: unknown[] }> => {
        return { devices: currentDevice === undefined ? [] : [currentDevice as unknown as NodePyATVDevice], errors: [] };
    },
    deviceAdvanced: (): NodePyATVDevice | undefined => currentDevice as unknown as NodePyATVDevice,
    getAtvremotePath: (): string => 'atvremote',
    getAtvscriptPath: (): string => 'atvscript',
};
