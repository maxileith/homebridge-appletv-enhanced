import { ChildProcessWithoutNullStreams, spawn } from 'child_process';
import { RemoteControlCommands } from './enums';
import PrefixLogger from './PrefixLogger';
import { Logger } from 'homebridge';
import generateAvadaKedavraSequence from './generateAvadaKedavraSequence';

class RocketRemote {

    private process: ChildProcessWithoutNullStreams;
    private readonly log: PrefixLogger;
    private onCloseCallable?: (() => void) = undefined;
    private heartbeatInterval?: NodeJS.Timeout;

    private readonly stdoutListener = this.stdoutLog.bind(this);
    private readonly stderrListener = this.stderrLog.bind(this);

    private lastCommandSend: number = 0;

    constructor(
        private readonly mac: string,
        private readonly atvremotePath: string,
        private readonly airplayCredentials: string,
        private readonly companionCredentials: string,
        logger: Logger | PrefixLogger,
    ) {
        this.log = new PrefixLogger(logger, 'Rocket Remote');
        this.log.debug('creating');

        this.process = spawn(this.atvremotePath, [
            '--id', this.mac,
            '--companion-credentials', this.companionCredentials,
            '--airplay-credentials', this.airplayCredentials,
            'cli',
        ]);
        this.process.stdout.setEncoding('utf8');
        this.process.stderr.setEncoding('utf8');
        this.process.stdout.on('data', this.stdoutListener);
        this.process.stderr.on('data', this.stderrListener);

        this.initHeartbeat();
    }

    private initHeartbeat(): void {
        this.heartbeatInterval = setInterval(() => {
            if (this.lastCommandSend + 45000 < Date.now()) {
                this.sendCommand('app_list', true);
            } else {
                const secondsFromLastCommand = Math.round((Date.now() - this.lastCommandSend) / 1000);
                this.log.debug(`Skipping heartbeat since last command was only ${secondsFromLastCommand}s before.`);
            }
        }, 60000);
    }

    private stderrLog(data: string): void {
        this.log.error(data);
        this.process.kill();
    }

    private stdoutLog(data: string): void {
        const toLog = data.replace('pyatv>', '').trim();
        if (toLog !== '') {
            this.log.debug(toLog);
        }
    }

    public openApp(id: string): void {
        this.sendCommand(`launch_app=${id}`);
    }

    public sendCommand(cmd: RemoteControlCommands | string, hideLog: boolean = false): void {
        if (hideLog) {
            this.log.debug(`pyatv>${cmd}`);
        } else {
            this.log.info(`pyatv>${cmd}`);
        }
        this.process.stdin.write(`${cmd}\n`);
        this.lastCommandSend = Date.now();
    }

    public channelDown(): void {
        this.sendCommand(RemoteControlCommands.CHANNEL_DOWN);
    }

    public channelUp(): void {
        this.sendCommand(RemoteControlCommands.CHANNEL_UP);
    }

    public down(): void {
        this.sendCommand(RemoteControlCommands.DOWN);
    }

    public home(): void {
        this.sendCommand(RemoteControlCommands.HOME);
    }

    public homeHold(): void {
        this.sendCommand(RemoteControlCommands.HOME_HOLD);
    }

    public left(): void {
        this.sendCommand(RemoteControlCommands.LEFT);
    }

    public menu(): void {
        this.sendCommand(RemoteControlCommands.MENU);
    }

    public next(): void {
        this.sendCommand(RemoteControlCommands.NEXT);
    }

    public pause(): void {
        this.sendCommand(RemoteControlCommands.PAUSE);
    }

    public play(): void {
        this.sendCommand(RemoteControlCommands.PLAY);
    }

    public playPause(): void {
        this.sendCommand(RemoteControlCommands.PLAY_PAUSE);
    }

    public previous(): void {
        this.sendCommand(RemoteControlCommands.PREVIOUS);
    }

    public right(): void {
        this.sendCommand(RemoteControlCommands.RIGHT);
    }

    public select(): void {
        this.sendCommand(RemoteControlCommands.SELECT);
    }

    public skipBackward(): void {
        this.sendCommand(RemoteControlCommands.SKIP_BACKWARD);
    }

    public skipForward(): void {
        this.sendCommand(RemoteControlCommands.SKIP_FORWARD);
    }

    public stop(): void {
        this.sendCommand(RemoteControlCommands.STOP);
    }

    public turnOff(): void {
        this.sendCommand(RemoteControlCommands.TURN_OFF);
    }

    public turnOn(): void {
        this.sendCommand(RemoteControlCommands.TURN_ON);
    }

    public topMenu(): void {
        this.sendCommand(RemoteControlCommands.TOP_MENU);
    }

    public up(): void {
        this.sendCommand(RemoteControlCommands.UP);
    }

    public onClose(f: () => void): void {
        this.onCloseCallable = f;
        this.process.once('close', () => {
            this.process.stdout.removeListener('data', this.stdoutListener);
            this.process.stderr.removeListener('data', this.stderrListener);
            clearInterval(this.heartbeatInterval);
            this.log.warn('Lost connection. Trying to reconnect ...');
            this.onCloseCallable && this.onCloseCallable();
        });
    }

    public avadaKedavra(numberOfApps: number): void {
        this.log.info('Avada Kedavra');
        const avadaKedavraSequence = generateAvadaKedavraSequence(numberOfApps);
        this.log.debug(`Avada Kedavra sequence: ${avadaKedavraSequence.toString()}`);
        const ak = spawn(this.atvremotePath, [
            '--id', this.mac,
            '--companion-credentials', this.companionCredentials,
            '--airplay-credentials', this.airplayCredentials,
            ... avadaKedavraSequence,
        ]);
        ak.stdout.setEncoding('utf8');
        ak.stderr.setEncoding('utf8');
        ak.stdout.on('data', this.stdoutListener);
        ak.stderr.on('data', this.stderrListener);
    }
}

export default RocketRemote;