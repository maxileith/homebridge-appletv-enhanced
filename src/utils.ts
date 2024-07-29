import type { ChildProcessWithoutNullStreams } from 'child_process';
import { type SpawnOptionsWithoutStdio, spawn } from 'child_process';
import { networkInterfaces } from 'os';
import type { NetworkInterfaceInfo } from 'os';
import type PrefixLogger from './PrefixLogger';
import type LogLevelLogger from './LogLevelLogger';

export function capitalizeFirstLetter(value: string): string {
    return value.charAt(0).toUpperCase() + value.slice(1);
}

export const delay = (ms: number): Promise<void> => new Promise<void>(res => setTimeout(res, ms));

export function getLocalIP(): string {
    const interfaces: NodeJS.Dict<NetworkInterfaceInfo[]> = networkInterfaces();
    for (const k in interfaces) {
        const networkInterface: NetworkInterfaceInfo[] = interfaces[k]!;
        for (const info of networkInterface) {
            if (!info.internal && info.family === 'IPv4') {
                return info.address;
            }
        }
    }
    return 'homebridge.local';
}

export function trimToMaxLength(value: string, maxLength: number): string {
    if (value.length <= maxLength) {
        return value;
    } else {
        return value.substring(0, maxLength);
    }
}

export function removeSpecialCharacters(str: string): string {
    return str.replace(/[^\p{L}\p{N} ']/gu, '').replace(/\s{2,}/g, ' ').trim();
}

export function snakeCaseToTitleCase(str: string): string {
    return str
        .replace(/^[-_]*(.)/, (_, c: string) => c.toUpperCase()) // Initial char (after -/_)
        .replace(/[-_]+(.)/g, (_, c: string) => ' ' + c.toUpperCase()); // First char after each -/_
}

export async function runCommand(
    logger: LogLevelLogger | PrefixLogger,
    command: string,
    args?: readonly string[],
    options?: SpawnOptionsWithoutStdio,
    hideStdout: boolean = false,
    hideStderr: boolean = false,
): Promise<[string, string, number | null]> {
    let running: boolean = true;
    let stdout: string = '';
    let stderr: string = '';

    const p: ChildProcessWithoutNullStreams = spawn(command, args, options);
    p.stdout.setEncoding('utf8');
    p.stdout.on('data', (data: string) => {
        stdout += data;
        data = data.trim();
        if (!hideStdout && data !== '') {
            logger.info(data);
        }
    });
    p.stderr.setEncoding('utf8');
    p.stderr.on('data', (data: string) => {
        stderr += data;
        if (!hideStderr) {
            if (data.startsWith('WARNING')) {
                logger.warn(data.replaceAll('\n', ''));
            } else {
                logger.error(data);
            }
        }
    });
    p.on('close', () => {
        running = false;
    });

    while (running) {
        await delay(100);
    }

    return [stdout, stderr, p.exitCode];
}
