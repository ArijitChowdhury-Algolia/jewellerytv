import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
export function loadConfig(){
 const local:Record<string,string>={};
 try{for(const line of readFileSync(fileURLToPath(new URL('../../.env.local',import.meta.url)),'utf8').split(/\r?\n/)){const match=line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*?)\s*$/);if(match)local[match[1]]=match[2].replace(/^(['"])(.*)\1$/,'$2');}}catch{/* Environment-only use is supported. */}
 const appId=process.env.ALGOLIA_APP_ID??local.ALGOLIA_APP_ID;const apiKey=process.env.ALGOLIA_SEARCH_API_KEY??local.ALGOLIA_SEARCH_API_KEY;
 if(!appId||!apiKey)throw new Error('Set ALGOLIA_APP_ID and ALGOLIA_SEARCH_API_KEY in the root .env.local or server environment');
 return {appId,apiKey,briefAgentId:process.env.JTV_BRIEF_AGENT_ID??local.JTV_BRIEF_AGENT_ID};
}
