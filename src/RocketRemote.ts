import { type ChildProcessWithoutNullStreams, spawn } from 'child_process';
import { RocketRemoteKey } from './enums';
import PrefixLogger from './PrefixLogger';
import type LogLevelLogger from './LogLevelLogger';

class RocketRemote {

    private readonly avadaKedavraSequence: string[];
    private heartbeatInterval?: NodeJS.Timeout;
    private lastCommandSend: number = 0;
    private readonly log: PrefixLogger;
    private onCloseCallable?: (() => Promise<void> | void) = undefined;
    private onHomeCallable?: (() => Promise<void> | void) = undefined;
    private readonly process: ChildProcessWithoutNullStreams;

    private readonly stderrListener = this.stderrLog.bind(this);
    private readonly stdoutListener = this.stdoutLog.bind(this);

    public constructor(
        private readonly mac: string,
        private readonly atvremotePath: string,
        private readonly airplayCredentials: string,
        private readonly companionCredentials: string,
        logger: LogLevelLogger | PrefixLogger,
        avadaKedavraNumberOfApps: number,
    ) {
        this.log = new PrefixLogger(logger, 'Rocket Remote');
        this.log.debug('creating');

        this.avadaKedavraSequence = this.generateAvadaKedavraSequence(avadaKedavraNumberOfApps);

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

    public addOutputDevices(identifiers: string[], hideLog: boolean = false): void {
        const i: string = identifiers.join(',');
        this.sendCommand(`add_output_devices=${i}`, hideLog);
    }

    public avadaKedavra(): void {
        this.log.info('Avada Kedavra');
        this.log.debug(`Avada Kedavra sequence: ${this.avadaKedavraSequence.join(', ')}`);
        const ak: ChildProcessWithoutNullStreams = spawn(this.atvremotePath, [
            '--scan-hosts', this.mac,
            '--companion-credentials', this.companionCredentials,
            '--airplay-credentials', this.airplayCredentials,
            ...this.avadaKedavraSequence,
        ]);
        ak.stdout.setEncoding('utf8');
        ak.stderr.setEncoding('utf8');
        ak.stdout.on('data', this.stdoutListener);
        ak.stderr.on('data', this.stderrListener);
    }

    public channelDown(hideLog: boolean = false): void {
        this.sendCommand(RocketRemoteKey.CHANNEL_DOWN, hideLog);
    }

    public channelUp(hideLog: boolean = false): void {
        this.sendCommand(RocketRemoteKey.CHANNEL_UP, hideLog);
    }

    public down(hideLog: boolean = false): void {
        this.sendCommand(RocketRemoteKey.DOWN, hideLog);
    }

    public home(hideLog: boolean = false): void {
        this.sendCommand(RocketRemoteKey.HOME, hideLog);
    }

    public homeHold(hideLog: boolean = false): void {
        this.sendCommand(RocketRemoteKey.HOME_HOLD, hideLog);
    }

    public left(hideLog: boolean = false): void {
        this.sendCommand(RocketRemoteKey.LEFT, hideLog);
    }

    public menu(hideLog: boolean = false): void {
        this.sendCommand(RocketRemoteKey.MENU, hideLog);
    }

    public next(hideLog: boolean = false): void {
        this.sendCommand(RocketRemoteKey.NEXT, hideLog);
    }

    public onClose(f: () => Promise<void> | void): void {
        this.onCloseCallable = f;
        this.process.once('close', () => {
            this.process.stdout.removeListener('data', this.stdoutListener);
            this.process.stderr.removeListener('data', this.stderrListener);
            clearInterval(this.heartbeatInterval);
            this.log.warn('Lost connection. Trying to reconnect ...');
            if (this.onCloseCallable) {
                void this.onCloseCallable();
            }
        });
    }

    public onHome(f: () => Promise<void> | void): void {
        this.onHomeCallable = f;
    }

    public openApp(id: string, hideLog: boolean = false): void {
        this.sendCommand(`launch_app=${id}`, hideLog);
    }

    public pause(hideLog: boolean = false): void {
        this.sendCommand(RocketRemoteKey.PAUSE, hideLog);
    }

    public play(hideLog: boolean = false): void {
        this.sendCommand(RocketRemoteKey.PLAY, hideLog);
    }

    public playPause(hideLog: boolean = false): void {
        this.sendCommand(RocketRemoteKey.PLAY_PAUSE, hideLog);
    }

    public previous(hideLog: boolean = false): void {
        this.sendCommand(RocketRemoteKey.PREVIOUS, hideLog);
    }

    public removeOutputDevices(identifiers: string[], hideLog: boolean = false): void {
        const i: string = identifiers.join(',');
        this.sendCommand(`remove_output_devices=${i}`, hideLog);
    }

    public right(hideLog: boolean = false): void {
        this.sendCommand(RocketRemoteKey.RIGHT, hideLog);
    }

    public select(hideLog: boolean = false): void {
        this.sendCommand(RocketRemoteKey.SELECT, hideLog);
    }

    public sendCommand(cmd: RocketRemoteKey | string, hideLog: boolean = false): void {
        if (hideLog) {
            this.log.debug(cmd);
        } else {
            this.log.info(cmd);
        }
        if (this.onHomeCallable !== undefined && cmd === 'home') {
            void this.onHomeCallable();
        }
        this.process.stdin.write(`${cmd}\n`);
        this.lastCommandSend = Date.now();
    }

    public setOutputDevices(identifiers: string[], hideLog: boolean = false): void {
        const i: string = identifiers.join(',');
        this.sendCommand(`set_output_devices=${i}`, hideLog);
    }

    public setVolume(percentage: number, hideLog: boolean = false): void {
        this.sendCommand(`set_volume=${percentage}`, hideLog);
    }

    public skipBackward(hideLog: boolean = false): void {
        this.sendCommand(RocketRemoteKey.SKIP_BACKWARD, hideLog);
    }

    public skipForward(hideLog: boolean = false): void {
        this.sendCommand(RocketRemoteKey.SKIP_FORWARD, hideLog);
    }

    public stop(hideLog: boolean = false): void {
        this.sendCommand(RocketRemoteKey.STOP, hideLog);
    }

    public topMenu(hideLog: boolean = false): void {
        this.sendCommand(RocketRemoteKey.TOP_MENU, hideLog);
    }

    public turnOff(hideLog: boolean = false): void {
        this.sendCommand(RocketRemoteKey.TURN_OFF, hideLog);
    }

    public turnOn(hideLog: boolean = false): void {
        this.sendCommand(RocketRemoteKey.TURN_ON, hideLog);
    }

    public up(hideLog: boolean = false): void {
        this.sendCommand(RocketRemoteKey.UP, hideLog);
    }

    public volumeDown(hideLog: boolean = false): void {
        this.sendCommand(RocketRemoteKey.VOLUME_DOWN, hideLog);
    }

    public volumeUp(hideLog: boolean = false): void {
        this.sendCommand(RocketRemoteKey.VOLUME_UP, hideLog);
    }

    private generateAvadaKedavraSequence(numberOfApps: number): string[] {
        let sequence: string[] = [
            'home', 'delay=100', 'home', 'delay=800', 'left', 'delay=300',
        ];
        for (let i: number = 0; i < numberOfApps; i++) {
            sequence = sequence.concat(['up', 'delay=50', 'up', 'delay=600']);
        }
        sequence.push('home');
        return sequence;
    }

    private initHeartbeat(): void {
        this.heartbeatInterval = setInterval(() => {
            if (this.lastCommandSend + 45000 < Date.now()) {
                this.sendCommand('app_list', true);
            } else {
                const secondsFromLastCommand: number = Math.round((Date.now() - this.lastCommandSend) / 1000);
                this.log.debug(`Skipping heartbeat since last command was only ${secondsFromLastCommand}s before.`);
            }
        }, 60000);
    }

    private stderrLog(data: string): void {
        this.log.error(data);
        this.process.kill();
    }

    private stdoutLog(data: string): void {
        const toLog: string = data.replace('pyatv>', '').trim();
        if (toLog.toUpperCase().includes('ERROR')) {
            this.stderrLog(toLog);
        } else if (toLog.includes('Enter commands and press enter')) {
            this.log.debug(toLog);
            this.log.success('Connected');
        } else if (toLog !== '') {
            this.log.debug(toLog);
        }
    }
}

export default RocketRemote;
