import type { API } from 'homebridge';

import { PLATFORM_NAME } from './settings';
import { AppleTVEnhancedPlatform } from './appleTVEnhancedPlatform';

/**
 * This method registers the platform with Homebridge
 */
export default (api: API): void => {
    api.registerPlatform(PLATFORM_NAME, AppleTVEnhancedPlatform);
};
