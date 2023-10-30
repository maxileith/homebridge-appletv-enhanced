import { Logger } from 'homebridge';
import path from 'path';
import fs from 'fs';
import { SpawnOptionsWithoutStdio, spawn } from 'child_process';
import { delay } from './utils';

const SUPPORTED_PYTHON_VERSIONS = [
    'Python 3.8',
    'Python 3.9',
    'Python 3.10',
    'Python 3.11',
];

class PythonChecker {

    private readonly log: Logger;

    private readonly pluginDirPath: string;
    private readonly venvPath: string;
    private readonly venvPipPath: string;
    private readonly requirementsPath: string = path.join(__dirname, 'requirements.txt');

    constructor(logger: Logger, storagePath: string) {
        this.log = logger;
        this.pluginDirPath = path.join(storagePath, 'appletv-enhanced');
        this.venvPath = path.join(this.pluginDirPath, '.venv');
        this.venvPipPath = path.join(this.venvPath, 'bin', 'pip3');
    }

    public async allInOne(): Promise<void> {
        this.log.info('Python check: Starting python check.');
        this.ensurePluginDir();
        await this.ensurePythonVersion();
        await this.ensureVenv();
        await this.ensurePipUpToDate();
        await this.ensureRequirementsSatisfied();
        this.log.info('Python check: Finished');
    }

    private ensurePluginDir(): void {
        if (!fs.existsSync(this.pluginDirPath)) {
            this.log.info('Python check: creating plugin dir ...');
            fs.mkdirSync(this.pluginDirPath);
        } else {
            this.log.info('Python check: plugin dir exists.');
        }
    }

    private async ensurePythonVersion() {
        let [version] = await this.runCommand('python3', ['--version'], undefined, true);
        version = version.trim();
        if (SUPPORTED_PYTHON_VERSIONS.findIndex((e) => version.includes(e)) === -1) {
            // eslint-disable-next-line no-constant-condition
            while (true) {
                this.log.error(`Python check: ${version} is installed. However, only \
${SUPPORTED_PYTHON_VERSIONS[0]} to ${SUPPORTED_PYTHON_VERSIONS[SUPPORTED_PYTHON_VERSIONS.length - 1]} is supported.`);
                await delay(60000);
            }
        } else {
            this.log.info(`Python check: ${version} is installed and supported by the plugin.`);
        }
    }

    private async ensureVenv() {
        if (this.isVenvCreated()) {
            this.log.info('Python check: Virtual environment already exists.');
        } else {
            this.log.info('Python check: Virtual python environment is not present. Creating now ...');
            await this.createVenv();
        }
    }

    private isVenvCreated(): boolean {
        return fs.existsSync(this.venvPipPath);
    }

    private async createVenv(): Promise<void> {
        const [stdout] = await this.runCommand('python3', ['-m', 'venv', this.venvPath, '--clear'], undefined, true);
        if (stdout.includes('not created successfully')) {
            // eslint-disable-next-line no-constant-condition
            while (true) {
                this.log.error('Python check: virtualenv python module is not installed. You need to install the \
python package virtualenv either by using \'python3 -m pip install virutalenv\' or installing it via system packages. \
On debian based distributions this is usally \'sudo apt install python3-venv\'');
                await delay(60000);
            }
        } else if (stdout.trim() !== '') {
            this.log.warn(stdout);
        }
    }

    private async ensureRequirementsSatisfied(): Promise<void> {
        if (await this.areRequirementsSatisfied()) {
            this.log.info('Python check: Python requirements are satisfied.');
        } else {
            this.log.info('Python check: Python requirements are not satisfied. Installing them now.');
            await this.installRequirements();
        }
    }

    private async ensurePipUpToDate(): Promise<void> {
        if (await this.isPipUpToDate()) {
            this.log.info('Python check: Pip is up-to-date');
        } else {
            this.log.info('Python check: Pip is outdated. Updating now ...');
            await this.updatePip();
        }
    }

    private async isPipUpToDate(): Promise<boolean> {
        const [, stderr] = await this.runCommand(this.venvPipPath, ['list', '--outdated'], undefined, true, true);
        return !stderr.includes('pip ');
    }

    private async updatePip(): Promise<void> {
        await this.runCommand(this.venvPipPath, ['install', '--upgrade', 'pip']);
    }

    private async areRequirementsSatisfied(): Promise<boolean> {
        const [freeze] = await this.runCommand(this.venvPipPath, ['freeze'], undefined, true);
        const requirements = fs.readFileSync(this.requirementsPath).toString();
        return freeze.trim().replaceAll('-', '_') === requirements.trim().replaceAll('-', '_');
    }

    private async installRequirements(): Promise<void> {
        await this.runCommand(this.venvPipPath, ['install', '-r', this.requirementsPath]);
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
                this.log.error(data.replaceAll('\n', ''));
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