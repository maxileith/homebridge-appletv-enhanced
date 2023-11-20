import { type ChildProcessWithoutNullStreams, spawn } from 'child_process';
import { RocketRemoteKey } from './enums';
import PrefixLogger from './PrefixLogger';
import type LogLevelLogger from './LogLevelLogger';

class RocketRemote {

    private readonly process: ChildProcessWithoutNullStreams;
    private readonly log: PrefixLogger;
    private onCloseCallable?: (() => void) = undefined;
    private onHomeCallable?: (() => void) = undefined;
    private heartbeatInterval?: NodeJS.Timeout;

    private readonly stdoutListener = this.stdoutLog.bind(this);
    private readonly stderrListener = this.stderrLog.bind(this);

    private lastCommandSend: number = 0;

    private readonly avadaKedavraSequence: string[];

    public constructor(
        private readonly ip: string,
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
            '--scan-hosts', this.ip,
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

    public openApp(id: string): void {
        this.sendCommand(`launch_app=${id}`);
    }

    public sendCommand(cmd: RocketRemoteKey | string, hideLog: boolean = false): void {
        if (hideLog) {
            this.log.debug(cmd);
        } else {
            this.log.info(cmd);
        }
        if (this.onHomeCallable !== undefined && cmd === 'home') {
            this.onHomeCallable();
        }
        this.process.stdin.write(`${cmd}\n`);
        this.lastCommandSend = Date.now();
    }

    public channelDown(): void {
        this.sendCommand(RocketRemoteKey.CHANNEL_DOWN);
    }

    public channelUp(): void {
        this.sendCommand(RocketRemoteKey.CHANNEL_UP);
    }

    public down(): void {
        this.sendCommand(RocketRemoteKey.DOWN);
    }

    public home(): void {
        this.sendCommand(RocketRemoteKey.HOME);
    }

    public homeHold(): void {
        this.sendCommand(RocketRemoteKey.HOME_HOLD);
    }

    public left(): void {
        this.sendCommand(RocketRemoteKey.LEFT);
    }

    public menu(): void {
        this.sendCommand(RocketRemoteKey.MENU);
    }

    public next(): void {
        this.sendCommand(RocketRemoteKey.NEXT);
    }

    public pause(): void {
        this.sendCommand(RocketRemoteKey.PAUSE);
    }

    public play(): void {
        this.sendCommand(RocketRemoteKey.PLAY);
    }

    public playPause(): void {
        this.sendCommand(RocketRemoteKey.PLAY_PAUSE);
    }

    public previous(): void {
        this.sendCommand(RocketRemoteKey.PREVIOUS);
    }

    public right(): void {
        this.sendCommand(RocketRemoteKey.RIGHT);
    }

    public select(): void {
        this.sendCommand(RocketRemoteKey.SELECT);
    }

    public skipBackward(): void {
        this.sendCommand(RocketRemoteKey.SKIP_BACKWARD);
    }

    public skipForward(): void {
        this.sendCommand(RocketRemoteKey.SKIP_FORWARD);
    }

    public stop(): void {
        this.sendCommand(RocketRemoteKey.STOP);
    }

    public turnOff(): void {
        this.sendCommand(RocketRemoteKey.TURN_OFF);
    }

    public turnOn(): void {
        this.sendCommand(RocketRemoteKey.TURN_ON);
    }

    public topMenu(): void {
        this.sendCommand(RocketRemoteKey.TOP_MENU);
    }

    public up(): void {
        this.sendCommand(RocketRemoteKey.UP);
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

    public onHome(f: () => void): void {
        this.onHomeCallable = f;
    }

    public avadaKedavra(): void {
        this.log.info('Avada Kedavra');
        this.log.debug(`Avada Kedavra sequence: ${this.avadaKedavraSequence.toString()}`);
        const ak: ChildProcessWithoutNullStreams = spawn(this.atvremotePath, [
            '--scan-hosts', this.ip,
            '--companion-credentials', this.companionCredentials,
            '--airplay-credentials', this.airplayCredentials,
            ... this.avadaKedavraSequence,
        ]);
        ak.stdout.setEncoding('utf8');
        ak.stderr.setEncoding('utf8');
        ak.stdout.on('data', this.stdoutListener);
        ak.stderr.on('data', this.stderrListener);
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
        } else if (toLog !== '') {
            this.log.debug(toLog);
        }
    }

    private generateAvadaKedavraSequence(numberOfApps: number): string[] {
        let sequence: string[] = ['home', 'delay=100', 'home', 'delay=800', 'left', 'delay=300'];
        for (let i: number = 0; i < numberOfApps; i++) {
            sequence = sequence.concat(['up', 'delay=50', 'up', 'delay=600']);
        }
        sequence.push('home');
        return sequence;
    }
}

export default RocketRemote;