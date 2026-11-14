import type { NodePyATVDevice } from '@sebbo2002/node-pyatv';

// Model identifiers returned by pyatv for supported Apple TVs.
const ALLOWED_MODELS: string[] = [
    'Gen4',
    'Gen4K',
    'AppleTV4KGen2',
    'AppleTV4KGen3',
];

export function isSupportedAppleTV(device: Pick<NodePyATVDevice, 'model' | 'modelName' | 'os'>): boolean {
    if (ALLOWED_MODELS.includes(device.model ?? '') && device.os === 'TvOS') {
        return true;
    }

    // pyatv 0.18 reports this hardware identifier with an unknown model and OS.
    // Keep the fallback specific to this model so other AirPlay devices stay excluded.
    return device.modelName === 'AppleTV18,1' && (device.os === 'Unknown' || device.os === 'TvOS');
}
