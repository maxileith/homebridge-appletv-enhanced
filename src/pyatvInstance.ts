import { NodePyATVDevice, NodePyATVFindAndInstanceOptions, NodePyATVInstance } from '@sebbo2002/node-pyatv';


export const ATVREMOTE_PATH = `${__dirname}/.venv/bin/atvremote`;
export const ATVSCRIPT_PATH = `${__dirname}/.venv/bin/atvscript`;

class CustomPyAtvInstance extends NodePyATVInstance {

    cachedDevices: NodePyATVDevice[] = [];

    async find(options?: NodePyATVFindAndInstanceOptions | undefined): Promise<NodePyATVDevice[]> {
        this.cachedDevices = await super.find(options);
        return this.cachedDevices;
    }

    deviceById(id: string): NodePyATVDevice {
        return this.cachedDevices.find((d) => d.id === id) as NodePyATVDevice;
    }
}

const pyatvInstance = new CustomPyAtvInstance({
    debug: undefined,
    atvscriptPath: ATVSCRIPT_PATH,
    atvremotePath: ATVREMOTE_PATH,
});

export default pyatvInstance;
