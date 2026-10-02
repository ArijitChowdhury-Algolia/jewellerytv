import { spawn } from 'node:child_process';
const processes = ['dev:api', 'dev:web'].map(script => spawn('npm', ['run', script], {cwd:new URL('..', import.meta.url),stdio:'inherit',env:{...process.env,NODE_USE_SYSTEM_CA:'1'}}));
function stop(){for(const child of processes)child.kill('SIGTERM');}
process.on('SIGINT',stop);process.on('SIGTERM',stop);
for(const child of processes)child.on('exit',code=>{stop();process.exitCode=code??0;});
