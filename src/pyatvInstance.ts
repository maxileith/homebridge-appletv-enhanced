import { NodePyATVDevice, NodePyATVFindAndInstanceOptions, NodePyATVInstance } from '@sebbo2002/node-pyatv';


const atvremote_path = `${__dirname}/.venv/bin/atvremote`;
const atvscript_path = `${__dirname}/.venv/bin/atvscript`;

interface ICachedDevice {
    id: string;
    host: string;
    name: string;
}

class CustomPyAtvInstance extends NodePyATVInstance {

    cachedDevices: NodePyATVDevice[] = [];

    async find(options?: NodePyATVFindAndInstanceOptions | undefined): Promise<NodePyATVDevice[]> {
        this.cachedDevices = await super.find(options);
        return this.cachedDevices;
    }

    deviceById(id: string): NodePyATVDevice | undefined {
        return this.cachedDevices.find((d) => d.id === id);
    }
}

const pyatvInstance = new CustomPyAtvInstance({ debug: true, atvscriptPath: atvscript_path, atvremotePath: atvremote_path });

export default pyatvInstance;
