import os from 'os';

export default function checkOs(logInfo: (message: string) => void, logWarn: (message: string) => void): void {
    if (os.platform() !== 'linux') {
        logWarn(`\n\
██     ██  █████  ██████  ███    ██ ██ ███    ██  ██████  
██     ██ ██   ██ ██   ██ ████   ██ ██ ████   ██ ██       
██  █  ██ ███████ ██████  ██ ██  ██ ██ ██ ██  ██ ██   ███ 
██ ███ ██ ██   ██ ██   ██ ██  ██ ██ ██ ██  ██ ██ ██    ██ 
 ███ ███  ██   ██ ██   ██ ██   ████ ██ ██   ████  ██████

'${os.platform()} ${os.release()}' is not supported by the plugin Homebridge Apple TV Enhanced. You will likely \
experience problems. However, you may get the plugin to work on your system.`);
    } else {
        logInfo(`\x1b[32m'${os.platform()} ${os.release()}' is supported by the plugin Homebridge Apple TV.\x1b[0m`);
    }
}
