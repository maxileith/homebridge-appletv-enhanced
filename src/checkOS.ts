/* eslint-disable no-console */
import os from 'os';

if (os.platform() !== 'linux') {
    console.error(`\x1b[33m\
██     ██  █████  ██████  ███    ██ ██ ███    ██  ██████  
██     ██ ██   ██ ██   ██ ████   ██ ██ ████   ██ ██       
██  █  ██ ███████ ██████  ██ ██  ██ ██ ██ ██  ██ ██   ███ 
██ ███ ██ ██   ██ ██   ██ ██  ██ ██ ██ ██  ██ ██ ██    ██ 
 ███ ███  ██   ██ ██   ██ ██   ████ ██ ██   ████  ██████

\x1b[31m'${os.platform()} ${os.release()}'\x1b[33m is not supported by the plugin Homebridge Apple TV \
Enhanced. You will likely experience problems. However, you may get the plugin to work on your system.\x1b[0m`);
} else {
    console.log(`\x1b[32m'${os.platform()} ${os.release()}' is supported by the plugin Homebridge Apple TV.\x1b[0m`);
}
