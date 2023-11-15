import { networkInterfaces } from 'os';
import type { NetworkInterfaceInfo } from 'os';

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

export function trimSpecialCharacters(value: string): string {
    while (value.length !== 0 && !/[a-zA-Z0-9]/.test(value.charAt(0))) {
        value = value.substring(1);
    }
    while (value.length !== 0 && !/[a-zA-Z0-9]/.test(value.charAt(value.length - 1))) {
        value = value.substring(0, value.length - 1);
    }
    if (value === '') {
        return 'to be named';
    }
    return value;
}

export function trimToMaxLength(value: string, maxLength: number): string {
    if (value.length <= maxLength) {
        return value;
    } else {
        return value.substring(0, maxLength);
    }
}

export function removeSpecialCharacters(str: string): string {
    return str.replace(/[^a-zA-Z0-9 ]/g, '').trim();
}

export function snakeCaseToTitleCase(str: string): string {
    return str
        .replace(/^[-_]*(.)/, (_, c: string) => c.toUpperCase()) // Initial char (after -/_)
        .replace(/[-_]+(.)/g, (_, c: string) => ' ' + c.toUpperCase()); // First char after each -/_
}
