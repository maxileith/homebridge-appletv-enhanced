import os from 'os';

export default function checkOs(logInfo: (message: string) => void, logWarn: (message: string) => void): void {
    const platform: string = os.platform() === 'darwin' ? 'MacOS' : os.platform();
    if (platform !== 'linux') {
        logWarn(`\n\
██     ██  █████  ██████  ███    ██ ██ ███    ██  ██████  
██     ██ ██   ██ ██   ██ ████   ██ ██ ████   ██ ██       
██  █  ██ ███████ ██████  ██ ██  ██ ██ ██ ██  ██ ██   ███ 
██ ███ ██ ██   ██ ██   ██ ██  ██ ██ ██ ██  ██ ██ ██    ██ 
 ███ ███  ██   ██ ██   ██ ██   ████ ██ ██   ████  ██████

'${platform} ${os.release()}' is not supported by the plugin Homebridge Apple TV Enhanced. You will likely \
experience problems. However, you may get the plugin to work on your system.`);
    } else {
        logInfo(`'${platform} ${os.release()}' is supported by the plugin Homebridge Apple TV Enhanced.`);
    }
}
