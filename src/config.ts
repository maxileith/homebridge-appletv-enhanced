import type { AccessoryMode, AppleTVEnhancedPlatformConfig, DeviceConfigOverride, ExposeAs } from './interfaces';

/**
 * Seed for the accessory UUID. Television modes keep the bare MAC so existing
 * accessories keep their identity across upgrades, while `sensorsOnly` uses a
 * distinct seed so both modes can coexist. In development mode the local
 * hostname is prefixed so multiple instances can run side by side.
 */
export function accessoryUuidSeed(mac: string, mode: AccessoryMode, devHostname?: string): string {
    const suffix: string = mode === 'sensorsOnly' ? '#sensors-only' : '';
    return `${devHostname ?? ''}${mac}${suffix}`;
}

/**
 * The structural accessory mode. `appleTV` and `setTopBox` both expose a
 * Television service and only differ in the accessory category, while
 * `sensorsOnly` exposes the configured sensors and switches as a bridged
 * accessory without a Television service.
 */
export function getAccessoryMode(config: AppleTVEnhancedPlatformConfig): AccessoryMode {
    return getExposeAs(config) === 'sensorsOnly' ? 'sensorsOnly' : 'television';
}

/**
 * Resolve the effective `exposeAs` value. The deprecated `setTopBox` flag is
 * honored when the newer `exposeAs` option is not set.
 */
export function getExposeAs(config: AppleTVEnhancedPlatformConfig): ExposeAs {
    if (config.exposeAs !== undefined) {
        return config.exposeAs;
    }
    return config.setTopBox === true ? 'setTopBox' : 'appleTV';
}

function findOverride(config: AppleTVEnhancedPlatformConfig, mac: string): DeviceConfigOverride | undefined {
    return config.deviceSpecificOverrides?.find((e) => e.mac?.toUpperCase() === mac.toUpperCase());
}

/**
 * Resolve the effective `exposeAs` for a device and whether it came from the
 * deprecated `setTopBox` flag. A per-device `exposeAs` override wins over a
 * legacy per-device `overrideSetTopBox`, which wins over the global
 * configuration. Single source of truth for `resolveDeviceConfig` and
 * `isLegacySetTopBox`, so the two cannot drift apart.
 */
function resolveExposeAs(
    config: AppleTVEnhancedPlatformConfig,
    override: DeviceConfigOverride | undefined,
): { exposeAs: ExposeAs; legacy: boolean } {
    if (override?.overrideExposeAs === true && override.exposeAs !== undefined) {
        return { exposeAs: override.exposeAs, legacy: false };
    }
    if (override?.overrideSetTopBox === true && override.setTopBox !== undefined) {
        return { exposeAs: override.setTopBox ? 'setTopBox' : 'appleTV', legacy: override.setTopBox };
    }
    if (config.exposeAs !== undefined) {
        return { exposeAs: config.exposeAs, legacy: false };
    }
    const legacy: boolean = config.setTopBox === true;
    return { exposeAs: legacy ? 'setTopBox' : 'appleTV', legacy };
}

/**
 * Whether the device relies on the deprecated `setTopBox` flag instead of the
 * `exposeAs` option. Used to nudge users towards an explicit migration. The
 * result reflects the value that actually wins for this device, so a per-device
 * `overrideExposeAs` or a per-device `overrideSetTopBox` that resolves to
 * `appleTV` counts as migrated even if a global `setTopBox` remains.
 */
export function isLegacySetTopBox(config: AppleTVEnhancedPlatformConfig, mac: string): boolean {
    return resolveExposeAs(config, findOverride(config, mac)).legacy;
}

/**
 * Apply the matching entry of `deviceSpecificOverrides` to the platform config
 * and resolve the effective `exposeAs` mode, honoring the deprecated `setTopBox`
 * flag. Per-device overrides take precedence over the global configuration.
 */
export function resolveDeviceConfig(config: AppleTVEnhancedPlatformConfig, mac: string): AppleTVEnhancedPlatformConfig {
    const override: DeviceConfigOverride | undefined = findOverride(config, mac);

    const resolved: AppleTVEnhancedPlatformConfig = override === undefined
        ? { ...config }
        : structuredClone(config);

    if (override !== undefined) {
        if (override.overrideMediaTypes === true) {
            resolved.mediaTypes = override.mediaTypes;
        }
        if (override.overrideDeviceStates === true) {
            resolved.deviceStates = override.deviceStates;
        }
        if (override.overrideRemoteKeysAsSwitch === true) {
            resolved.remoteKeysAsSwitch = override.remoteKeysAsSwitch;
        }
        if (override.overrideAvadaKedavraAppAmount === true) {
            resolved.avadaKedavraAppAmount = override.avadaKedavraAppAmount;
        }
        if (override.overrideCustomInputURIs === true) {
            resolved.customInputURIs = override.customInputURIs;
        }
        if (override.overrideCustomPyatvCommands === true) {
            resolved.customPyatvCommands = override.customPyatvCommands;
        }
        if (override.overrideDisableCharacteristics === true) {
            resolved.disableCharacteristics = override.disableCharacteristics;
        }
        if (override.overrideDisableInputs === true) {
            resolved.disableInputs = override.disableInputs;
        }
        if (override.overrideDisableVolumeControlRemote === true) {
            resolved.disableVolumeControlRemote = override.disableVolumeControlRemote;
        }
        if (override.overrideAbsoluteVolumeControl === true) {
            resolved.absoluteVolumeControl = override.absoluteVolumeControl;
        }
    }

    resolved.exposeAs = resolveExposeAs(config, override).exposeAs;

    return resolved;
}
