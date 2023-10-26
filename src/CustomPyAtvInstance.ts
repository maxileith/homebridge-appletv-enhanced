import { NodePyATVDevice, NodePyATVFindAndInstanceOptions, NodePyATVInstance, NodePyATVInstanceOptions} from '@sebbo2002/node-pyatv';
import path from 'path';

interface CustomNodePyATVInstanceOptions extends NodePyATVInstanceOptions {
    atvremotePath: string;
    atvscriptPath: string;
}

class CustomPyAtvInstance extends NodePyATVInstance {

    private cachedDevices: NodePyATVDevice[] = [];
    private static instance: CustomPyAtvInstance | undefined = undefined;

    public readonly atvscriptPath: string;
    public readonly atvremotePath: string;

    private constructor(options: CustomNodePyATVInstanceOptions) {
        super(options);
        this.atvscriptPath = options.atvscriptPath;
        this.atvremotePath = options.atvremotePath;
    }

    public async find(options?: NodePyATVFindAndInstanceOptions): Promise<NodePyATVDevice[]> {
        return super.find(options).then(async (results) => {
            this.cachedDevices = results;
            return results;
        });
    }

    public deviceById(id: string): NodePyATVDevice {
        return this.cachedDevices.find((d) => d.id === id) as NodePyATVDevice;
    }

    public static getInstance(): CustomPyAtvInstance | undefined {
        return this.instance;
    }

    public static createInstance(storagePath: string, options?: NodePyATVInstanceOptions): void {
        const script = path.join(storagePath, 'appletv-enhanced', '.venv', 'bin', 'atvscript');
        const remote = path.join(storagePath, 'appletv-enhanced', '.venv', 'bin', 'atvremote');
        this.instance = new CustomPyAtvInstance({
            atvscriptPath: script,
            atvremotePath: remote,
            ...options,
        });
    }
}

export default CustomPyAtvInstance;
