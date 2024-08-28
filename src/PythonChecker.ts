import path from 'path';
import fs from 'fs';
import { delay, runCommand } from './utils';
import PrefixLogger from './PrefixLogger';
import type LogLevelLogger from './LogLevelLogger';
import type { AxiosResponse } from 'axios';
import axios from 'axios';
import { compareVersions } from 'compare-versions';

const SUPPORTED_PYTHON_VERSIONS: string[] = [
    '3.8',
    '3.9',
    '3.10',
    '3.11',
    '3.12',
];

const MIN_OPENSSL_VERSION: string = '3.0.0';

class PythonChecker {

    private readonly log: PrefixLogger;

    private readonly pluginDirPath: string;
    private readonly pythonExecutable: string;
    private readonly requirementsPath: string = path.join(__dirname, '..', 'requirements.txt');
    private readonly venvConfigPath: string;
    private readonly venvPath: string;
    private readonly venvPipExecutable: string;
    private readonly venvPythonExecutable: string;

    public constructor(logger: LogLevelLogger | PrefixLogger, storagePath: string, pythonExecutable?: string) {
        this.log = new PrefixLogger(logger, 'Python check');

        this.pythonExecutable = pythonExecutable ?? 'python3';
        this.log.debug(`Using ${this.pythonExecutable} as the python executable`);

        this.pluginDirPath = path.join(storagePath, 'appletv-enhanced');
        this.venvPath = path.join(this.pluginDirPath, '.venv');
        this.venvPythonExecutable = path.join(this.venvPath, 'bin', 'python3');
        this.venvPipExecutable = path.join(this.venvPath, 'bin', 'pip3');
        this.venvConfigPath = path.join(this.venvPath, 'pyvenv.cfg');
    }

    public async allInOne(forceVenvRecreate: boolean = false): Promise<void> {
        this.log.info('Starting python check.');
        this.ensurePluginDir();
        await this.ensurePythonVersion();
        await this.ensureVenvCreated(forceVenvRecreate);
        await this.ensureVenvUsesCorrectPythonHome();
        await this.ensureVenvPipUpToDate();
        await this.ensureVenvRequirementsSatisfied();
        await this.ensureOpenSSLVersion();
        this.log.info('Finished');
    }

    private async areRequirementsSatisfied(): Promise<boolean> {
        const [freezeStdout]: [string, string, number | null] =
            await runCommand(this.log, this.venvPipExecutable, ['freeze'], undefined, true);
        const freeze: Record<string, string> = this.freezeStringToObject(freezeStdout);
        const requirements: Record<string, string> = this.freezeStringToObject(fs.readFileSync(this.requirementsPath).toString());
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

    private async ensureOpenSSLVersion(): Promise<void> {
        const [openSSLVersionString]: [string, string, number | null] =
            await runCommand(this.log, 'openssl', ['version'], undefined, true);
        const r: RegExpMatchArray | null = openSSLVersionString.match(/\d+\.\d+\.\d+/)
        if (r === null) {
            this.log.warn(`Could not verify that the correct OpenSSL version is installed. Continuing ... however, be aware that you \
might experience problems if an incompatible version is installed. OpenSSL ${MIN_OPENSSL_VERSION} or later is required.`)
            return;
        }
        if (compareVersions(MIN_OPENSSL_VERSION, r[0]) === 1) {
            while (true) {
                this.log.error(`You are using OpenSSL ${r[0]}. However, OpenSSL ${MIN_OPENSSL_VERSION} or later is required. Restart the \
plugin after updating OpenSSL.`);
                await delay(300000);
            }
        }
        this.log.info(`OpenSSL ${r[0]} is installed and compatible.`);
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
        if (SUPPORTED_PYTHON_VERSIONS.findIndex((e) => version.includes(e)) === -1) {
            while (true) {
                this.log.error(`Python ${version} is installed. However, only Python \
${SUPPORTED_PYTHON_VERSIONS[0]} to ${SUPPORTED_PYTHON_VERSIONS[SUPPORTED_PYTHON_VERSIONS.length - 1]} is supported.`);
                await delay(300000);
            }
        } else {
            this.log.info(`Python ${version} is installed and supported by the plugin.`);
        }
    }

    private async ensureVenvCreated(forceVenvRecreate: boolean): Promise<void> {
        if (forceVenvRecreate) {
            this.log.warn('Forcing the python virtual environment to be recreated ...');
            await this.createVenv();
        } else if (this.isVenvCreated() === false) {
            this.log.info('Virtual python environment is not present. Creating now ...');
            await this.createVenv();
        } else {
            this.log.info('Virtual environment already exists.');
        }
    }

    private async ensureVenvPipUpToDate(): Promise<void> {
        const venvPipVersion: string = await this.getVenvPipVersion();
        this.log.info(`Venv pip version: ${venvPipVersion}`);
        this.log.info('Checking if there is an update for venv pip ...');
        if (venvPipVersion === await this.getMostRecentPipVersion()) {
            this.log.info('Venv pip is up-to-date');
        } else {
            this.log.warn('Venv pip is outdated. Updating now ...');
            await this.updatePip();
            this.log.success('Venv pip updated');
        }
    }

    private async ensureVenvRequirementsSatisfied(): Promise<void> {
        if (await this.areRequirementsSatisfied()) {
            this.log.info('Python requirements are satisfied.');
        } else {
            this.log.warn('Python requirements are not satisfied. Installing them now ...');
            await this.installRequirements();
        }
    }

    private async ensureVenvUsesCorrectPythonHome(): Promise<void> {
        const venvPythonHome: string = await this.getPythonHome(this.venvPythonExecutable);
        const pythonHome: string = await this.getPythonHome(this.pythonExecutable);
        if (venvPythonHome !== pythonHome) {
            this.log.warn('The virtual environment does not use the systems default python environment. Recreating virtual \
environment ...');
            this.log.debug(`System Python ${pythonHome}; Venv Python ${venvPythonHome}`);
            await this.createVenv();
        } else {
            this.log.info('Virtual environment is using the systems default python environment. Continuing ...');
        }
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

    private async installRequirements(): Promise<void> {
        await runCommand(this.log, this.venvPipExecutable, ['install', '-r', this.requirementsPath]);
        this.log.success('Python requirements installed.');
    }

    private isVenvCreated(): boolean {
        return fs.existsSync(this.venvPipExecutable) &&
            fs.existsSync(this.venvConfigPath) &&
            fs.existsSync(this.venvPythonExecutable);
    }

    private async updatePip(): Promise<void> {
        await runCommand(this.log, this.venvPipExecutable, ['install', '--upgrade', 'pip']);
    }
}

export default PythonChecker;