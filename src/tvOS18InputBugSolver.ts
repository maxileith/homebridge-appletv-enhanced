import fs from 'fs';
import path from 'path';
import type { AppConfigs } from './interfaces';
import PrefixLogger from './PrefixLogger';

export default function tvOS18InputBugSolver(log: PrefixLogger, storagePath: string, mac: string): void {
    log = new PrefixLogger(log, 'tvOS 18 Input Bug Solver');

    const dir: string = path.join(storagePath, 'appletv-enhanced', mac.replaceAll(':', ''));
    const appConfigFilePath: string = path.join(dir, 'apps.json');

    // load app configurations
    if (!fs.existsSync(appConfigFilePath)) {
        log.debug('No apps.json exists until now. Exiting ...');
        return;
    }
    const appConfigs: AppConfigs = JSON.parse(fs.readFileSync(appConfigFilePath, 'utf8'));
    const appNames: string[] = [];
    for (const appId in appConfigs) {
        appNames.push(appConfigs[appId].configuredName);
    }

    // get the number of apps
    const numOfApps: number = appNames.length;
    if (numOfApps === 0) {
        log.debug('apps.json is empty. Exiting ...');
        return;
    }

    // cut off 42 from app names, e.g. "Input Source 42"
    const trimmedAppNames: string[] = appNames.map((appName) => appName.replace(/\s\d+$/, '')).sort();
    // count the occurrence of each app name, e.g. 10x Input Source, 1x Disney, ...
    const countedNames: Map<string, number> = trimmedAppNames.reduce(
        (acc, e) => acc.set(e, (acc.get(e) ?? 0) + 1),
        new Map<string, number>(),
    );
    // get the app name that was used most often
    log.debug('Counting of same app names:');
    let highestCount: number = 0;
    let highestCountAppName: string = '';
    for (const appName of countedNames.keys()) {
        log.debug(`${appName}: ${countedNames.get(appName)}`);
        if (countedNames.get(appName)! > highestCount) {
            highestCount = countedNames.get(appName)!;
            highestCountAppName = appName;
        }
    }

    const percentageWithSameName: number = Math.round(highestCount / numOfApps * 100);

    if (percentageWithSameName < 70) {
        log.debug('Most inputs have no similar app name. Exiting ...');
        return;
    }

    log.warn(`${percentageWithSameName}% of apps have a configured name that starts with "${highestCountAppName}". This is likely caused \
by a bug in tvOS 18. Please refer to the following GitHub issues:`);
    log.warn('- https://github.com/homebridge/homebridge/issues/3703');
    log.warn('- https://github.com/maxileith/homebridge-appletv-enhanced/issues/627');
    log.warn('To resolve this issue the configuration of the Apple TV will now be reset automatically. This issue only occurs during the \
pairing process.');

    const commonConfigFilePath: string = path.join(dir, 'common.json');
    const deviceStatesConfigFilePath: string = path.join(dir, 'deviceStates.json');
    const mediaTypesConfigFilePath: string = path.join(dir, 'mediaTypes.json');
    const remoteKeySwitchesConfigFilePath: string = path.join(dir, 'remoteKeySwitches.json');

    try {
        fs.unlinkSync(appConfigFilePath);
    } finally { /* empty */ }
    try {
        fs.unlinkSync(commonConfigFilePath);
    } finally { /* empty */ }
    try {
        fs.unlinkSync(deviceStatesConfigFilePath);
    } finally { /* empty */ }
    try {
        fs.unlinkSync(mediaTypesConfigFilePath);
    } finally { /* empty */ }
    try {
        fs.unlinkSync(remoteKeySwitchesConfigFilePath);
    } finally { /* empty */ }

    log.success('The configuration of the Apple TV has successfully been reset.');
}
