import path from 'path';
import type { Dirent } from 'fs';
import fs from 'fs';
import { delay, normalizePath, runCommand } from './utils';
import PrefixLogger from './PrefixLogger';
import type LogLevelLogger from './LogLevelLogger';
import type { AxiosResponse } from 'axios';
import axios from 'axios';
import { compareVersions } from 'compare-versions';
import os from 'os';

const supportedPythonVersions: string[] = [
    '3.9',
    '3.10',
    '3.11',
    '3.12',
    '3.13',
];

const MIN_OPENSSL_VERSION: string = '3.0.0';

const UID: number = os.userInfo().uid;
const GID: number = os.userInfo().gid;

class PythonChecker {

    private readonly customPythonExecutable: string | undefined;
    private readonly log: PrefixLogger;
    private readonly pluginDirPath: string;
    private pythonExecutable: string = 'python3';
    private readonly pythonRequirementsPath: string = path.join(__dirname, '..', 'requirements.txt');
    private readonly venvAtvremoteExecutable: string;
    private readonly venvAtvscriptExecutable: string;
    private readonly venvConfigPath: string;
    private readonly venvPath: string;
    private readonly venvPipExecutable: string;
    private readonly venvPythonExecutable: string;

    public constructor(logger: LogLevelLogger | PrefixLogger, storagePath: string, customPythonExecutable?: string) {
        this.log = new PrefixLogger(logger, 'Python check');
        this.customPythonExecutable = customPythonExecutable;
        this.pluginDirPath = path.join(storagePath, 'appletv-enhanced');
        this.venvPath = path.join(this.pluginDirPath, '.venv');
        this.venvPythonExecutable = path.join(this.venvPath, 'bin', 'python3');
        this.venvPipExecutable = path.join(this.venvPath, 'bin', 'pip3');
        this.venvConfigPath = path.join(this.venvPath, 'pyvenv.cfg');
        this.venvAtvremoteExecutable = path.join(this.venvPath, 'bin', 'atvremote');
        this.venvAtvscriptExecutable = path.join(this.venvPath, 'bin', 'atvscript');
    }

    public async allInOne(forceVenvRecreate: boolean = false): Promise<void> {
        this.log.info('Starting python check.');

        this.pythonExecutable = this.getPythonExecutable('python3', this.customPythonExecutable);
        this.log.info(`Using "${this.pythonExecutable}" as the python executable.`);

        this.ensurePluginDir();
        await this.openSSL();
        await this.ensurePythonVersion();
        await this.ensureVenvCreated(forceVenvRecreate);
        await this.ensureVenvUsesCorrectPython();
        await this.ensureVenvPipUpToDate();
        await this.ensureVenvRequirementsSatisfied();
        await this.updateApiPy();

        this.log.success('Finished');
    }

    private async areRequirementsSatisfied(): Promise<boolean> {
        const [freezeStdout]: [string, string, number | null] =
            await runCommand(this.log, this.venvPipExecutable, ['freeze'], undefined, true);
        const freeze: Record<string, string> = this.freezeStringToObject(freezeStdout);
        const requirements: Record<string, string> = this.freezeStringToObject(fs.readFileSync(this.pythonRequirementsPath).toString());
        for (const pkg in requirements) {
            if (freeze[pkg] !== requirements[pkg]) {
                return false;
            }
        }
        return true;
    }

    private async createVenv(): Promise<void> {
        const [stdout]: [string, string, number | null] =
            await runCommand(this.log, this.pythonExecutable, ['-m', 'venv', this.venvPath, '--clear'], undefined, true);
        if (stdout.includes('not created successfully') || !this.isVenvCreated()) {
            while (true) {
                this.log.error('virtualenv python module is not installed. If you have installed homebridge via the apt package manager, \
update the homebridge apt package to 1.1.4 or above (this applies for installations based on the Raspberry Pi OS image as well). When \
using the official docker image, update the image to version 2023-11-28 or above. Otherwise install the python virtualenv module \
manually.');
                await delay(300000);
            }
        } else if (stdout.trim() !== '') {
            this.log.warn(stdout);
        }
        this.log.success('Virtual python environment (re)created');
    }

    private ensurePluginDir(): void {
        if (!fs.existsSync(this.pluginDirPath)) {
            this.log.info('creating plugin dir ...');
            fs.mkdirSync(this.pluginDirPath);
            this.log.success('plugin dir created');
        } else {
            this.log.info('plugin dir exists.');
        }
    }

    private async ensurePythonVersion(): Promise<void> {
        const version: string = await this.getSystemPythonVersion();
        if (supportedPythonVersions.findIndex((e) => version.startsWith(e)) === -1) {
            while (true) {
                this.log.error(`Python ${version} is installed. However, only Python \
${supportedPythonVersions[0]} to ${supportedPythonVersions[supportedPythonVersions.length - 1]} is supported.`);
                await delay(300000);
            }
        } else {
            this.log.success(`Python ${version} is installed and supported by the plugin.`);
        }
    }

    private async ensureVenvCreated(forceVenvRecreate: boolean): Promise<void> {
        if (forceVenvRecreate) {
            this.log.warn('Forcing the python virtual environment to be recreated ...');
            await this.createVenv();
        } else if (this.isVenvCreated() === false) {
            this.log.info('Virtual python environment is not present. Creating now ...');
            await this.createVenv();
        } else if (this.isVenvExecutable() === false) {
            while (true) {
                this.log.error(`The current user ${UID}:${GID} does not have the permissions to execute the virtual python environment. \
Make sure the user has the permissions to execute the above mentioned files. \`chmod +x ./appletv-enhanced/.venv/bin/*\` should do the \
trick. Restart the plugin after fixing the permissions.`);
                await delay(300000);
            }
        } else {
            this.log.info('Virtual environment already exists.');
        }
    }

    private async ensureVenvPipUpToDate(): Promise<void> {
        const venvPipVersion: string = await this.getVenvPipVersion();
        this.log.info(`Venv pip version: ${venvPipVersion}`);
        this.log.info('Checking if there is an update for venv pip ...');
        if (venvPipVersion === await this.getMostRecentPipVersion()) {
            this.log.info('Venv pip is up to date');
        } else {
            this.log.warn('Venv pip is outdated. Updating now ...');
            const success: boolean = await this.updatePip();
            if (success === true) {
                this.log.success('Venv pip successfully updated.');
            } else {
                this.log.warn('Failed to update venv pip. Continuing anyhow ...');
            }
        }
    }

    private async ensureVenvRequirementsSatisfied(): Promise<void> {
        if (await this.areRequirementsSatisfied()) {
            this.log.info('Python requirements are satisfied.');
        } else {
            this.log.warn('Python requirements are not satisfied. Installing them now ...');
            const success: boolean = await this.installRequirements();
            if (success === true) {
                this.log.success('Python requirements successfully installed.');
            } else {
                while (true) {
                    this.log.error('There was an error installing the python dependencies. Cannot proceed!');
                    await delay(300000);
                }
            }
        }
        if (this.isPyatvExecutable() === false) {
            while (true) {
                this.log.error(`The current user ${UID}:${GID} does not have the permissions to execute the PyATV scripts. \
Make sure the user has the permissions to execute the above mentioned files. \`chmod +x ./appletv-enhanced/.venv/bin/*\` should do the \
trick. Restart the plugin after fixing the permissions.`);
                await delay(300000);
            }
        }
    }

    private async ensureVenvUsesCorrectPython(): Promise<void> {
        const systemPythonHome: string = await this.getPythonHome(this.pythonExecutable);
        this.log.debug(`System python home: ${systemPythonHome}`);
        const venvPythonHome: string = await this.getPythonHome(this.venvPythonExecutable);
        this.log.debug(`Venv python home: ${venvPythonHome}`);
        if (venvPythonHome !== systemPythonHome) {
            this.log.warn('The virtual environment does not use the configured python environment. Recreating virtual environment ...');
            await this.createVenv();
            return;
        }

        const systemPythonVersion: string = await this.getSystemPythonVersion();
        this.log.debug(`System python version: ${systemPythonVersion}`);
        const venvPythonVersion: string = this.getVenvPythonVersion();
        this.log.debug(`Venv python version: ${venvPythonVersion}`);
        if (systemPythonVersion !== venvPythonVersion) {
            this.log.warn('The virtual environment does not use the configured python environment. Recreating virtual environment ...');
            await this.createVenv();
            return;
        }

        this.log.info('Virtual environment is using the configured python environment. Continuing ...');
    }

    private freezeStringToObject(value: string): Record<string, string> {
        const lines: string[] = value.trim().split('\n');
        const packages: Record<string, string> = {};
        for (const line of lines) {
            const [pkg, version]: string[] = line.split('==');
            packages[pkg.replaceAll('_', '-')] = version;
        }
        return packages;
    }

    private async getMostRecentPipVersion(): Promise<string> {
        try {
            const response: AxiosResponse<{ info: { version: string } }, unknown> = await axios.get('https://pypi.org/pypi/pip/json');
            return response.data.info.version;
        } catch (e) {
            this.log.error(e as string);
            return 'error';
        }
    }

    private getPythonExecutable(defaultsTo: string, customPythonExecutable: string | undefined): string {
        if (customPythonExecutable === undefined) {
            this.log.debug('Using the systems default python installation since there is no custom python installation specified.');
            return defaultsTo;
        }

        const pythonCandidate: string | undefined = normalizePath(customPythonExecutable);
        if (pythonCandidate === undefined) {
            this.log.warn(`Could not normalize the python executable path ${pythonCandidate}. Falling back to the systems default python \
installation.`);
            return defaultsTo;
        }
        if (fs.existsSync(pythonCandidate)) {
            this.log.debug(`The specified python installation "${pythonCandidate}" does exist.`);
            try {
                fs.accessSync(pythonCandidate, fs.constants.X_OK);
                this.log.debug(`The current user ${UID}:${GID} has the permissions to execute "${pythonCandidate}".`);
            } catch {
                this.log.warn(`The current user ${UID}:${GID} does not have the permissions to execute "${pythonCandidate}". Falling back \
to the systems default python installation.`);
                return defaultsTo;
            }
            this.log.debug(`Using the specified python installation "${pythonCandidate}".`);
            return pythonCandidate;
        }

        this.log.warn(`The python executable "${pythonCandidate}" set in the configuration does not exist. Falling back to the \
systems default python installation.`);
        return defaultsTo;
    }

    private async getPythonHome(executable: string): Promise<string> {
        const [venvPythonHome]: [string, string, number | null] =
            await runCommand(this.log, executable, [path.join(__dirname, 'determinePythonHome.py')], undefined, true);
        return venvPythonHome.trim();
    }

    private async getSystemPythonVersion(): Promise<string> {
        const [version]: [string, string, number | null] =
            await runCommand(this.log, this.pythonExecutable, ['--version'], undefined, true);
        return version.trim().replace('Python ', '');
    }

    private async getVenvPipVersion(): Promise<string> {
        const [version]: [string, string, number | null] =
            await runCommand(this.log, this.venvPipExecutable, ['--version'], undefined, true);
        return version.trim().replace('pip ', '').split(' ')[0];
    }

    private getVenvPythonVersion(): string {
        const pyvenvcfgContent: string = fs.readFileSync(this.venvConfigPath, 'utf-8');
        const lines: string[] = pyvenvcfgContent.split('\n');
        const versionLine: string | undefined = lines.find((e) => e.startsWith('version'));
        if (versionLine === undefined) {
            return '?';
        }
        return versionLine.replace('version', '').replace('=', '').trim();
    }

    private async installRequirements(): Promise<boolean> {
        return (await runCommand(this.log, this.venvPipExecutable, ['install', '-r', this.pythonRequirementsPath])).at(2) === 0;
    }

    private isPyatvExecutable(): boolean {
        let success: boolean = true;

        for (const f of [
            this.venvAtvremoteExecutable,
            this.venvAtvscriptExecutable,
        ]) {
            try {
                fs.accessSync(f, fs.constants.X_OK);
            } catch {
                this.log.warn(`The current user ${UID}:${GID} does not have the permissions to execute "${f}".`);
                success = false;
            }
        }

        return success;
    }

    private isVenvCreated(): boolean {
        let success: boolean = true;

        for (const f of [
            this.venvConfigPath,
            this.venvPythonExecutable,
            this.venvPipExecutable,
        ]) {
            if (fs.existsSync(f) === false) {
                this.log.debug(`${f} does not exist --> venv is not present`);
                success = false;
            }
        }

        return success;
    }

    private isVenvExecutable(): boolean {
        let success: boolean = true;

        for (const f of [
            this.venvPythonExecutable,
            this.venvPipExecutable,
        ]) {
            try {
                fs.accessSync(f, fs.constants.X_OK);
            } catch {
                this.log.warn(`The current user ${UID}:${GID} does not have the permissions to execute "${f}".`);
                success = false;
            }
        }

        return success;
    }

    private async openSSL(): Promise<void> {
        const [openSSLVersionString]: [string, string, number | null] =
            await runCommand(this.log, 'openssl', ['version'], undefined, true);
        const r: RegExpMatchArray | null = openSSLVersionString.match(/\d+\.\d+\.\d+/);
        if (r !== null && compareVersions(MIN_OPENSSL_VERSION, r[0]) !== 1) {
            this.log.success(`OpenSSL ${r[0]} is installed and compatible.`);
            return;
        }
        if (r === null) {
            this.log.warn(`Could not verify that the correct OpenSSL version is installed. The plugin will continue to start but errors \
can occur if the OpenSSL version is older than ${MIN_OPENSSL_VERSION}.`);
        } else {
            while (true) {
                this.log.error(`You are using OpenSSL ${r[0]}. However, OpenSSL ${MIN_OPENSSL_VERSION} or later is required for AppleTV \
Enhanced. This has been a requirement for a long time. Up until now the plugin was starting in a "legacy openssl mode" if that \
requirement was not met. TvOS 18.4 requires a fix for pyatv which is only available in the newest version of pyatv that requires \
OpenSSL ${MIN_OPENSSL_VERSION}. Thus, the legacy mode cannot be provided any longer as it requires an older version of pyatv. If you \
wonder why this fix is required, please refer to https://github.com/maxileith/homebridge-appletv-enhanced/issues/953.`);
                await delay(300000);
            }
        }
    }

    private async updateApiPy(): Promise<void> {
        this.log.info('Downloading a temporary fix for the TvOS 18.4 connection issue. Refer to this GitHub issue for more information: \
https://github.com/maxileith/homebridge-appletv-enhanced/issues/953');

        // download Api.py
        let response: AxiosResponse | undefined = undefined;
        try {
            response = await axios.get('https://raw.githubusercontent.com/postlund/pyatv/3fe8e36caf1977d2c7dced4767ada12c95a3e7c3/pyatv/\
protocols/companion/api.py', { timeout: 30000 }) as AxiosResponse;
            this.log.success('Successfully downloaded the fix');
            this.log.debug(`\n${response.data}`);
        } catch (e: unknown) {
            if (e instanceof Error) {
                this.log.warn(`Failed to download the fix, continuing without downloading the fix. (${e.name}: ${e.message})`);
                return;
            } else {
                throw e;
            }
        }

        // write Api.pyconst requirementsPath: string =
        this.log.info('Installing the fix');
        const libPath: string = path.join(this.venvPath, 'lib');
        const pythonDir: Dirent | undefined = fs.readdirSync(libPath, { withFileTypes: true }).find((e) => e.isDirectory());
        if (pythonDir === undefined) {
            this.log.warn('Failed to determine the location where the fix needs to be installed. Continuing without installing the fix.');
            return;
        }
        const apiPyPath: string = path.join(libPath, pythonDir.name, 'site-packages', 'pyatv', 'protocols', 'companion', 'api.py');
        if (fs.existsSync(apiPyPath)) {
            fs.writeFileSync(apiPyPath, response.data, { encoding: 'utf8', flag: 'w' });
            this.log.success('Successfully installed the fix');
        } else {
            this.log.warn('Failed to determine the location where the fix needs to be installed. Continuing without installing the fix.');
        }
    }

    private async updatePip(): Promise<boolean> {
        return (await runCommand(this.log, this.venvPipExecutable, ['install', '--upgrade', 'pip'])).at(2) === 0;
    }
}

export default PythonChecker;
