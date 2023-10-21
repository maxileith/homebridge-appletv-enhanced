import pyatv from '@sebbo2002/node-pyatv';


const atvremote_path = `${__dirname}/.venv/bin/atvremote`;
const atvscript_path = `${__dirname}/.venv/bin/atvscript`;

const pyatvInstance = new pyatv({debug: true, atvscriptPath: atvscript_path, atvremotePath: atvremote_path});

export default pyatvInstance;
