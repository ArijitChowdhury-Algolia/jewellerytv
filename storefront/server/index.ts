import { createApiServer } from './api.js';
import { loadConfig } from './config.js';
const server=createApiServer(loadConfig());
server.listen(5174,'127.0.0.1',()=>console.log('JTV local API listening on http://127.0.0.1:5174'));
for(const signal of ['SIGINT','SIGTERM'] as const)process.on(signal,()=>server.close(()=>process.exit(0)));
