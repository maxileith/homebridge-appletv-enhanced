import { NodePyATVDevice, NodePyATVFindAndInstanceOptions, NodePyATVInstance } from '@sebbo2002/node-pyatv';


const atvremote_path = `${__dirname}/.venv/bin/atvremote`;
const atvscript_path = `${__dirname}/.venv/bin/atvscript`;

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

const pyatvInstance = new CustomPyAtvInstance({ debug: undefined, atvscriptPath: atvscript_path, atvremotePath: atvremote_path });

export default pyatvInstance;
