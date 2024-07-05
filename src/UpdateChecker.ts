import type { AxiosResponse } from 'axios';
import { AxiosError } from 'axios';
import axios from 'axios';
import PrefixLogger from './PrefixLogger';
import type LogLevelLogger from './LogLevelLogger';
import { compareVersions } from 'compare-versions';
import packageJson from '../package.json';
import path from 'path';
import { pathExists } from 'fs-extra';
import { runCommand } from './utils';

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
    url: string;
    provenance: INpmProvenance;
}

interface INpmSignature {
    keyid: string;
    sig: string;
}

interface INpmDist {
    integrity: string;
    shasum: string;
    tarball: string;
    fileCount: number;
    unpackedSize: number;
    attestations: INpmAttestations;
    signatures: INpmSignature[];
}

interface INpmUser {
    name: string;
    email: string;
}

interface INpmOperationalInternal {
    host: string;
    tmp: string;
}

interface INpmVersion {
    name: string;
    displayName: string;
    version: string;
    description: string;
    main: string;
    author: INpmAuthor;
    scripts: Record<string, string>;
    os: string[];
    engines: Record<string, string>;
    keywords: string[];
    license: string;
    publishConfig: INpmPublishConfig;
    repository: INpmRepository;
    bugs: INpmBugs;
    devDependencies: Record<string, string>;
    dependencies: Record<string, string>;
    homepage: string;
    funding: INpmFunding[];
    _id: string;
    readme: string;
    readmeFilename: string;
    gitHead: string;
    types: string;
    _nodeVersion: string;
    _npmVersion: string;
    dist: INpmDist;
    _npmUser: INpmUser;
    directories: object;
    maintainers: INpmUser[];
    _npmOperationalInternal: INpmOperationalInternal;
    _hasShrinkwrap: boolean;
}

interface INpmTime extends Record<string, string> {
    modified: string;
    created: string;
}

interface INpmResponse {
    _id: string;
    _rev: string;
    name: string;
    'dist-tags': Record<string, string>;
    versions: Record<string, INpmVersion>;
    time: INpmTime;
    maintainers: INpmUser[];
    description: string;
    homepage: string;
    keywords: string[];
    repository: INpmRepository;
    author: INpmAuthor;
    bugs: INpmBugs;
    license: string;
    readme: string;
    readmeFilename: string;
}

const UIX_CUSTOM_PLUGIN_PATH: string | undefined = process.env.UIX_CUSTOM_PLUGIN_PATH !== undefined
    ? path.resolve(process.env.UIX_CUSTOM_PLUGIN_PATH)
    : undefined;
const UIX_USE_PNPM: boolean = process.env.UIX_USE_PNPM === '1';

class UpdateChecker {

    private readonly log: PrefixLogger;

    private intervalMs: number;
    private includeBetas: boolean;
    private interval: NodeJS.Timeout | undefined;
    private autoUpdate: boolean;

    public constructor(
        logger: LogLevelLogger | PrefixLogger,
        autoUpdate: boolean = false,
        includeBetas: boolean = false,
        intervalMinutes: number = 60,
    ) {
        this.log = new PrefixLogger(logger, 'Update check');

        this.intervalMs = intervalMinutes * 60000;
        this.includeBetas = includeBetas;
        this.autoUpdate = autoUpdate;

        this.log.info(`The update checker is configured to check for updates every ${intervalMinutes} minutes, \
${includeBetas ? 'including' : 'excluding'} betas. Auto updating is turned ${autoUpdate ? 'on' : 'off'}.`);
    }

    public startInterval(skipInitialCheck: boolean = false): void {
        this.log.debug('Starting update check interval.');
        if (skipInitialCheck === false) {
            this.log.debug('Skipping initial update check.');
            this.check();
        }
        this.interval = setInterval(this.check.bind(this), this.intervalMs);
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

    public async check(infoOrDebugLogLevel: 'debug' | 'info' = 'debug'): Promise<void> {
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
                this.log.info(msg);
            }
        }
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

        const latestStableVersion: string = response.data['dist-tags']['latest'];
        const latestBetaVersion: string = response.data['dist-tags']['beta'];

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

    private getCurrentVersion(): string {
        return packageJson.version;
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
            pathExists(path.resolve(installPath, '../package.json'))
        ) {
            installOptions.push('--save');
        }

        installPath = path.resolve(installPath, '..');

        const args: string[] = ['install', ...installOptions, `homebridge-appletv-enhanced@${version}`];

        this.log.info(`CMD: ${npm} "${args.join('" "')} (cwd: ${installPath})"`);
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