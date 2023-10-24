import fs from 'fs';
import http, { IncomingMessage, ServerResponse } from 'http';
import { Service, PlatformAccessory, CharacteristicValue, Nullable, PrimitiveTypes } from 'homebridge';

import { AppleTVEnhancedPlatform } from './appleTVEnhancedPlatform';
import pyatvInstance, { ATVREMOTE_PATH } from './pyatvInstance';
import { NodePyATVDevice, NodePyATVDeviceEvent, NodePyATVDeviceState, NodePyATVMediaType, NodePyATVPowerState } from '@sebbo2002/node-pyatv';
import md5 from 'md5';
import { spawn } from 'child_process';

interface NodePyATVApp {
    id: string;
    name: string;
    launch: () => Promise<void>;
}

interface IInput {
    pyatvApp: NodePyATVApp;
    service: Service;
}


interface IInputs {
    [k: string]: IInput;
}

interface IAppConfig {
    configuredName: string;
    isConfigured: 0 | 1;
    visibilityState: 0 | 1;
    identifier: number;
}

interface IAppConfigs {
    [k: string]: IAppConfig;
}

interface ICommonConfig {
    configuredName?: string;
    activeIdentifier?: number;
}

interface IMediaConfigs {
    [k: string]: string;
}

interface IStateConfigs {
    [k: string]: string;
}

const SETTINGS_ID = 959656755;

const delay = ms => new Promise(res => setTimeout(res, ms));

/**
 * Platform Accessory
 * An instance of this class is created for each accessory your platform registers
 * Each accessory may expose multiple services of different service types.
 */
export class AppleTVEnhancedAccessory {
    private service: Service | undefined = undefined;
    private device: NodePyATVDevice;
    private inputs: IInputs = {};
    private deviceStateServices: { [k: string]: Service } = {};
    private mediaTypeServices: { [k: string]: Service } = {};

    private appConfigs: IAppConfigs | undefined = undefined;
    private commonConfig: ICommonConfig | undefined = undefined;

    private stateConfigs: IStateConfigs | undefined = undefined;
    private mediaConfigs: IMediaConfigs | undefined = undefined;

    private booted = false;

    constructor(
        private readonly platform: AppleTVEnhancedPlatform,
        private readonly accessory: PlatformAccessory,
    ) {
        this.device = pyatvInstance.deviceById(this.accessory.context.id as string);

        const credentials = this.getCredentials();
        if (credentials === '') {
            this.pair(this.device.host, this.device.name).then(() => this.startUp());
        } else {
            this.startUp();
        }
    }

    private async startUp(): Promise<void> {
        const credentials = this.getCredentials();

        this.device = pyatvInstance.device({
            host: this.device.host,
            name: this.device.name,
            id: this.device.id,
            airplayCredentials: credentials,
            companionCredentials: credentials,
        });

        this.accessory.category = this.platform.api.hap.Categories.TV_SET_TOP_BOX;

        // set accessory information
        this.accessory.getService(this.platform.Service.AccessoryInformation)!
            .setCharacteristic(this.platform.Characteristic.Manufacturer, 'Apple Inc.')
            .setCharacteristic(this.platform.Characteristic.Model, this.device.modelName!)
            .setCharacteristic(this.platform.Characteristic.SerialNumber, this.device.id!)
            .setCharacteristic(this.platform.Characteristic.Name, this.device.name)
            .setCharacteristic(this.platform.Characteristic.FirmwareRevision, this.device.version!);

        // create the service
        this.service = this.accessory.getService(this.platform.Service.Television) || this.accessory.addService(this.platform.Service.Television);
        this.service
            .setCharacteristic(this.platform.Characteristic.Active, this.platform.Characteristic.Active.INACTIVE)
            .setCharacteristic(this.platform.Characteristic.ActiveIdentifier, this.getCommonConfig().activeIdentifier || SETTINGS_ID)
            .setCharacteristic(this.platform.Characteristic.ConfiguredName, this.getCommonConfig().configuredName || this.accessory.displayName)
            .setCharacteristic(this.platform.Characteristic.SleepDiscoveryMode, this.platform.Characteristic.SleepDiscoveryMode.ALWAYS_DISCOVERABLE);
        // create handlers for required characteristics of the service
        this.service.getCharacteristic(this.platform.Characteristic.Active)
            .onGet(this.handleActiveGet.bind(this))
            .onSet(this.handleActiveSet.bind(this));
        this.service.getCharacteristic(this.platform.Characteristic.ActiveIdentifier)
            .onGet(this.handleActiveIdentifierGet.bind(this))
            .onSet(this.handleActiveIdentifierSet.bind(this));
        this.service.getCharacteristic(this.platform.Characteristic.ConfiguredName)
            .onGet(this.handleConfiguredNameGet.bind(this))
            .onSet(this.handleConfiguredNameSet.bind(this));
        this.service.getCharacteristic(this.platform.Characteristic.SleepDiscoveryMode)
            .onGet(this.handleSleepDiscoveryModeGet.bind(this));
        this.service.getCharacteristic(this.platform.Characteristic.RemoteKey)
            .onSet(this.handleRemoteKeySet.bind(this));
        // create listeners for updating the service
        this.device.on('update:powerState', this.handleActiveUpdate.bind(this));

        // create input services
        const apps = await this.device.listApps();
        this.createInputs(apps);
        // create listener to keep the current app up to date
        this.device.on('update:appId', this.handleInputUpdate.bind(this));

        // create device state motion sensors
        this.createDeviceStateSensors();
        // create listener to keep the current device state up to date
        this.device.on('update:deviceState', this.handleDeviceStateUpdate.bind(this));

        // create media type motion sensors
        this.createMediaTypeSensors();
        // create listener to keep the current media type up to date
        this.device.on('update:mediaType', this.handleMediaTypeUpdate.bind(this));

        // const updateListener = (event: NodePyATVDeviceEvent | Error) => {
        //     if (event instanceof Error || event.key === 'dateTime') {
        //         return;
        //     }
        //     this.platform.log.error(`   ${event.key}: ${event?.value} (was ${event?.oldValue})`);
        // };

        // this.device.on('update', updateListener);

        this.booted = true;
    }

    private createMediaTypeSensors(): void {
        const mediaTypes = Object.keys(NodePyATVMediaType);
        for (let i = 0; i < mediaTypes.length; i++) {
            const mediaType = mediaTypes[i];
            this.platform.log.info(`Adding media type ${mediaType} as a motion sensor.`);
            const s = this.accessory.getService(mediaType) || this.accessory.addService(this.platform.Service.MotionSensor, mediaType, mediaType)
                .setCharacteristic(this.platform.Characteristic.MotionDetected, false)
                .setCharacteristic(this.platform.Characteristic.Name, this.capitalizeFirstLetter(mediaType))
                .setCharacteristic(this.platform.Characteristic.ConfiguredName, this.getMediaConfig()[mediaType] || this.capitalizeFirstLetter(mediaType));
            s.getCharacteristic(this.platform.Characteristic.ConfiguredName)
                .onSet(async (value) => {
                    const oldConfiguredName = s.getCharacteristic(this.platform.Characteristic.ConfiguredName).value;
                    this.platform.log.info(`Changing configured name of media type sensor ${mediaType} from ${oldConfiguredName} to ${value}.`);
                    this.setMediaTypeConfig(mediaType, value as string);
                });
            this.service!.addLinkedService(s);
            this.mediaTypeServices[mediaType] = s;
        }
    }

    private async handleMediaTypeUpdate(event: NodePyATVDeviceEvent | Error): Promise<void> {
        if (event instanceof Error) {
            return;
        }
        this.platform.log.info(`New Media Type State: ${event.value}`);
        if (event.oldValue !== null) {
            const s = this.mediaTypeServices[event.oldValue];
            s.setCharacteristic(this.platform.Characteristic.MotionDetected, false);
        }
        if (event.value !== null) {
            const s = this.mediaTypeServices[event.value];
            s.setCharacteristic(this.platform.Characteristic.MotionDetected, true);
        }
    }

    private createDeviceStateSensors(): void {
        const deviceStates = Object.keys(NodePyATVDeviceState);
        for (let i = 0; i < deviceStates.length; i++) {
            const deviceState = deviceStates[i];
            this.platform.log.info(`Adding device state ${deviceState} as a motion sensor.`);
            const s = this.accessory.getService(deviceState) || this.accessory.addService(this.platform.Service.MotionSensor, deviceState, deviceState)
                .setCharacteristic(this.platform.Characteristic.MotionDetected, false)
                .setCharacteristic(this.platform.Characteristic.Name, this.capitalizeFirstLetter(deviceState))
                .setCharacteristic(this.platform.Characteristic.ConfiguredName, this.getDeviceStateConfig()[deviceState] || this.capitalizeFirstLetter(deviceState));
            s.getCharacteristic(this.platform.Characteristic.ConfiguredName)
                .onSet(async (value) => {
                    const oldConfiguredName = s.getCharacteristic(this.platform.Characteristic.ConfiguredName).value;
                    this.platform.log.info(`Changing configured name of device state sensor ${deviceState} from ${oldConfiguredName} to ${value}.`);
                    this.setDeviceStateConfig(deviceState, value as string);
                });
            this.service!.addLinkedService(s);
            this.deviceStateServices[deviceState] = s;
        }
    }

    private async handleDeviceStateUpdate(event: NodePyATVDeviceEvent | Error): Promise<void> {
        if (event instanceof Error) {
            return;
        }
        this.platform.log.info(`New Device State: ${event.value}`);
        if (event.oldValue !== null) {
            const s = this.deviceStateServices[event.oldValue];
            s.setCharacteristic(this.platform.Characteristic.MotionDetected, false);
        }
        if (event.value !== null) {
            const s = this.deviceStateServices[event.value];
            s.setCharacteristic(this.platform.Characteristic.MotionDetected, true);
        }
    }

    private createInputs(apps: NodePyATVApp[]): void {
        const appConfigs = this.getAppConfigs();

        apps.forEach((app) => {
            if (!Object.keys(appConfigs).includes(app.id)) {
                appConfigs[app.id] = {
                    configuredName: app.name,
                    isConfigured: this.platform.Characteristic.IsConfigured.CONFIGURED,
                    visibilityState: this.platform.Characteristic.CurrentVisibilityState.SHOWN,
                    identifier: this.appIdToNumber(app.id),
                };
            }
            this.platform.log.info(`Adding ${appConfigs[app.id].configuredName} (${app.id}) as an input.`);
            const s = this.accessory.getService(app.name) || this.accessory.addService(this.platform.Service.InputSource, app.name, app.id)
                .setCharacteristic(this.platform.Characteristic.ConfiguredName, appConfigs[app.id].configuredName)
                .setCharacteristic(this.platform.Characteristic.InputSourceType, this.platform.Characteristic.InputSourceType.APPLICATION)
                .setCharacteristic(this.platform.Characteristic.IsConfigured, appConfigs[app.id].isConfigured)
                .setCharacteristic(this.platform.Characteristic.Name, app.name)
                .setCharacteristic(this.platform.Characteristic.CurrentVisibilityState, appConfigs[app.id].visibilityState)
                .setCharacteristic(this.platform.Characteristic.InputDeviceType, this.platform.Characteristic.InputDeviceType.OTHER)
                .setCharacteristic(this.platform.Characteristic.TargetVisibilityState, appConfigs[app.id].visibilityState)
                .setCharacteristic(this.platform.Characteristic.Identifier, appConfigs[app.id].identifier);
            s.getCharacteristic(this.platform.Characteristic.ConfiguredName)
                .onSet(async (value) => {
                    this.platform.log.info(`Changing configured name of ${app.id} from ${appConfigs[app.id].configuredName} to ${value}.`);
                    appConfigs[app.id].configuredName = value as string;
                    this.setAppConfigs(appConfigs);
                });
            s.getCharacteristic(this.platform.Characteristic.IsConfigured)
                .onSet(async (value) => {
                    this.platform.log.info(`Changing is configured of ${appConfigs[app.id].configuredName} (${app.id}) from ${appConfigs[app.id].isConfigured} to ${value}.`);
                    appConfigs[app.id].isConfigured = value as 0 | 1;
                    this.setAppConfigs(appConfigs);
                });
            s.getCharacteristic(this.platform.Characteristic.TargetVisibilityState)
                .onSet(async (value) => {
                    this.platform.log.info(`Changing visibility state of ${appConfigs[app.id].configuredName} (${app.id}) from ${appConfigs[app.id].visibilityState} to ${value}.`);
                    appConfigs[app.id].visibilityState = value as 0 | 1;
                    s.setCharacteristic(this.platform.Characteristic.CurrentVisibilityState, value);
                    this.setAppConfigs(appConfigs);
                });
            this.service!.addLinkedService(s);
            this.inputs[app.id] = {
                pyatvApp: app,
                service: s,
            };
        });
        this.setAppConfigs(appConfigs);
    }

    private async handleInputUpdate(event: NodePyATVDeviceEvent | Error): Promise<void> {
        if (event instanceof Error) {
            return;
        }
        if (event === null) {
            return;
        }
        if (event.value === event.oldValue) {
            return;
        }
        const appId = event.value;
        this.platform.log.warn(`Current App: ${appId}`);
        const appIdentifier = this.getAppConfigs()[appId].identifier;
        this.setCommonConfig('activeIdentifier', appIdentifier);
        this.service!.setCharacteristic(this.platform.Characteristic.ActiveIdentifier, appIdentifier);
    }

    private getAppConfigs(): IAppConfigs {
        if (this.appConfigs === undefined) {
            const jsonPath = this.getPath('apps.json');
            this.appConfigs = JSON.parse(fs.readFileSync(jsonPath, 'utf8')) as IAppConfigs;
        }
        return this.appConfigs;
    }

    private setAppConfigs(value: IAppConfigs): void {
        this.appConfigs = value;
        const jsonPath = this.getPath('apps.json');
        fs.writeFileSync(jsonPath, JSON.stringify(value, null, 4), { encoding:'utf8', flag:'w' });
    }

    private getCommonConfig(): ICommonConfig {
        if (this.commonConfig === undefined) {
            const jsonPath = this.getPath('common.json');
            this.commonConfig = JSON.parse(fs.readFileSync(jsonPath, 'utf8')) as IAppConfigs;
        }
        return this.commonConfig;
    }

    private setCommonConfig(key: string, value: PrimitiveTypes): void {
        if (this.commonConfig === undefined) {
            this.commonConfig = {};
        }
        this.commonConfig[key] = value;
        const jsonPath = this.getPath('common.json');
        fs.writeFileSync(jsonPath, JSON.stringify(this.commonConfig, null, 4), { encoding:'utf8', flag:'w' });
    }

    private getMediaConfig(): IMediaConfigs {
        if (this.mediaConfigs === undefined) {
            const jsonPath = this.getPath('media.json');
            this.mediaConfigs = JSON.parse(fs.readFileSync(jsonPath, 'utf8')) as IMediaConfigs;
        }
        return this.mediaConfigs;
    }

    private setMediaTypeConfig(key: string, value: string): void {
        if (this.mediaConfigs === undefined) {
            this.mediaConfigs = {};
        }
        this.mediaConfigs[key] = value;
        const jsonPath = this.getPath('media.json');
        fs.writeFileSync(jsonPath, JSON.stringify(this.mediaConfigs, null, 4), { encoding:'utf8', flag:'w' });
    }

    private getDeviceStateConfig(): IStateConfigs {
        if (this.stateConfigs === undefined) {
            const jsonPath = this.getPath('state.json');
            this.stateConfigs = JSON.parse(fs.readFileSync(jsonPath, 'utf8')) as IStateConfigs;
        }
        return this.stateConfigs;
    }

    private setDeviceStateConfig(key: string, value: string): void {
        if (this.stateConfigs === undefined) {
            this.stateConfigs = {};
        }
        this.stateConfigs[key] = value;
        const jsonPath = this.getPath('state.json');
        fs.writeFileSync(jsonPath, JSON.stringify(this.stateConfigs, null, 4), { encoding:'utf8', flag:'w' });
    }

    private async handleActiveGet(): Promise<Nullable<CharacteristicValue>> {
        return this.service!.getCharacteristic(this.platform.Characteristic.Active).value;
    }

    private async handleActiveSet(state: CharacteristicValue): Promise<void> {
        if (state as boolean) {
            this.device?.turnOn();
            setTimeout(async () => {
                const { mediaType, deviceState } = await this.device.getState();
                if (mediaType && this.mediaTypeServices[mediaType]) {
                    this.mediaTypeServices[mediaType].setCharacteristic(this.platform.Characteristic.MotionDetected, true);
                }
                if (deviceState && this.deviceStateServices[deviceState]) {
                    this.deviceStateServices[deviceState].setCharacteristic(this.platform.Characteristic.MotionDetected, true);
                }
            }, 500);
        } else {
            this.device?.turnOff();
        }
    }

    private handleActiveUpdate(event: NodePyATVDeviceEvent | Error) {
        if (event instanceof Error) {
            return;
        }
        if (event.value === null) {
            return;
        }
        if (event.value === event.oldValue) {
            return;
        }
        this.platform.log.info(`New Active State: ${event.value}`);
        const value = event.value === 'on' ? this.platform.Characteristic.Active.ACTIVE : this.platform.Characteristic.Active.INACTIVE;
        this.service!.setCharacteristic(this.platform.Characteristic.Active, value);
    }

    private async handleActiveIdentifierGet(): Promise<Nullable<CharacteristicValue>> {
        return this.service!.getCharacteristic(this.platform.Characteristic.ActiveIdentifier).value;
    }

    private async handleActiveIdentifierSet(state: CharacteristicValue): Promise<void> {
        const appConfigs = this.getAppConfigs();
        let appId: string | undefined = undefined;
        for (const key in appConfigs) {
            if (appConfigs[key].identifier === state) {
                appId = key;
            }
        }
        if (appId !== undefined) {
            this.setCommonConfig('activeIdentifier', state as number);
            const app = this.inputs[appId];
            this.platform.log.info(`Launching App: ${app.pyatvApp.name}`);
            app.pyatvApp.launch();
        }
    }

    private async handleConfiguredNameGet(): Promise<Nullable<CharacteristicValue>> {
        return this.service!.getCharacteristic(this.platform.Characteristic.ConfiguredName).value;
    }

    private async handleConfiguredNameSet(state: CharacteristicValue): Promise<void> {
        const oldConfiguredName = this.service!.getCharacteristic(this.platform.Characteristic.ConfiguredName).value;
        this.platform.log.info(`Changed Configured Name from ${oldConfiguredName} to ${state}`);
        this.setCommonConfig('configuredName', state as string);
    }

    private async handleSleepDiscoveryModeGet(): Promise<Nullable<CharacteristicValue>> {
        return this.service!.getCharacteristic(this.platform.Characteristic.SleepDiscoveryMode).value;
    }

    private async handleRemoteKeySet(state: CharacteristicValue): Promise<void> {
        switch (state) {
        case this.platform.Characteristic.RemoteKey.REWIND:
            this.platform.log.info('rewind');
            break;
        case this.platform.Characteristic.RemoteKey.FAST_FORWARD:
            this.platform.log.info('fast forward');
            break;
        case this.platform.Characteristic.RemoteKey.NEXT_TRACK:
            this.platform.log.info('next rack');
            this.device?.skipForward();
            break;
        case this.platform.Characteristic.RemoteKey.PREVIOUS_TRACK:
            this.platform.log.info('previous track');
            this.device?.skipBackward();
            break;
        case this.platform.Characteristic.RemoteKey.ARROW_UP:
            this.platform.log.info('arrow up');
            this.device?.up();
            break;
        case this.platform.Characteristic.RemoteKey.ARROW_DOWN:
            this.platform.log.info('arrow down');
            this.device?.down();
            break;
        case this.platform.Characteristic.RemoteKey.ARROW_LEFT:
            this.platform.log.info('arrow left');
            this.device?.left();
            break;
        case this.platform.Characteristic.RemoteKey.ARROW_RIGHT:
            this.platform.log.info('arrow right');
            this.device?.right();
            break;
        case this.platform.Characteristic.RemoteKey.SELECT:
            this.platform.log.info('select');
            this.device?.select();
            break;
        case this.platform.Characteristic.RemoteKey.BACK:
            this.platform.log.info('back');
            break;
        case this.platform.Characteristic.RemoteKey.EXIT:
            this.platform.log.info('exit');
            this.device?.home();
            break;
        case this.platform.Characteristic.RemoteKey.PLAY_PAUSE:
            this.platform.log.info('play pause');
            this.device?.playPause();
            break;
        case this.platform.Characteristic.RemoteKey.INFORMATION:
            this.platform.log.info('information');
            this.device?.topMenu();
            break;
        }
    }

    private appIdToNumber(appId: string): number {
        const hash = md5(appId).substring(10, 14);
        let bitString = '';
        for (const [, character] of Object.entries(hash)) {
            bitString += character.charCodeAt(0).toString(2).padStart(8, '0');
        }
        return parseInt(bitString, 2);
    }

    private getPath(file: string, defaultContent = '{}'): string {
        let dir = `${this.platform.api.user.storagePath()}/appletv-enhanced`;
        if (!fs.existsSync(dir)){
            fs.mkdirSync(dir);
        }
        dir += `/${this.device.id!.replaceAll(':', '')}`;
        if (!fs.existsSync(dir)){
            fs.mkdirSync(dir);
        }
        const filePath = `${dir}/${file}`;
        try {
            fs.writeFileSync(filePath, defaultContent, { encoding:'utf8', flag: 'wx' });
        } catch (err) { /* empty */ }
        return filePath;
    }

    private capitalizeFirstLetter(value: string): string {
        return value.charAt(0).toUpperCase() + value.slice(1);
    }

    private getCredentials(): string {
        const path = this.getPath('credentials.txt', '');
        return fs.readFileSync(path, 'utf8').trim();
    }

    private saveCredentials(credentials: string): void {
        const path = this.getPath('credentials.txt', '');
        fs.writeFileSync(path, credentials, { encoding:'utf8', flag:'w' });
    }

    private async pair(ip: string, appleTVName: string): Promise<void> {
        const ipSplitted = ip.split('.');
        const ipEnd = ipSplitted[ipSplitted.length - 1];
        const httpPort = 42000 + parseInt(ipEnd);

        const htmlInput = fs.readFileSync(`${__dirname}/html/input.html`, 'utf8');
        const htmlAfterPost = fs.readFileSync(`${__dirname}/html/afterPost.html`, 'utf8');

        let goOn = false;
        let success = false;

        while (!success) {
            let backOffSeconds = 0;
            let processClosed = false;

            const process = spawn(ATVREMOTE_PATH, ['-s', ip, '--protocol', 'companion', 'pair']);
            process.stderr.setEncoding('utf8');
            process.stderr.on('data', (data: string) => {
                this.platform.log.error('stderr: ' + data);
                goOn = true;
            });
            process.stdout.setEncoding('utf8');
            process.stdout.on('data', (data: string) => {
                this.platform.log.debug('stdout: ' + data);
                if (data.includes('Enter PIN on screen:')) {
                    return;
                }
                if (data.includes('BackOff=')) {
                    backOffSeconds = parseInt(data.substring(data.search('BackOff=') + 8).split('s', 2)[0]) + 5;
                    goOn = true;
                    return;
                }
                if (data.toUpperCase().includes('ERROR')) {
                    goOn = true;
                    return;
                }
                if (data.includes('You may now use these credentials: ')) {
                    const split = data.split(': ');
                    this.platform.log.debug(`extracted credentials: ${split[1]}`);
                    this.saveCredentials(split[1]);
                    goOn = true;
                    success = true;
                }
            });
            process.on('close', () => {
                processClosed = true;
            });

            const requestListener = (req: IncomingMessage, res: ServerResponse<IncomingMessage> & { req: IncomingMessage }): void => {
                res.writeHead(200);
                if (req.method === 'GET') {
                    res.end(htmlInput);
                } else {
                    let reqBody = '';
                    req.on('data', (chunk) => {
                        reqBody += chunk;
                    });
                    req.on('end', () => {
                        const pin = parseInt(reqBody.split('=')[1]);
                        this.platform.log.info(`Got PIN ${pin} for Apple TV ${appleTVName}.`);
                        process.stdin.write(`${pin}\n`);
                        res.end(htmlAfterPost);
                    });
                }
            };
            const server = http.createServer(requestListener);
            server.listen(httpPort, '0.0.0.0', () => {
                // eslint-disable-next-line max-len
                this.platform.log.warn(`You need to pair your Apple TV ${appleTVName} before the plugin can connect to it. Enter the PIN that is currently displayed on the device here: http://homebridge.local:${httpPort}/`);
            });

            while (!goOn || !processClosed) {
                await delay(100);
            }
            server.close();

            if (backOffSeconds !== 0) {
                this.platform.log.warn(`Apple TV ${appleTVName}: Too many attempts. Waiting for ${backOffSeconds} seconds before retrying.`);
                await delay(1000 * backOffSeconds);
            }
        }
    }

    public async untilBooted(): Promise<void> {
        while (!this.booted) {
            await delay(100);
        }
    }
}
