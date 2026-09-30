import assert from 'node:assert/strict';
import { afterEach, before, beforeEach, describe, it, mock } from 'node:test';
import type { API, Logger, PlatformAccessory } from 'homebridge';
import type { AppleTVEnhancedPlatformConfig } from './interfaces';
import { FakeRocketRemote, fakePyAtvGateway, resetFakePyAtvDevice } from './testing/fakePyAtv';
import type { FakePyAtvDevice } from './testing/fakePyAtv';
import {
    createRecordingApi,
    createTempStorage,
    createTestAccessory,
    noopLogger,
    removeTempStorage,
    writeCredentials,
} from './testing/fakePlatform';
import type { RecordingApi } from './testing/fakePlatform';

const MAC: string = 'AA:BB:CC:DD:EE:FF';

interface PlatformUnderTest {
    configureAccessory: (accessory: PlatformAccessory) => void;
    discoverDevices: () => Promise<void>;
}

type PlatformConstructor =
    new (log: Logger, config: AppleTVEnhancedPlatformConfig, api: API) => PlatformUnderTest;

interface PlatformModule {
    // eslint-disable-next-line @typescript-eslint/naming-convention
    AppleTVEnhancedPlatform: PlatformConstructor;
}

let platformConstructor: PlatformConstructor;
let storagePath: string;

async function settle(ms: number): Promise<void> {
    await new Promise<void>((resolve): void => {
        setTimeout(resolve, ms);
    });
}

async function waitFor(check: () => boolean, timeoutMs: number): Promise<void> {
    const deadline: number = Date.now() + timeoutMs;
    while (!check() && Date.now() < deadline) {
        await settle(25);
    }
}

function televisionConfig(): AppleTVEnhancedPlatformConfig {
    return {
        disableCharacteristics: true,
        disableInputs: true,
        disableVolumeControlRemote: true,
        discover: { multicast: true, unicast: ['10.0.0.1'] },
        name: 'Apple TV Enhanced',
        platform: 'AppleTVEnhanced',
    };
}

describe('AppleTVEnhancedPlatform discovery', (): void => {
    before(async (): Promise<void> => {
        mock.module('./CustomPyAtvInstance', { defaultExport: fakePyAtvGateway });
        mock.module('./RocketRemote', { defaultExport: FakeRocketRemote });
        const loaded: PlatformModule = (await import('./appleTVEnhancedPlatform')) as unknown as PlatformModule;
        platformConstructor = loaded.AppleTVEnhancedPlatform;
    });

    beforeEach((): void => {
        storagePath = createTempStorage();
        writeCredentials(storagePath, MAC);
        const device: FakePyAtvDevice = resetFakePyAtvDevice(MAC);
        // `discoverDevices` filters on the pyatv model identifier.
        Object.defineProperty(device, 'model', { value: 'Gen4K' });
    });

    afterEach((): void => {
        removeTempStorage(storagePath);
    });

    it('does not process the same device twice when multicast and unicast both report it', async (): Promise<void> => {
        const recorded: RecordingApi = createRecordingApi(storagePath);
        // fakePyAtvGateway.customFind returns the same device for both the multicast
        // and the unicast call, so scanResults contains the device twice.
        const platform: PlatformUnderTest =
            new platformConstructor(noopLogger(), televisionConfig(), recorded.api);

        await platform.discoverDevices();

        // Wait for the asynchronous publish/registration to settle, then make sure
        // the device is only ever published once.
        await waitFor((): boolean => recorded.published.length + recorded.registered.length > 0, 5000);
        await settle(750);
        assert.equal(
            recorded.published.length,
            1,
            `expected exactly one publishExternalAccessories call, got ${recorded.published.length}`,
        );
        assert.equal(recorded.published[0].length, 1);

        // The duplicate is also processed synchronously: platformAccessory is
        // constructed for every planned device.
        assert.equal(
            recorded.accessoryConstructions.length,
            1,
            `expected the device to be planned once, but it was planned ${recorded.accessoryConstructions.length} times`,
        );
    });

    it('unregisters a cached accessory when its device is blacklisted', async (): Promise<void> => {
        const recorded: RecordingApi = createRecordingApi(storagePath);
        const config: AppleTVEnhancedPlatformConfig = {
            ...televisionConfig(),
            discover: { blacklist: [MAC], multicast: true, unicast: ['10.0.0.1'] },
        };
        const platform: PlatformUnderTest = new platformConstructor(noopLogger(), config, recorded.api);
        const cached: PlatformAccessory = createTestAccessory('Apple TV Test', MAC) as unknown as PlatformAccessory;
        platform.configureAccessory(cached);

        await platform.discoverDevices();

        assert.equal(recorded.unregistered.length, 1, 'expected the blacklisted device accessory to be unregistered');
        assert.equal(recorded.unregistered[0].length, 1);
        assert.equal(recorded.unregistered[0][0], cached);
        assert.equal(recorded.published.length, 0);
        assert.equal(recorded.registered.length, 0);
    });
});
