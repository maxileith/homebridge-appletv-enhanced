import type { AxiosResponse } from 'axios';
import { AxiosError } from 'axios';
import axios from 'axios';
import PrefixLogger from './PrefixLogger';
import type LogLevelLogger from './LogLevelLogger';
import { compareVersions } from 'compare-versions';
import packageJson from '../package.json';
import path from 'path';
import fs from 'fs';
import { pathExists } from 'fs-extra';
import { runCommand } from './utils';
import type { TUpdateCheckTime } from './types';

interface INpmPublishConfig {
    access: string;
}

interface INpmAuthor {
    name: string;
}

interface INpmRepository {
    type: string;
    url: string;
}

interface INpmBugs {
    url: string;
}

interface INpmFunding {
    type: string;
    url: string;
}

interface INpmProvenance {
    predicateType: string;
}

interface INpmAttestations {
    provenance: INpmProvenance;
    url: string;
}

interface INpmSignature {
    keyid: string;
    sig: string;
}

interface INpmDist {
    attestations: INpmAttestations;
    fileCount: number;
    integrity: string;
    shasum: string;
    signatures: INpmSignature[];
    tarball: string;
    unpackedSize: number;
}

interface INpmUser {
    email: string;
    name: string;
}

interface INpmOperationalInternal {
    host: string;
    tmp: string;
}

interface INpmVersion {
    _hasShrinkwrap: boolean;
    _id: string;
    _nodeVersion: string;
    _npmOperationalInternal: INpmOperationalInternal;
    _npmUser: INpmUser;
    _npmVersion: string;
    author: INpmAuthor;
    bugs: INpmBugs;
    dependencies: Record<string, string>;
    description: string;
    devDependencies: Record<string, string>;
    directories: object;
    displayName: string;
    dist: INpmDist;
    engines: Record<string, string>;
    funding: INpmFunding[];
    gitHead: string;
    homepage: string;
    keywords: string[];
    license: string;
    main: string;
    maintainers: INpmUser[];
    name: string;
    os: string[];
    publishConfig: INpmPublishConfig;
    readme: string;
    readmeFilename: string;
    repository: INpmRepository;
    scripts: Record<string, string>;
    types: string;
    version: string;
}

interface INpmTime extends Record<string, string> {
    created: string;
    modified: string;
}

interface INpmResponse {
    _id: string;
    _rev: string;
    author: INpmAuthor;
    bugs: INpmBugs;
    description: string;
    // eslint-disable-next-line @typescript-eslint/naming-convention
    'dist-tags': Record<string, string>;
    homepage: string;
    keywords: string[];
    license: string;
    maintainers: INpmUser[];
    name: string;
    readme: string;
    readmeFilename: string;
    repository: INpmRepository;
    time: INpmTime;
    versions: Record<string, INpmVersion>;
}

const UIX_CUSTOM_PLUGIN_PATH: string | undefined = process.env.UIX_CUSTOM_PLUGIN_PATH !== undefined
    ? fs.realpathSync(process.env.UIX_CUSTOM_PLUGIN_PATH)
    : undefined;
const UIX_USE_PNPM: boolean = process.env.UIX_USE_PNPM === '1';

class UpdateChecker {

    private autoUpdate: boolean;
    private includeBetas: boolean;
    private interval: NodeJS.Timeout | undefined;
    private readonly log: PrefixLogger;
    private updateCheckHour: number;

    public constructor(
        logger: LogLevelLogger | PrefixLogger,
        autoUpdate: boolean = false,
        includeBetas: boolean = false,
        updateCheckHour: TUpdateCheckTime = 3,
    ) {
        this.log = new PrefixLogger(logger, 'Update check');

        this.updateCheckHour = updateCheckHour;
        this.includeBetas = includeBetas;
        this.autoUpdate = autoUpdate;

        this.log.info(`The update checker is configured to check for updates between ${updateCheckHour}:00 and ${updateCheckHour}:59, \
${includeBetas ? 'including' : 'excluding'} betas. Auto updating is turned ${autoUpdate ? 'on' : 'off'}.`);
    }

    public async check(infoOrDebugLogLevel: 'debug' | 'success' = 'debug'): Promise<void> {
        const latestVersion: string | undefined = await this.getLatestVersion();
        if (latestVersion === undefined) {
            return;
        }

        const currentVersion: string = this.getCurrentVersion();
        if (compareVersions(latestVersion, currentVersion) === 1) {
            this.log.warn(`There is a new version of AppleTV Enhanced available (${this.includeBetas ? 'including' : 'excluding'} \
betas): ${latestVersion}. You are currently using ${currentVersion}`);
            if (this.autoUpdate) {
                await this.update(latestVersion);
            }
        } else {
            const msg: string = `You are using the latest version of AppleTV Enhanced (${this.includeBetas ? 'including' : 'excluding'} \
betas): ${currentVersion}`;
            if (infoOrDebugLogLevel === 'debug') {
                this.log.debug(msg);
            } else {
                this.log.success(msg);
            }
        }
    }

    public startInterval(skipInitialCheck: boolean = false): void {
        this.log.debug('Starting update check interval.');
        if (skipInitialCheck) {
            this.log.debug('Skipping initial update check.');
        } else {
            this.intervalMethod();
        }
        this.interval = setInterval(this.intervalMethod.bind(this), 60 * 60 * 1000);
    }

    public stopInterval(): void {
        if (this.interval !== undefined) {
            this.log.debug('Stopping update check interval.');
            clearInterval(this.interval);
            this.interval = undefined;
        } else {
            this.log.warn('Could not stop update check interval since there is no active update check interval.');
        }
    }

    private getCurrentVersion(): string {
        return packageJson.version;
    }

    private async getLatestVersion(): Promise<string | undefined> {
        let response: AxiosResponse<INpmResponse, unknown> | undefined = undefined;
        try {
            response = await axios.get('https://registry.npmjs.org/homebridge-appletv-enhanced') as AxiosResponse<INpmResponse, unknown>;
        } catch (e: unknown) {
            if (e instanceof AxiosError) {
                this.log.warn(`Could not query version information from NPM in order to check for updates: ${e.message}`);
            } else {
                throw e;
            }
            return undefined;
        }

        const latestStableVersion: string = response.data['dist-tags'].latest;
        const latestBetaVersion: string = response.data['dist-tags'].beta;

        let outputVersion: string | undefined = undefined;

        if (!this.includeBetas) {
            outputVersion = latestStableVersion;
        } else {
            if (compareVersions(latestStableVersion, latestBetaVersion) === 1) {
                outputVersion = latestStableVersion;
            } else {
                outputVersion = latestBetaVersion;
            }
        }

        this.log.debug(`The latest AppleTV Enhanced version (${this.includeBetas ? 'including' : 'excluding'} betas) is ${outputVersion}`);

        return outputVersion;
    }

    private intervalMethod(): void {
        if ((new Date()).getHours() === this.updateCheckHour) {
            this.log.debug('Triggering the check method since the configured update check time is now.');
            void this.check();
        } else {
            this.log.debug(`Not triggering the check method as the update check is configured to run between ${this.updateCheckHour}:00 \
and ${this.updateCheckHour}:59.`);
        }
    }

    // update process according to hb-service
    // https://github.com/homebridge/homebridge-config-ui-x/blob/1b52f15984374ab5a244dec8761c15a701de0cea/src/bin/hb-service.ts#L1327-L1381
    private async update(version: string): Promise<void> {
        this.log.info(`Attempting to update AppleTV Enhanced to version ${version}`);

        if (UIX_CUSTOM_PLUGIN_PATH === undefined) {
            this.log.error('Could not determine the path where to install the plugin since the environment variable UIX_CUSTOM_PLUGIN_PATH \
is not set.');
            return;
        }

        const npm: string = UIX_USE_PNPM ? 'pnpm' : 'npm';

        let installPath: string = path.resolve(__dirname, '..', '..');
        this.log.debug(`custom plugin path - ${UIX_CUSTOM_PLUGIN_PATH}`);
        this.log.debug(`install path - ${installPath}`);

        const installOptions: string[] = !UIX_USE_PNPM ? [
            '--no-audit',
            '--no-fund',
            '--global-style',
        ] : [];

        if (
            installPath === UIX_CUSTOM_PLUGIN_PATH &&
            pathExists(path.resolve(installPath, '../package.json')) === true
        ) {
            installOptions.push('--save');
        }

        installPath = path.resolve(installPath, '..');

        const args: string[] = ['install', ...installOptions, `homebridge-appletv-enhanced@${version}`];

        this.log.info(`CMD: ${npm} "${args.join('" "')}" (cwd: ${installPath})`);
        const [, , exitCode]: [string, string, number | null] = await runCommand(this.log, npm, args, {cwd: installPath});

        if (exitCode === 0) {
            this.log.success(`AppleTV Enhanced has successfully been updated to ${version}. Restarting now ...`);
            process.exit(0);
        } else {
            this.log.error(`An error has occurred while updating AppleTV Enhanced. Exit code: ${exitCode}.`);
        }
    }
}

export default UpdateChecker;