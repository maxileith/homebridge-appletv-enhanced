/* eslint-disable no-console */
import path from 'path';
import fs from 'fs';
import os from 'os';
import { SpawnOptionsWithoutStdio, spawn } from 'child_process';

const toStdout = (data) => {
    process.stdout.write(data);
};
const toStderr = (data) => {
    process.stderr.write(data);
};

const COMMON_HOMEBRIDGE_DIRS = [
    '/var/lib/homebridge',
    path.join(os.homedir(), '.homebridge'),
    '/homebridge',
    '/volume1/homebridge',
];

function getHomebridgeDir(): string {
    for (const dir of COMMON_HOMEBRIDGE_DIRS) {
        if (fs.existsSync(dir)) {
            return dir;
        }
    }
    throw new Error('cannot find homebridge storage path');
}

function createProcess(command: string, args?: readonly string[] | undefined, options?: SpawnOptionsWithoutStdio | undefined) {
    const p = spawn(command, args, options);
    p.stdout.setEncoding('utf8');
    p.stdout.on('data', toStdout);
    p.stderr.setEncoding('utf8');
    p.stderr.on('data', toStderr);
    return p;
}

const homebridgeDir = getHomebridgeDir();
const appleTVEnhancedDir = path.join(homebridgeDir, 'appletv-enhanced');
const venvDir = path.join(appleTVEnhancedDir, '.venv');
const pipDir = path.join(venvDir, 'bin', 'pip3');
const requirementsDir = path.join(__dirname, 'requirements.txt');
if (!fs.existsSync(appleTVEnhancedDir)){
    fs.mkdirSync(appleTVEnhancedDir);
}

createVenv();

async function createVenv(): Promise<void> {
    console.log('Creating a python virtual environment ...');
    const p = createProcess('python3', ['-m', 'venv', venvDir, '--clear']);
    await p.on('close', () => upgradePip());
}

async function upgradePip(): Promise<void> {
    console.log('\nUpgrading pip ...');
    const p = createProcess(pipDir, ['install', '--upgrade', 'pip']);
    await p.on('close', () => installPyatv());
}

async function installPyatv(): Promise<void> {
    console.log('\nInstalling Python packages ...');
    const p = createProcess(pipDir, ['install', '-r', requirementsDir]);
    await p.on('close', () => finalize());
}

async function finalize(): Promise<void> {
    console.log('\nPostinstall finished.');
}

