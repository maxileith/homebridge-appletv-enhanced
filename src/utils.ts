import { networkInterfaces } from 'os';

export function capitalizeFirstLetter(value: string): string {
    return value.charAt(0).toUpperCase() + value.slice(1);
}

export const delay = (ms: number) => new Promise(res => setTimeout(res, ms));

export function getLocalIP(): string {
    const interfaces = networkInterfaces();
    for (const k in interfaces) {
        const networkInterface = interfaces[k]!;
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

export function removeSpecialCharacters(str: string): string {
    return str.replace(/[^a-zA-Z0-9 ]/g, '').trim();
}

export function camelCaseToTitleCase(str: string): string {
    const result = str.replace(/([A-Z])/g, ' $1');
    return result.charAt(0).toUpperCase() + result.slice(1);
}
