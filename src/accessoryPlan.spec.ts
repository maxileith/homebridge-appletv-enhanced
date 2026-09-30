import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { PlatformAccessory } from 'homebridge';
import { planAccessoryActions } from './accessoryPlan';
import type { AccessoryPlan, PlannedDevice } from './accessoryPlan';

const MAC: string = 'AA:BB:CC:DD:EE:FF';
const OTHER_MAC: string = '11:22:33:44:55:66';

const device = (mac: string, uuid: string): PlannedDevice => {
    return { mac, mode: 'sensorsOnly', name: mac, uuid };
};

const cachedAccessory = (uuid: string, mac?: string): PlatformAccessory => {
    // eslint-disable-next-line @typescript-eslint/naming-convention
    const accessory: { UUID: string; context: Record<string, unknown> } = { UUID: uuid, context: {} };
    if (mac !== undefined) {
        accessory.context.mac = mac;
    }
    return accessory as unknown as PlatformAccessory;
};

describe('accessoryPlan', (): void => {
    it('creates new accessories when nothing is cached', (): void => {
        const plan: AccessoryPlan = planAccessoryActions([device(MAC, 'uuid-a')], []);
        assert.equal(plan.reuse.size, 0);
        assert.equal(plan.unregister.length, 0);
    });

    it('reuses a cached accessory with a matching UUID', (): void => {
        const accessory: PlatformAccessory = cachedAccessory('uuid-a', MAC);
        const plan: AccessoryPlan = planAccessoryActions([device(MAC, 'uuid-a')], [accessory]);
        assert.equal(plan.reuse.get('uuid-a'), accessory);
        assert.equal(plan.unregister.length, 0);
    });

    it('unregisters a cached accessory of the same device in a different mode', (): void => {
        const accessory: PlatformAccessory = cachedAccessory('uuid-old', MAC);
        const plan: AccessoryPlan = planAccessoryActions([device(MAC, 'uuid-new')], [accessory]);
        assert.equal(plan.reuse.size, 0);
        assert.deepEqual(plan.unregister, [accessory]);
    });

    it('matches the device MAC case-insensitively', (): void => {
        const accessory: PlatformAccessory = cachedAccessory('uuid-old', MAC.toLowerCase());
        const plan: AccessoryPlan = planAccessoryActions([device(MAC, 'uuid-new')], [accessory]);
        assert.deepEqual(plan.unregister, [accessory]);
    });

    it('keeps cached accessories of undiscovered devices', (): void => {
        const accessory: PlatformAccessory = cachedAccessory('uuid-x', OTHER_MAC);
        const plan: AccessoryPlan = planAccessoryActions([device(MAC, 'uuid-a')], [accessory]);
        assert.equal(plan.reuse.size, 0);
        assert.equal(plan.unregister.length, 0);
    });

    it('unregisters a cached accessory whose device is blacklisted', (): void => {
        const accessory: PlatformAccessory = cachedAccessory('uuid-x', OTHER_MAC);
        const plan: AccessoryPlan = planAccessoryActions([device(MAC, 'uuid-a')], [accessory], [OTHER_MAC]);
        assert.deepEqual(plan.unregister, [accessory]);
    });

    it('matches a blacklisted MAC case-insensitively', (): void => {
        const accessory: PlatformAccessory = cachedAccessory('uuid-x', OTHER_MAC);
        const plan: AccessoryPlan = planAccessoryActions([], [accessory], [OTHER_MAC.toLowerCase()]);
        assert.deepEqual(plan.unregister, [accessory]);
    });

    it('keeps a cached accessory that is neither discovered nor blacklisted', (): void => {
        const accessory: PlatformAccessory = cachedAccessory('uuid-x', OTHER_MAC);
        const plan: AccessoryPlan = planAccessoryActions([], [accessory], [MAC]);
        assert.equal(plan.unregister.length, 0);
    });

    it('keeps cached accessories without a MAC in their context', (): void => {
        const accessory: PlatformAccessory = cachedAccessory('uuid-x');
        const plan: AccessoryPlan = planAccessoryActions([device(MAC, 'uuid-a')], [accessory], [OTHER_MAC]);
        assert.equal(plan.unregister.length, 0);
    });
});
