import fs from 'fs';
import http, { IncomingMessage, ServerResponse } from 'http';
import { Service, PlatformAccessory, CharacteristicValue, Nullable, PrimitiveTypes } from 'homebridge';

import { AppleTVEnhancedPlatform } from './appleTVEnhancedPlatform';
import { NodePyATVDevice, NodePyATVDeviceEvent, NodePyATVDeviceState, NodePyATVMediaType } from '@sebbo2002/node-pyatv';
import md5 from 'md5';
import { spawn } from 'child_process';
import path from 'path';
import CustomPyAtvInstance from './CustomPyAtvInstance';
import { capitalizeFirstLetter, delay, getLocalIP } from './utils';
import { IAppConfigs, ICommonConfig, IInputs, IMediaConfigs, IStateConfigs, NodePyATVApp } from './interfaces';
import { TNodePyATVDeviceState, TNodePyATVMediaType } from './types';


const HIDE_BY_DEFAULT_APPS = [
    'com.apple.podcasts',
    'com.apple.TVAppStore',
    'com.apple.TVSearch',
    'com.apple.Arcade',
    'com.apple.TVHomeSharing',
    'com.apple.TVSettings',
    'com.apple.Fitness',
    'com.apple.TVShows',
    'com.apple.TVMovies',
    'com.apple.facetime',
];


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
    private offline = false;

    constructor(
        private readonly platform: AppleTVEnhancedPlatform,
        private readonly accessory: PlatformAccessory,
    ) {
        this.device = CustomPyAtvInstance.getInstance()!.deviceById(this.accessory.context.id as string);

        const credentials = this.getCredentials();
        if (credentials === '') {
            this.pair(this.device.host, this.device.name).then((c) => {
                this.saveCredentials(c);
                this.startUp(c);
                this.platform.log.warn(`Your Apple TV ${this.device.name} was paired successfully. Please add it to your home in the Home app: com.apple.home://launch`);
            });
        } else {
            this.startUp(credentials);
        }
    }

    private async startUp(credentials: string): Promise<void> {
        this.device = CustomPyAtvInstance.getInstance()!.device({
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
            .setCharacteristic(this.platform.Characteristic.ActiveIdentifier, this.getCommonConfig().activeIdentifier || this.appIdToNumber('com.apple.TVSettings'))
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

        // create input and sensor services
        const apps = await this.device.listApps();
        this.createInputs(apps);
        this.createDeviceStateSensors();
        this.createMediaTypeSensors();

        // create event listeners to keep everything up-to-date
        this.createListeners();

        this.booted = true;
    }

    private createListeners(): void {
        this.platform.log.debug('recreating listeners');

        const filterErrorHandler = (event: NodePyATVDeviceEvent | Error, listener: (event: NodePyATVDeviceEvent) => void): void => {
            if (!(event instanceof Error)) {
                if (this.offline && event.value !== null) {
                    this.platform.log.info('Reestablished the connection');
                    this.offline = false;
                }
                this.platform.log.debug(`event ${event.key}: ${event.value}`);
                listener(event);
            }
        };

        this.device.on('update:powerState', (e) => filterErrorHandler(e, this.handleActiveUpdate.bind(this)));
        this.device.on('update:appId', (e) => filterErrorHandler(e, this.handleInputUpdate.bind(this)));
        this.device.on('update:deviceState', (e) => filterErrorHandler(e, this.handleDeviceStateUpdate.bind(this)));
        this.device.on('update:mediaType', (e) => filterErrorHandler(e, this.handleMediaTypeUpdate.bind(this)));

        this.device.on('error', (e) => {
            this.platform.log.debug(e as unknown as string);
            this.offline = true;
            this.platform.log.warn('Lost connection. Trying to reconnect ...');
        });
    }

    private createMediaTypeSensors(): void {
        const mediaTypes = Object.keys(NodePyATVMediaType) as TNodePyATVMediaType[];
        for (let i = 0; i < mediaTypes.length; i++) {
            const mediaType = mediaTypes[i];
            if (this.platform.config.mediaTypes && !this.platform.config.mediaTypes.includes(mediaType)) {
                continue;
            }
            this.platform.log.info(`Adding media type ${mediaType} as a motion sensor.`);
            const s = this.accessory.getService(mediaType) || this.accessory.addService(this.platform.Service.MotionSensor, mediaType, mediaType)
                .setCharacteristic(this.platform.Characteristic.MotionDetected, false)
                .setCharacteristic(this.platform.Characteristic.Name, capitalizeFirstLetter(mediaType))
                .setCharacteristic(this.platform.Characteristic.ConfiguredName, this.getMediaConfig()[mediaType] || capitalizeFirstLetter(mediaType));
            s.getCharacteristic(this.platform.Characteristic.ConfiguredName)
                .onSet(async (value) => {
                    if (value === '') {
                        return;
                    }
                    const oldConfiguredName = s.getCharacteristic(this.platform.Characteristic.ConfiguredName).value;
                    if (oldConfiguredName === value) {
                        return;
                    }
                    this.platform.log.info(`Changing configured name of media type sensor ${mediaType} from ${oldConfiguredName} to ${value}.`);
                    this.setMediaTypeConfig(mediaType, value as string);
                });
            s.getCharacteristic(this.platform.Characteristic.MotionDetected)
                .onGet(async () => {
                    if (this.offline) {
                        throw new this.platform.api.hap.HapStatusError(this.platform.api.hap.HAPStatus.SERVICE_COMMUNICATION_FAILURE);
                    }
                    return s.getCharacteristic(this.platform.Characteristic.MotionDetected).value;
                });
            this.service!.addLinkedService(s);
            this.mediaTypeServices[mediaType] = s;
        }
    }

    private async handleMediaTypeUpdate(event: NodePyATVDeviceEvent): Promise<void> {
        this.platform.log.info(`New Media Type State: ${event.value}`);
        if (event.oldValue !== null && this.mediaTypeServices[event.oldValue]) {
            const s = this.mediaTypeServices[event.oldValue];
            s.setCharacteristic(this.platform.Characteristic.MotionDetected, false);
        }
        if (event.value !== null && this.mediaTypeServices[event.value]) {
            const s = this.mediaTypeServices[event.value];
            s.setCharacteristic(this.platform.Characteristic.MotionDetected, true);
        }
    }

    private createDeviceStateSensors(): void {
        const deviceStates = Object.keys(NodePyATVDeviceState) as TNodePyATVDeviceState[];
        for (let i = 0; i < deviceStates.length; i++) {
            const deviceState = deviceStates[i];
            if (this.platform.config.deviceStates && !this.platform.config.deviceStates.includes(deviceState)) {
                continue;
            }
            this.platform.log.info(`Adding device state ${deviceState} as a motion sensor.`);
            const s = this.accessory.getService(deviceState) || this.accessory.addService(this.platform.Service.MotionSensor, deviceState, deviceState)
                .setCharacteristic(this.platform.Characteristic.MotionDetected, false)
                .setCharacteristic(this.platform.Characteristic.Name, capitalizeFirstLetter(deviceState))
                .setCharacteristic(this.platform.Characteristic.ConfiguredName, this.getDeviceStateConfig()[deviceState] || capitalizeFirstLetter(deviceState));
            s.getCharacteristic(this.platform.Characteristic.ConfiguredName)
                .onSet(async (value) => {
                    if (value === '') {
                        return;
                    }
                    const oldConfiguredName = s.getCharacteristic(this.platform.Characteristic.ConfiguredName).value;
                    if (oldConfiguredName === value) {
                        return;
                    }
                    this.platform.log.info(`Changing configured name of device state sensor ${deviceState} from ${oldConfiguredName} to ${value}.`);
                    this.setDeviceStateConfig(deviceState, value as string);
                });
            s.getCharacteristic(this.platform.Characteristic.MotionDetected)
                .onGet(async () => {
                    if (this.offline) {
                        throw new this.platform.api.hap.HapStatusError(this.platform.api.hap.HAPStatus.SERVICE_COMMUNICATION_FAILURE);
                    }
                    return s.getCharacteristic(this.platform.Characteristic.MotionDetected).value;
                });
            this.service!.addLinkedService(s);
            this.deviceStateServices[deviceState] = s;
        }
    }

    private async handleDeviceStateUpdate(event: NodePyATVDeviceEvent): Promise<void> {
        this.platform.log.info(`New Device State: ${event.value}`);
        if (event.oldValue !== null && this.deviceStateServices[event.oldValue] !== undefined) {
            const s = this.deviceStateServices[event.oldValue];
            s.setCharacteristic(this.platform.Characteristic.MotionDetected, false);
        }
        if (event.value !== null && this.deviceStateServices[event.value] !== undefined) {
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
                    visibilityState: HIDE_BY_DEFAULT_APPS.includes(app.id)
                        ? this.platform.Characteristic.CurrentVisibilityState.HIDDEN
                        : this.platform.Characteristic.CurrentVisibilityState.SHOWN,
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
                    if (value === '') {
                        return;
                    }
                    if (appConfigs[app.id].configuredName === value) {
                        return;
                    }
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

    private async handleInputUpdate(event: NodePyATVDeviceEvent): Promise<void> {
        if (event === null) {
            return;
        }
        if (event.value === event.oldValue) {
            return;
        }
        const appId = event.value;
        this.platform.log.warn(`Current App: ${appId}`);
        const appConfig = this.getAppConfigs()[appId];
        if (appConfig) {
            const appIdentifier = appConfig.identifier;
            this.setCommonConfig('activeIdentifier', appIdentifier);
            this.service!.setCharacteristic(this.platform.Characteristic.ActiveIdentifier, appIdentifier);
        }
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
            const jsonPath = this.getPath('mediaTypes.json');
            this.mediaConfigs = JSON.parse(fs.readFileSync(jsonPath, 'utf8')) as IMediaConfigs;
        }
        return this.mediaConfigs;
    }

    private setMediaTypeConfig(key: string, value: string): void {
        if (this.mediaConfigs === undefined) {
            this.mediaConfigs = {};
        }
        this.mediaConfigs[key] = value;
        const jsonPath = this.getPath('mediaTypes.json');
        fs.writeFileSync(jsonPath, JSON.stringify(this.mediaConfigs, null, 4), { encoding:'utf8', flag:'w' });
    }

    private getDeviceStateConfig(): IStateConfigs {
        if (this.stateConfigs === undefined) {
            const jsonPath = this.getPath('deviceStates.json');
            this.stateConfigs = JSON.parse(fs.readFileSync(jsonPath, 'utf8')) as IStateConfigs;
        }
        return this.stateConfigs;
    }

    private setDeviceStateConfig(key: string, value: string): void {
        if (this.stateConfigs === undefined) {
            this.stateConfigs = {};
        }
        this.stateConfigs[key] = value;
        const jsonPath = this.getPath('deviceStates.json');
        fs.writeFileSync(jsonPath, JSON.stringify(this.stateConfigs, null, 4), { encoding:'utf8', flag:'w' });
    }

    private async handleActiveGet(): Promise<Nullable<CharacteristicValue>> {
        if (this.offline) {
            throw new this.platform.api.hap.HapStatusError(this.platform.api.hap.HAPStatus.SERVICE_COMMUNICATION_FAILURE);
        }
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

    private handleActiveUpdate(event: NodePyATVDeviceEvent) {
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
        if (state === '') {
            return;
        }
        const oldConfiguredName = this.service!.getCharacteristic(this.platform.Characteristic.ConfiguredName).value;
        if (oldConfiguredName === state) {
            return;
        }
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
        const hash = new Uint8Array(md5(appId, { asBytes: true }));
        const view = new DataView(hash.buffer);
        return view.getUint32(0);
    }

    private getPath(file: string, defaultContent = '{}'): string {
        let dir = path.join(this.platform.api.user.storagePath(), 'appletv-enhanced');
        if (!fs.existsSync(dir)){
            fs.mkdirSync(dir);
        }
        dir += `/${this.device.id!.replaceAll(':', '')}`;
        if (!fs.existsSync(dir)){
            fs.mkdirSync(dir);
        }
        const filePath = path.join(dir, file);
        try {
            fs.writeFileSync(filePath, defaultContent, { encoding:'utf8', flag: 'wx' });
        } catch (err) { /* empty */ }
        return filePath;
    }

    private getCredentials(): string {
        const path = this.getPath('credentials.txt', '');
        return fs.readFileSync(path, 'utf8').trim();
    }

    private saveCredentials(credentials: string): void {
        const path = this.getPath('credentials.txt', '');
        fs.writeFileSync(path, credentials, { encoding:'utf8', flag:'w' });
    }

    private async pair(ip: string, appleTVName: string): Promise<string> {
        const ipSplitted = ip.split('.');
        const ipEnd = ipSplitted[ipSplitted.length - 1];
        const httpPort = 42000 + parseInt(ipEnd);

        const htmlInput = fs.readFileSync(path.join(__dirname, 'html', 'input.html'), 'utf8');
        const htmlAfterPost = fs.readFileSync(path.join(__dirname, 'html', 'afterPost.html'), 'utf8');

        let goOn = false;
        let success = false;

        const localIP = getLocalIP();
        let credentials = '';

        while (!success) {
            let backOffSeconds = 0;
            let processClosed = false;

            const process = spawn(CustomPyAtvInstance.getInstance()!.atvremotePath, ['-s', ip, '--protocol', 'companion', 'pair']);
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
                    credentials = split[1].trim();
                    this.platform.log.debug(`extracted credentials: ${split[1]}`);
                    goOn = true;
                    success = true;
                }
            });
            process.on('close', () => {
                processClosed = true;
            });

            setTimeout(() => {
                if (!processClosed) {
                    this.platform.log.warn('Pairing request timed out, retrying ...');
                    process.stdin.write('\n');
                }
            }, 32000);

            const requestListener = (req: IncomingMessage, res: ServerResponse<IncomingMessage> & { req: IncomingMessage }): void => {
                res.setHeader('Content-Security-Policy', 'default-src * \'self\' data: \'unsafe-inline\' \'unsafe-hashes\' \'unsafe-eval\';\
                script-src * \'self\' data: \'unsafe-inline\' \'unsafe-hashes\' \'unsafe-eval\';\
                script-src-elem * \'self\' data: \'unsafe-inline\' \'unsafe-hashes\' \'unsafe-eval\';\
                script-src-attr * \'self\' data: \'unsafe-inline\' \'unsafe-hashes\' \'unsafe-eval\';\
                media-src * \'self\'');
                res.setHeader('Cache-Control', 'max-age=0, no-cache, must-revalidate, proxy-revalidate');
                res.writeHead(200);
                if (req.method === 'GET') {
                    res.end(htmlInput);
                } else {
                    let reqBody = '';
                    req.on('data', (chunk) => {
                        reqBody += chunk;
                    });
                    req.on('end', () => {
                        const [a, b, c, d] = reqBody.split('&').map((e) => e.charAt(2));
                        const pin = `${a}${b}${c}${d}`;
                        this.platform.log.info(`Got PIN ${pin} for Apple TV ${appleTVName}.`);
                        process.stdin.write(`${pin}\n`);
                        res.end(htmlAfterPost);
                    });
                }
            };
            const server = http.createServer(requestListener);
            server.listen(httpPort, '0.0.0.0', () => {
                // eslint-disable-next-line max-len
                this.platform.log.warn(`You need to pair your Apple TV ${appleTVName} before the plugin can connect to it. Enter the PIN that is currently displayed on the device here: http://${localIP}:${httpPort}/`);
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

        return credentials;
    }

    public async untilBooted(): Promise<void> {
        while (!this.booted) {
            await delay(100);
        }
    }
}
