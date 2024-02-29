import type { AxiosResponse } from 'axios';
import { AxiosError } from 'axios';
import axios from 'axios';
import PrefixLogger from './PrefixLogger';
import type LogLevelLogger from './LogLevelLogger';
import { compareVersions } from 'compare-versions';
import packageJson from '../package.json';

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

class UpdateChecker {

    private readonly log: PrefixLogger;

    private intervalMs: number;
    private includeBetas: boolean;
    private interval: NodeJS.Timeout | undefined;

    public constructor(logger: LogLevelLogger | PrefixLogger, includeBetas: boolean = false, intervalMinutes: number = 60) {
        this.log = new PrefixLogger(logger, 'Update check');

        this.intervalMs = intervalMinutes * 60000;
        this.includeBetas = includeBetas;
    }

    public start(): void {
        this.check();
        this.interval = setInterval(this.check.bind(this), this.intervalMs);
    }

    public stop(): void {
        if (this.interval !== undefined) {
            clearInterval(this.interval);
            this.interval = undefined;
        }
    }

    private async check(): Promise<void> {
        const latestVersion: string | undefined = await this.getLatestVersion();
        if (latestVersion === undefined) {
            return;
        }

        const currentVersion: string = this.getCurrentVersion();
        if (compareVersions(latestVersion, currentVersion) === 1) {
            this.log.warn(`There is a new version of Apple TV Enhanced available: ${latestVersion}. \
You are currently using ${currentVersion}`);
        } else {
            this.log.debug(`You are using the latest version of Apple TV Enhanced (${currentVersion})`);
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

        this.log.debug(`The latest Apple TV Enhanced version ${this.includeBetas && ('(including betas)')} is ${outputVersion}`);

        return outputVersion;
    }

    private getCurrentVersion(): string {
        return packageJson.version;
    }
}

export default UpdateChecker;