import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { accessoryUuidSeed, getAccessoryMode, getExposeAs, isLegacySetTopBox, resolveDeviceConfig } from './config';
import type { AppleTVEnhancedPlatformConfig, DeviceConfigOverride, ExposeAs } from './interfaces';

const MAC: string = 'AA:BB:CC:DD:EE:FF';
const OTHER_MAC: string = '11:22:33:44:55:66';

const baseConfig = (): AppleTVEnhancedPlatformConfig => {
    return {
        name: 'Apple TV Enhanced',
        platform: 'AppleTVEnhanced',
    };
};

interface ExposeAsCase {
    config: AppleTVEnhancedPlatformConfig;
    expected: ExposeAs;
    label: string;
}

describe('config', (): void => {
    describe('getExposeAs', (): void => {
        it('defaults to appleTV', (): void => {
            assert.equal(getExposeAs(baseConfig()), 'appleTV');
        });

        it('maps the deprecated setTopBox flag', (): void => {
            assert.equal(getExposeAs({ ...baseConfig(), setTopBox: true }), 'setTopBox');
            assert.equal(getExposeAs({ ...baseConfig(), setTopBox: false }), 'appleTV');
        });

        it('prefers exposeAs over the deprecated setTopBox flag', (): void => {
            assert.equal(getExposeAs({ ...baseConfig(), exposeAs: 'sensorsOnly', setTopBox: true }), 'sensorsOnly');
        });
    });

    describe('getAccessoryMode', (): void => {
        it('treats appleTV and setTopBox as television', (): void => {
            assert.equal(getAccessoryMode({ ...baseConfig(), exposeAs: 'appleTV' }), 'television');
            assert.equal(getAccessoryMode({ ...baseConfig(), exposeAs: 'setTopBox' }), 'television');
        });

        it('maps the sensorsOnly exposeAs value to the sensorsOnly mode', (): void => {
            assert.equal(getAccessoryMode({ ...baseConfig(), exposeAs: 'sensorsOnly' }), 'sensorsOnly');
        });
    });

    describe('accessoryUuidSeed', (): void => {
        it('keeps the bare MAC for television modes', (): void => {
            assert.equal(accessoryUuidSeed(MAC, 'television'), MAC);
        });

        it('uses a distinct seed for sensorsOnly', (): void => {
            assert.equal(accessoryUuidSeed(MAC, 'sensorsOnly'), `${MAC}#sensors-only`);
            assert.notEqual(accessoryUuidSeed(MAC, 'sensorsOnly'), accessoryUuidSeed(MAC, 'television'));
        });

        it('prefixes the hostname in development mode', (): void => {
            assert.equal(accessoryUuidSeed(MAC, 'television', 'host-'), `host-${MAC}`);
            assert.equal(accessoryUuidSeed(MAC, 'sensorsOnly', 'host-'), `host-${MAC}#sensors-only`);
        });
    });

    describe('isLegacySetTopBox', (): void => {
        it('is true only when setTopBox is enabled', (): void => {
            assert.equal(isLegacySetTopBox({ ...baseConfig(), setTopBox: true }, MAC), true);
            assert.equal(isLegacySetTopBox({ ...baseConfig(), setTopBox: false }, MAC), false);
        });

        it('is false when exposeAs is set', (): void => {
            assert.equal(isLegacySetTopBox({ ...baseConfig(), exposeAs: 'appleTV', setTopBox: true }, MAC), false);
        });

        it('is false when neither is set', (): void => {
            assert.equal(isLegacySetTopBox(baseConfig(), MAC), false);
        });

        it('is true when a per-device setTopBox override is set', (): void => {
            const config: AppleTVEnhancedPlatformConfig = {
                ...baseConfig(),
                deviceSpecificOverrides: [{ mac: MAC, overrideSetTopBox: true, setTopBox: true }],
            };
            assert.equal(isLegacySetTopBox(config, MAC), true);
            assert.equal(isLegacySetTopBox(config, OTHER_MAC), false);
        });

        it('is false when a per-device setTopBox override switches the device back to appleTV', (): void => {
            const config: AppleTVEnhancedPlatformConfig = {
                ...baseConfig(),
                setTopBox: true,
                deviceSpecificOverrides: [{ mac: MAC, overrideSetTopBox: true, setTopBox: false }],
            };
            assert.equal(isLegacySetTopBox(config, MAC), false);
            assert.equal(isLegacySetTopBox(config, OTHER_MAC), true);
        });

        it('is false when a per-device exposeAs override wins', (): void => {
            const config: AppleTVEnhancedPlatformConfig = {
                ...baseConfig(),
                setTopBox: true,
                deviceSpecificOverrides: [{ mac: MAC, overrideExposeAs: true, exposeAs: 'appleTV' }],
            };
            assert.equal(isLegacySetTopBox(config, MAC), false);
        });
    });

    describe('resolveDeviceConfig', (): void => {
        it('resolves exposeAs from the global config', (): void => {
            assert.equal(getExposeAs(resolveDeviceConfig(baseConfig(), MAC)), 'appleTV');
            assert.equal(getExposeAs(resolveDeviceConfig({ ...baseConfig(), setTopBox: true }, MAC)), 'setTopBox');
            assert.equal(getExposeAs(resolveDeviceConfig({ ...baseConfig(), exposeAs: 'sensorsOnly' }, MAC)), 'sensorsOnly');
        });

        it('does not mutate the platform config', (): void => {
            const config: AppleTVEnhancedPlatformConfig = { ...baseConfig(), setTopBox: true };
            resolveDeviceConfig(config, MAC);
            assert.equal(config.exposeAs, undefined);
        });

        it('applies per-device exposeAs overrides case-insensitively', (): void => {
            const config: AppleTVEnhancedPlatformConfig = {
                ...baseConfig(),
                deviceSpecificOverrides: [{ mac: MAC.toLowerCase(), overrideExposeAs: true, exposeAs: 'sensorsOnly' }],
            };
            assert.equal(getExposeAs(resolveDeviceConfig(config, MAC)), 'sensorsOnly');
            assert.equal(getExposeAs(resolveDeviceConfig(config, OTHER_MAC)), 'appleTV');
        });

        it('resolves a per-device legacy setTopBox override', (): void => {
            const config: AppleTVEnhancedPlatformConfig = {
                ...baseConfig(),
                deviceSpecificOverrides: [{ mac: MAC, overrideSetTopBox: true, setTopBox: true }],
            };
            assert.equal(resolveDeviceConfig(config, MAC).exposeAs, 'setTopBox');
            assert.equal(isLegacySetTopBox(config, MAC), true);
        });

        it('lets a per-device setTopBox override win over a global exposeAs', (): void => {
            const config: AppleTVEnhancedPlatformConfig = {
                ...baseConfig(),
                exposeAs: 'appleTV',
                deviceSpecificOverrides: [{ mac: MAC, overrideSetTopBox: true, setTopBox: true }],
            };
            assert.equal(resolveDeviceConfig(config, MAC).exposeAs, 'setTopBox');
        });

        it('lets a per-device setTopBox override switch a global sensorsOnly back to a television', (): void => {
            const config: AppleTVEnhancedPlatformConfig = {
                ...baseConfig(),
                exposeAs: 'sensorsOnly',
                deviceSpecificOverrides: [{ mac: MAC, overrideSetTopBox: true, setTopBox: false }],
            };
            assert.equal(resolveDeviceConfig(config, MAC).exposeAs, 'appleTV');
        });

        it('lets a per-device exposeAs override win over the global setTopBox flag', (): void => {
            const config: AppleTVEnhancedPlatformConfig = {
                ...baseConfig(),
                setTopBox: true,
                deviceSpecificOverrides: [{ mac: MAC, overrideExposeAs: true, exposeAs: 'appleTV' }],
            };
            assert.equal(resolveDeviceConfig(config, MAC).exposeAs, 'appleTV');
        });

        it('prefers the per-device exposeAs override when both overrides are set', (): void => {
            const bothOverrides: DeviceConfigOverride = {
                mac: MAC,
                exposeAs: 'sensorsOnly',
                overrideExposeAs: true,
                overrideSetTopBox: true,
                setTopBox: true,
            };
            const config: AppleTVEnhancedPlatformConfig = { ...baseConfig(), deviceSpecificOverrides: [bothOverrides] };
            assert.equal(resolveDeviceConfig(config, MAC).exposeAs, 'sensorsOnly');
        });

        it('still applies the other per-device overrides', (): void => {
            const config: AppleTVEnhancedPlatformConfig = {
                ...baseConfig(),
                disableInputs: false,
                deviceSpecificOverrides: [{ mac: MAC, overrideDisableInputs: true, disableInputs: true }],
            };
            assert.equal(resolveDeviceConfig(config, MAC).disableInputs, true);
            assert.equal(resolveDeviceConfig(config, OTHER_MAC).disableInputs, false);
        });
    });

    describe('resolveDeviceConfig override coverage', (): void => {
        const globalConfig: AppleTVEnhancedPlatformConfig = {
            ...baseConfig(),
            absoluteVolumeControl: false,
            avadaKedavraAppAmount: 15,
            customInputURIs: ['global-uri'],
            customPyatvCommands: [{ command: 'global', name: 'Global' }],
            deviceStates: ['idle'],
            disableCharacteristics: false,
            disableInputs: false,
            disableVolumeControlRemote: false,
            mediaTypes: ['music'],
            remoteKeysAsSwitch: ['play'],
        };
        const fullOverride: DeviceConfigOverride = {
            absoluteVolumeControl: true,
            avadaKedavraAppAmount: 30,
            customInputURIs: ['override-uri'],
            customPyatvCommands: [{ command: 'override', name: 'Override' }],
            deviceStates: ['paused'],
            disableCharacteristics: true,
            disableInputs: true,
            disableVolumeControlRemote: true,
            mac: MAC,
            mediaTypes: ['video'],
            overrideAbsoluteVolumeControl: true,
            overrideAvadaKedavraAppAmount: true,
            overrideCustomInputURIs: true,
            overrideCustomPyatvCommands: true,
            overrideDeviceStates: true,
            overrideDisableCharacteristics: true,
            overrideDisableInputs: true,
            overrideDisableVolumeControlRemote: true,
            overrideMediaTypes: true,
            overrideRemoteKeysAsSwitch: true,
            remoteKeysAsSwitch: ['pause'],
        };

        it('applies every per-device override', (): void => {
            const resolved: AppleTVEnhancedPlatformConfig =
                resolveDeviceConfig({ ...globalConfig, deviceSpecificOverrides: [fullOverride] }, MAC);
            assert.deepEqual(resolved.mediaTypes, ['video']);
            assert.deepEqual(resolved.deviceStates, ['paused']);
            assert.deepEqual(resolved.remoteKeysAsSwitch, ['pause']);
            assert.equal(resolved.avadaKedavraAppAmount, 30);
            assert.deepEqual(resolved.customInputURIs, ['override-uri']);
            assert.deepEqual(resolved.customPyatvCommands, [{ command: 'override', name: 'Override' }]);
            assert.equal(resolved.disableCharacteristics, true);
            assert.equal(resolved.disableInputs, true);
            assert.equal(resolved.disableVolumeControlRemote, true);
            assert.equal(resolved.absoluteVolumeControl, true);
        });

        it('ignores values whose override flag is not set', (): void => {
            const overrideWithoutFlags: DeviceConfigOverride = { mac: MAC, disableInputs: true, mediaTypes: ['video'] };
            const resolved: AppleTVEnhancedPlatformConfig =
                resolveDeviceConfig({ ...globalConfig, deviceSpecificOverrides: [overrideWithoutFlags] }, MAC);
            assert.equal(resolved.disableInputs, false);
            assert.deepEqual(resolved.mediaTypes, ['music']);
        });

        it('does not apply an override that targets another mac', (): void => {
            const resolved: AppleTVEnhancedPlatformConfig =
                resolveDeviceConfig({ ...globalConfig, deviceSpecificOverrides: [fullOverride] }, OTHER_MAC);
            assert.equal(resolved.disableInputs, false);
            assert.deepEqual(resolved.mediaTypes, ['music']);
        });

        it('does not mutate the platform config when applying overrides', (): void => {
            const config: AppleTVEnhancedPlatformConfig = { ...globalConfig, deviceSpecificOverrides: [fullOverride] };
            resolveDeviceConfig(config, MAC);
            assert.equal(config.disableInputs, false);
            assert.deepEqual(config.mediaTypes, ['music']);
        });
    });

    describe('exposeAs resolution order', (): void => {
        it('resolves the global config as documented', (): void => {
            const cases: ExposeAsCase[] = [
                { config: baseConfig(), expected: 'appleTV', label: 'nothing set' },
                { config: { ...baseConfig(), setTopBox: true }, expected: 'setTopBox', label: 'setTopBox true' },
                { config: { ...baseConfig(), setTopBox: false }, expected: 'appleTV', label: 'setTopBox false' },
                { config: { ...baseConfig(), exposeAs: 'appleTV' }, expected: 'appleTV', label: 'exposeAs appleTV' },
                { config: { ...baseConfig(), exposeAs: 'setTopBox' }, expected: 'setTopBox', label: 'exposeAs setTopBox' },
                { config: { ...baseConfig(), exposeAs: 'sensorsOnly' }, expected: 'sensorsOnly', label: 'exposeAs sensorsOnly' },
                {
                    config: { ...baseConfig(), exposeAs: 'sensorsOnly', setTopBox: true },
                    expected: 'sensorsOnly',
                    label: 'exposeAs wins over setTopBox',
                },
            ];

            for (const testCase of cases) {
                assert.equal(getExposeAs(testCase.config), testCase.expected, testCase.label);
            }
        });

        it('resolves per-device overrides ahead of the global config as documented', (): void => {
            const bothOverrides: DeviceConfigOverride = {
                exposeAs: 'sensorsOnly',
                mac: MAC,
                overrideExposeAs: true,
                overrideSetTopBox: true,
                setTopBox: true,
            };
            const cases: ExposeAsCase[] = [
                {
                    config: {
                        ...baseConfig(),
                        exposeAs: 'appleTV',
                        deviceSpecificOverrides: [{ mac: MAC, overrideSetTopBox: true, setTopBox: true }],
                    },
                    expected: 'setTopBox',
                    label: 'overrideSetTopBox wins over a global exposeAs',
                },
                {
                    config: {
                        ...baseConfig(),
                        exposeAs: 'sensorsOnly',
                        deviceSpecificOverrides: [{ mac: MAC, overrideSetTopBox: true, setTopBox: false }],
                    },
                    expected: 'appleTV',
                    label: 'overrideSetTopBox false switches a global sensorsOnly back to a television',
                },
                {
                    config: {
                        ...baseConfig(),
                        setTopBox: true,
                        deviceSpecificOverrides: [{ mac: MAC, overrideExposeAs: true, exposeAs: 'appleTV' }],
                    },
                    expected: 'appleTV',
                    label: 'overrideExposeAs wins over a global setTopBox',
                },
                {
                    config: {
                        ...baseConfig(),
                        deviceSpecificOverrides: [{ mac: MAC, overrideExposeAs: true, exposeAs: 'sensorsOnly' }],
                    },
                    expected: 'sensorsOnly',
                    label: 'overrideExposeAs without a global value',
                },
                {
                    config: { ...baseConfig(), exposeAs: 'appleTV', deviceSpecificOverrides: [bothOverrides] },
                    expected: 'sensorsOnly',
                    label: 'overrideExposeAs wins when both overrides are set',
                },
            ];

            for (const testCase of cases) {
                assert.equal(resolveDeviceConfig(testCase.config, MAC).exposeAs, testCase.expected, testCase.label);
            }
        });
    });
});
