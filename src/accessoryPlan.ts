import type { PlatformAccessory } from 'homebridge';
import type { AccessoryMode } from './interfaces';

export interface PlannedDevice {
    mac: string;
    mode: AccessoryMode;
    name: string;
    uuid: string;
}

export interface AccessoryPlan {
    /** Cached bridged accessories that can be reused, keyed by their UUID. */
    reuse: Map<string, PlatformAccessory>;
    /** Cached bridged accessories that no longer match a discovered device and must be unregistered. */
    unregister: PlatformAccessory[];
}

/**
 * Decide which cached (bridged) accessories can be reused and which ones are
 * stale. Only accessories that were registered on the bridge are passed to
 * `configureAccessory`, so external (television) accessories never appear in
 * `cached`.
 *
 * A cached accessory is unregistered when its device is still discovered but in
 * a different mode (its UUID changed), or when it was explicitly blacklisted.
 * Accessories of devices that are merely undiscovered (e.g. offline) are kept.
 */
export function planAccessoryActions(
    devices: PlannedDevice[],
    cached: PlatformAccessory[],
    blacklistedMacs: string[] = [],
): AccessoryPlan {
    const cachedByUuid: Map<string, PlatformAccessory> =
        new Map<string, PlatformAccessory>(cached.map((accessory) => [accessory.UUID, accessory]));
    const deviceByMac: Map<string, PlannedDevice> =
        new Map<string, PlannedDevice>(devices.map((device) => [device.mac.toUpperCase(), device]));
    const blacklisted: Set<string> = new Set<string>(blacklistedMacs.map((mac) => mac.toUpperCase()));

    const reuse: Map<string, PlatformAccessory> = new Map<string, PlatformAccessory>();
    for (const device of devices) {
        const cachedAccessory: PlatformAccessory | undefined = cachedByUuid.get(device.uuid);
        if (cachedAccessory !== undefined) {
            reuse.set(device.uuid, cachedAccessory);
        }
    }

    const unregister: PlatformAccessory[] = cached.filter((accessory) => {
        const mac: string | undefined = accessory.context.mac as string | undefined;
        if (mac === undefined) {
            return false;
        }
        const normalizedMac: string = mac.toUpperCase();
        const device: PlannedDevice | undefined = deviceByMac.get(normalizedMac);
        if (device !== undefined) {
            return device.uuid !== accessory.UUID;
        }
        return blacklisted.has(normalizedMac);
    });

    return { reuse, unregister };
}
