import { Logger } from 'homebridge';
import path from 'path';
import fs from 'fs';
import { SpawnOptionsWithoutStdio, spawn } from 'child_process';
import { delay } from './utils';

class PythonUpdater {

    private readonly log: Logger;

    private readonly pluginDirPath: string;
    private readonly venvPath: string;
    private readonly venvPythonPath: string;
    private readonly venvPipPath: string;
    private readonly requirementsPath: string = path.join(__dirname, 'requirements.txt');

    constructor(logger: Logger, storagePath: string) {
        this.log = logger;
        this.pluginDirPath = path.join(storagePath, 'appletv-enhanced');
        this.venvPath = path.join(this.pluginDirPath, '.venv');
        this.venvPythonPath = path.join(this.venvPath, 'bin', 'python3');
        this.venvPipPath = path.join(this.venvPath, 'bin', 'pip3');
    }

    public async allInOne(): Promise<void> {
        this.log.info('Python checkup: Starting python checkup.');
        this.ensurePluginDir();
        await this.ensureVenv();
        await this.ensurePipUpToDate();
        await this.ensureRequirementsSatisfied();
        this.log.info('Python checkup: Finished');
    }

    private ensurePluginDir(): void {
        if (!fs.existsSync(this.pluginDirPath)) {
            fs.mkdirSync(this.pluginDirPath);
            this.log.info('Python checkup: plugin dir created.');
        } else {
            this.log.debug('Python checkup: plugin dir exists.');
        }
    }

    private async ensureVenv() {
        if (this.isVenvCreated()) {
            this.log.debug('Python checkup: Virtual environment already exists.');
        } else {
            this.log.info('Python checkup: Virtual python environment is not present. Creating now ...');
            await this.createVenv();
        }
    }

    private isVenvCreated(): boolean {
        return fs.existsSync(this.venvPythonPath);
    }

    private async createVenv(): Promise<void> {
        await this.runCommand('python3', ['-m', 'venv', this.venvPath, '--clear']);
    }

    private async ensureRequirementsSatisfied(): Promise<void> {
        if (await this.areRequirementsSatisfied()) {
            this.log.debug('Python checkup: Python requirements are satisfied.');
        } else {
            this.log.info('Python checkup: Python requirements are not satisfied. Installing them now.');
            await this.installRequirements();
        }
    }

    private async ensurePipUpToDate(): Promise<void> {
        if (await this.isPipUpToDate()) {
            this.log.debug('Python checkup: Pip is up-to-date');
        } else {
            this.log.info('Python checkup: Pip is outdated. Updating now ...');
            await this.updatePip();
        }
    }

    private async isPipUpToDate(): Promise<boolean> {
        const [, stderr] = await this.runCommand(this.venvPipPath, ['list', '--outdated'], undefined, true);
        return !stderr.includes('A new release of pip is available');
    }

    private async updatePip(): Promise<void> {
        await this.runCommand(this.venvPipPath, ['install', '--upgrade', 'pip']);
    }

    private async areRequirementsSatisfied(): Promise<boolean> {
        const [freeze] = await this.runCommand(this.venvPipPath, ['freeze'], undefined, true);
        const requirements = fs.readFileSync(this.requirementsPath).toString();
        return freeze === requirements;
    }

    private async installRequirements(): Promise<void> {
        await this.runCommand(this.venvPipPath, ['install', '-r', this.requirementsPath]);
    }

    private async runCommand(
        command: string,
        args?: readonly string[] | undefined,
        options?: SpawnOptionsWithoutStdio | undefined,
        hideOutput: boolean = false,
    ): Promise<[string, string]> {
        let running = true;
        let stdout: string = '';
        let stderr: string = '';

        const p = spawn(command, args, options);
        p.stdout.setEncoding('utf8');
        p.stdout.on('data', (data: string) => {
            stdout += data;
            if (!hideOutput) {
                this.log.info(data.replaceAll('\n', ''));
            }
        });
        p.stderr.setEncoding('utf8');
        p.stderr.on('data', (data: string) => {
            stderr += data;
            if (!hideOutput) {
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

export default PythonUpdater;