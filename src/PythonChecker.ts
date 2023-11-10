import { Logger } from 'homebridge';
import path from 'path';
import fs from 'fs';
import { SpawnOptionsWithoutStdio, spawn } from 'child_process';
import { delay } from './utils';
import PrefixLogger from './PrefixLogger';

const SUPPORTED_PYTHON_VERSIONS = [
    '3.8',
    '3.9',
    '3.10',
    '3.11',
];

class PythonChecker {

    private readonly log: PrefixLogger;

    private readonly pluginDirPath: string;
    private readonly venvPath: string;
    private readonly venvPipPath: string;
    private readonly venvPythonPath: string;
    private readonly venvConfigPath: string;
    private readonly requirementsPath: string = path.join(__dirname, '..', 'requirements.txt');

    constructor(logger: Logger, storagePath: string) {
        this.log = new PrefixLogger(logger, 'Python check');

        this.pluginDirPath = path.join(storagePath, 'appletv-enhanced');
        this.venvPath = path.join(this.pluginDirPath, '.venv');
        this.venvPythonPath = path.join(this.venvPath, 'bin', 'python3');
        this.venvPipPath = path.join(this.venvPath, 'bin', 'pip3');
        this.venvConfigPath = path.join(this.venvPath, 'pyvenv.cfg');
    }

    public async allInOne(forceVenvRecreate: boolean = false): Promise<void> {
        this.log.info('Starting python check.');
        this.ensurePluginDir();
        await this.ensurePythonVersion();
        await this.ensureVenvCreated(forceVenvRecreate);
        await this.ensureVenvPipUpToDate();
        await this.ensureVenvRequirementsSatisfied();
        this.log.info('Finished');
    }

    private ensurePluginDir(): void {
        if (!fs.existsSync(this.pluginDirPath)) {
            this.log.warn('creating plugin dir ...');
            fs.mkdirSync(this.pluginDirPath);
        } else {
            this.log.info('plugin dir exists.');
        }
    }

    private async ensurePythonVersion() {
        const version = await this.getSystemPythonVersion();
        if (SUPPORTED_PYTHON_VERSIONS.findIndex((e) => version.includes(e)) === -1) {
            // eslint-disable-next-line no-constant-condition
            while (true) {
                this.log.error(`${version} is installed. However, only Python \
${SUPPORTED_PYTHON_VERSIONS[0]} to ${SUPPORTED_PYTHON_VERSIONS[SUPPORTED_PYTHON_VERSIONS.length - 1]} is supported.`);
                await delay(120000);
            }
        } else {
            this.log.info(`Python ${version} is installed and supported by the plugin.`);
        }
    }

    private async ensureVenvCreated(forceVenvRecreate: boolean) {
        if (forceVenvRecreate === false && this.isVenvCreated()) {
            this.log.info('Virtual environment already exists.');
            const [venvVersionIsSystemVersion, systemVersion, venvVersion] = await this.isVenvPythonSystemPython();
            if (venvVersionIsSystemVersion) {
                this.log.info(`Venv is using current system python version (${systemVersion}).`);
            } else {
                this.log.warn(`Venv (${venvVersion}) is not using current system python version (${systemVersion}). Recreating the virtual environment now ...`);
                await this.createVenv();
            }
        } else {
            if (forceVenvRecreate) {
                this.log.warn('Forcing the python virtual environment to be recreated ...');
            } else {
                this.log.warn('Virtual python environment is not present. Creating now ...');
            }
            await this.createVenv();
        }
    }

    private isVenvCreated(): boolean {
        return fs.existsSync(this.venvPipPath) &&
            fs.existsSync(this.venvConfigPath) &&
            fs.existsSync(this.venvPythonPath);
    }

    private async isVenvPythonSystemPython(): Promise<[boolean, string, string]> {
        const fileContent = fs.readFileSync(this.venvConfigPath).toString().replaceAll(' ', '');
        const venvVersion = fileContent.split('version=')[1].split('\n')[0];
        const systemVersion = await this.getSystemPythonVersion();
        return [venvVersion === systemVersion, systemVersion, venvVersion];
    }

    private async createVenv(): Promise<void> {
        const [stdout] = await this.runCommand('python3', ['-m', 'venv', this.venvPath, '--clear'], undefined, true);
        if (stdout.includes('not created successfully') || !this.isVenvCreated()) {
            // eslint-disable-next-line no-constant-condition
            while (true) {
                this.log.error('virtualenv python module is not installed. You need to install the \
python package virtualenv either by using \'python3 -m pip install virutalenv\' or installing it via system packages. \
On debian based distributions this is usally \'sudo apt install python3-venv\'');
                await delay(60000);
            }
        } else if (stdout.trim() !== '') {
            this.log.warn(stdout);
        }
    }

    private async ensureVenvPipUpToDate(): Promise<void> {
        if (await this.isPipUpToDate()) {
            this.log.info('Pip is up-to-date');
        } else {
            this.log.warn('Pip is outdated. Updating now ...');
            await this.updatePip();
        }
    }

    private async isPipUpToDate(): Promise<boolean> {
        const [stdout, stderr] = await this.runCommand(this.venvPipPath, ['list', '--outdated'], undefined, true);
        return !stdout.includes('pip ') && !stderr.includes('A new release of pip is available');
    }

    private async updatePip(): Promise<void> {
        await this.runCommand(this.venvPipPath, ['install', '--upgrade', 'pip']);
    }

    private async ensureVenvRequirementsSatisfied(): Promise<void> {
        if (await this.areRequirementsSatisfied()) {
            this.log.info('Python requirements are satisfied.');
        } else {
            this.log.warn('Python requirements are not satisfied. Installing them now.');
            await this.installRequirements();
        }
    }

    private async areRequirementsSatisfied(): Promise<boolean> {
        const [freezeStdout] = await this.runCommand(this.venvPipPath, ['freeze'], undefined, true);
        const freeze = this.freezeStringToObject(freezeStdout);
        const requirements = this.freezeStringToObject(fs.readFileSync(this.requirementsPath).toString());
        for (const pkg in requirements) {
            if (freeze[pkg] !== requirements[pkg]) {
                return false;
            }
        }
        return true;
    }

    private freezeStringToObject(value: string): {[k: string]: string} {
        const lines = value.trim().split('\n');
        const packages: {[k: string]: string} = {};
        for (const line of lines) {
            const [pkg, version] = line.split('==');
            packages[pkg.replaceAll('_', '-')] = version;
        }
        return packages;
    }

    private async installRequirements(): Promise<void> {
        await this.runCommand(this.venvPipPath, ['install', '-r', this.requirementsPath]);
    }

    private async getSystemPythonVersion(): Promise<string> {
        const [version] = await this.runCommand('python3', ['--version'], undefined, true);
        return version.trim().replace('Python ', '');
    }

    private async runCommand(
        command: string,
        args?: readonly string[] | undefined,
        options?: SpawnOptionsWithoutStdio | undefined,
        hideStdout: boolean = false,
        hideStderr: boolean = false,
    ): Promise<[string, string]> {
        let running = true;
        let stdout: string = '';
        let stderr: string = '';

        const p = spawn(command, args, options);
        p.stdout.setEncoding('utf8');
        p.stdout.on('data', (data: string) => {
            stdout += data;
            if (!hideStdout) {
                this.log.info(data.replaceAll('\n', ''));
            }
        });
        p.stderr.setEncoding('utf8');
        p.stderr.on('data', (data: string) => {
            stderr += data;
            if (!hideStderr) {
                if (data.startsWith('WARNING')) {
                    this.log.warn(data.replaceAll('\n', ''));
                } else {
                    this.log.error(data);
                }
            }
        });
        p.on('close', () => {
            running = false;
        });

        while (running) {
            await delay(100);
        }

        return [stdout, stderr];
    }
}

export default PythonChecker;