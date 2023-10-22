import { exec } from 'child_process';

const moduleDir = __dirname;
const venvDir = `${moduleDir}/.venv`;
const pipPath = `${venvDir}/bin/pip3`;

const logging = (error, stdout, stderr) => {
    process.stdout.write(stdout);
    process.stderr.write(stderr);
};

exec(`sleep 1 && python -m venv "${venvDir}" && sleep 1 && ${pipPath} install pyatv==0.14.2`, logging);
