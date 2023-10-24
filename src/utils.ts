import { networkInterfaces } from 'os';

export function capitalizeFirstLetter(value: string): string {
    return value.charAt(0).toUpperCase() + value.slice(1);
}

export const delay = ms => new Promise(res => setTimeout(res, ms));

export function getLocalIPs(): string[] {
    const localIPs: string[] = [];
    const interfaces = networkInterfaces();
    for (const k in interfaces) {
        const networkInterface = interfaces[k]!;
        for (const info of networkInterface) {
            if (!info.internal && info.family === 'IPv4') {
                localIPs.push(info.address);
            }
        }
    }
    return localIPs;
}