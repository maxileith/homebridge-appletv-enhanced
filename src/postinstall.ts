import { exec } from 'child_process';

const module_dir = __dirname;
const venv_dir = `${module_dir}/.venv`;
const pip_path = `${venv_dir}/bin/pip3`;

const logging = (error, stdout, stderr) => {
    process.stdout.write(stdout);
    process.stderr.write(stderr);
};

exec(`sleep 1 && python -m venv "${venv_dir}" && sleep 1 && ${pip_path} install pyatv==0.14.2`, logging);
