import assert from 'node:assert/strict';
import { afterEach, before, beforeEach, describe, it, mock } from 'node:test';
import * as hap from '@homebridge/hap-nodejs';
import type { PlatformAccessory } from 'homebridge';
import type { AppleTVEnhancedPlatform } from './appleTVEnhancedPlatform';
import type { AppleTVEnhancedPlatformConfig } from './interfaces';
import { FakeRocketRemote, currentFakePyAtvDevice, fakePyAtvGateway, resetFakePyAtvDevice } from './testing/fakePyAtv';
import {
    createFakePlatform,
    createTempStorage,
    createTestAccessory,
    removeTempStorage,
    writeCredentials,
} from './testing/fakePlatform';
import type { FakePlatform } from './testing/fakePlatform';
import type { FakePyAtvDevice } from './testing/fakePyAtv';

const MAC: string = 'AA:BB:CC:DD:EE:FF';

interface AccessoryUnderTest {
    stop: () => Promise<void>;
    untilBooted: () => Promise<void>;
}

interface RunningAccessory {
    stop: () => Promise<void>;
}

type AccessoryConstructor = new (platform: AppleTVEnhancedPlatform, accessory: PlatformAccessory) => AccessoryUnderTest;

interface AccessoryModule {
    // eslint-disable-next-line @typescript-eslint/naming-convention
    AppleTVEnhancedAccessory: AccessoryConstructor;
}

let atvAccessory: AccessoryConstructor;
let running: RunningAccessory[];
let storagePath: string;

function sensorsOnlyConfig(extra: Partial<AppleTVEnhancedPlatformConfig> = {}): AppleTVEnhancedPlatformConfig {
    return { exposeAs: 'sensorsOnly', name: 'Apple TV Enhanced', platform: 'AppleTVEnhanced', ...extra };
}

function televisionConfig(extra: Partial<AppleTVEnhancedPlatformConfig> = {}): AppleTVEnhancedPlatformConfig {
    return {
        disableCharacteristics: true,
        disableInputs: true,
        disableVolumeControlRemote: true,
        name: 'Apple TV Enhanced',
        platform: 'AppleTVEnhanced',
        ...extra,
    };
}

function hasService(accessory: hap.Accessory, serviceUuid: string): boolean {
    return accessory.services.some((service) => service.UUID === serviceUuid);
}

function motionValue(accessory: hap.Accessory, name: string): boolean {
    const service: hap.Service | undefined = accessory.getService(name);
    assert.ok(service, `expected service "${name}" to exist`);
    return service.getCharacteristic(hap.Characteristic.MotionDetected).value as boolean;
}

async function tick(): Promise<void> {
    await new Promise<void>((resolve): void => {
        setTimeout(resolve, 25);
    });
}

async function bootAccessory(config: AppleTVEnhancedPlatformConfig): Promise<{ accessory: hap.Accessory; platform: FakePlatform }> {
    const platform: FakePlatform = createFakePlatform(config, storagePath);
    const accessory: hap.Accessory = createTestAccessory('Apple TV Test', MAC);
    const atv: AccessoryUnderTest = new atvAccessory(platform.platform, accessory as unknown as PlatformAccessory);
    running.push(atv);
    await atv.untilBooted();
    return { accessory, platform };
}

describe('AppleTVEnhancedAccessory integration', (): void => {
    before(async (): Promise<void> => {
        mock.module('./CustomPyAtvInstance', { defaultExport: fakePyAtvGateway });
        mock.module('./RocketRemote', { defaultExport: FakeRocketRemote });
        const loaded: AccessoryModule = (await import('./appleTVEnhancedAccessory')) as unknown as AccessoryModule;
        atvAccessory = loaded.AppleTVEnhancedAccessory;
    });

    beforeEach((): void => {
        storagePath = createTempStorage();
        writeCredentials(storagePath, MAC);
        resetFakePyAtvDevice(MAC);
        running = [];
    });

    afterEach(async (): Promise<void> => {
        for (const accessory of running) {
            await accessory.stop();
        }
        removeTempStorage(storagePath);
    });

    it('exposes sensors and switches but no television service in sensorsOnly mode', async (): Promise<void> => {
        const { accessory } = await bootAccessory(sensorsOnlyConfig({
            deviceStates: ['paused', 'playing'],
            mediaTypes: ['music', 'video'],
            remoteKeysAsSwitch: ['play', 'pause'],
        }));

        assert.equal(hasService(accessory, hap.Service.Television.UUID), false);
        assert.equal(hasService(accessory, hap.Service.InputSource.UUID), false);
        assert.equal(hasService(accessory, hap.Service.TelevisionSpeaker.UUID), false);
        assert.equal(hasService(accessory, hap.Service.Fanv2.UUID), false);

        // the fake device starts as mediaType music + deviceState paused
        assert.equal(motionValue(accessory, 'Music'), true);
        assert.equal(motionValue(accessory, 'Video'), false);
        assert.equal(motionValue(accessory, 'Paused'), true);
        assert.equal(motionValue(accessory, 'Playing'), false);

        assert.equal(accessory.getService('Play')?.UUID, hap.Service.Switch.UUID);
        assert.equal(accessory.getService('Pause')?.UUID, hap.Service.Switch.UUID);
        assert.equal(accessory.category, hap.Categories.OTHER);
    });

    it('exposes a television service with linked sensors in appleTV mode', async (): Promise<void> => {
        const config: AppleTVEnhancedPlatformConfig =
            televisionConfig({ deviceStates: ['playing'], exposeAs: 'appleTV', mediaTypes: ['music'] });
        const { accessory } = await bootAccessory(config);

        const television: hap.Service | undefined = accessory.getService(hap.Service.Television);
        assert.ok(television);
        assert.equal(accessory.category, hap.Categories.APPLE_TV);
        assert.ok(television.linkedServices.some((service) => service.displayName === 'Music'));
        assert.ok(television.linkedServices.some((service) => service.displayName === 'Playing'));
    });

    it('uses the set-top-box category in setTopBox mode', async (): Promise<void> => {
        const { accessory } = await bootAccessory(televisionConfig({ exposeAs: 'setTopBox' }));

        assert.equal(hasService(accessory, hap.Service.Television.UUID), true);
        assert.equal(accessory.category, hap.Categories.TV_SET_TOP_BOX);
    });

    it('exposes no sensor or switch services when nothing is configured', async (): Promise<void> => {
        const { accessory } = await bootAccessory(sensorsOnlyConfig());

        assert.equal(hasService(accessory, hap.Service.MotionSensor.UUID), false);
        assert.equal(hasService(accessory, hap.Service.Switch.UUID), false);
    });

    it('resets the sensors when powered off and re-triggers them when powered on', async (): Promise<void> => {
        const config: AppleTVEnhancedPlatformConfig =
            sensorsOnlyConfig({ deviceStates: ['paused', 'playing'], mediaTypes: ['music', 'video'] });
        const { accessory } = await bootAccessory(config);
        const device: FakePyAtvDevice | undefined = currentFakePyAtvDevice();
        assert.ok(device);

        device.emit('update:powerState', { key: 'powerState', value: 'off' });
        await tick();
        assert.equal(motionValue(accessory, 'Music'), false);
        assert.equal(motionValue(accessory, 'Paused'), false);

        device.emit('update:powerState', { key: 'powerState', value: 'on' });
        await tick();
        assert.equal(motionValue(accessory, 'Music'), true);
        assert.equal(motionValue(accessory, 'Paused'), true);
    });

    it('updates only the matching media type and device state sensors', async (): Promise<void> => {
        const config: AppleTVEnhancedPlatformConfig =
            sensorsOnlyConfig({ deviceStates: ['paused', 'playing'], mediaTypes: ['music', 'video'] });
        const { accessory } = await bootAccessory(config);
        const device: FakePyAtvDevice | undefined = currentFakePyAtvDevice();
        assert.ok(device);

        device.emit('update:mediaType', { key: 'mediaType', value: 'video' });
        await tick();
        assert.equal(motionValue(accessory, 'Music'), false);
        assert.equal(motionValue(accessory, 'Video'), true);
        assert.equal(motionValue(accessory, 'Paused'), true);

        device.emit('update:deviceState', { key: 'deviceState', value: 'playing' });
        await tick();
        assert.equal(motionValue(accessory, 'Paused'), false);
        assert.equal(motionValue(accessory, 'Playing'), true);
    });

    it('exposes each configured remote key as a switch', async (): Promise<void> => {
        const { accessory } = await bootAccessory(sensorsOnlyConfig({ remoteKeysAsSwitch: ['home', 'play', 'pause'] }));

        for (const name of ['Home', 'Play', 'Pause']) {
            assert.equal(accessory.getService(name)?.UUID, hap.Service.Switch.UUID, `expected a switch for ${name}`);
        }
        assert.equal(accessory.services.filter((service) => service.UUID === hap.Service.Switch.UUID).length, 3);
    });

    it('reuses existing services when setup runs again on a restored accessory', async (): Promise<void> => {
        const config: AppleTVEnhancedPlatformConfig =
            sensorsOnlyConfig({ deviceStates: ['paused'], mediaTypes: ['music'], remoteKeysAsSwitch: ['play'] });
        const { accessory, platform } = await bootAccessory(config);
        const serviceCount: number = accessory.services.length;

        const restored: AccessoryUnderTest =
            new atvAccessory(platform.platform, accessory as unknown as PlatformAccessory);
        running.push(restored);
        await restored.untilBooted();

        assert.equal(accessory.services.length, serviceCount);
        const names: string[] = accessory.services.map((service) => service.displayName);
        assert.equal(new Set(names).size, names.length);
    });
});
