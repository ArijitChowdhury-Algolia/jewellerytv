import { z } from 'zod';
import type { SearchClient } from 'instantsearch.js';
const resultsSchema=z.object({results:z.array(z.object({hits:z.array(z.object({objectID:z.string()}).passthrough()),nbHits:z.number(),page:z.number(),nbPages:z.number(),hitsPerPage:z.number()}).passthrough())});
/** Credentials stay behind the same-origin local API. */
async function post(path:string,body:unknown):Promise<unknown>{
 const response=await fetch(path,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
 if(!response.ok){const data=await response.json().catch(()=>({error:'Request failed'}));throw new Error(typeof data.error==='string'?data.error:`Request failed (${response.status})`);}
 return response.json();
}
const proxyClient={
 search:async(requests:unknown)=>resultsSchema.parse(await post('/api/search',{requests})),
 searchForFacetValues:async(requests:Array<{indexName:string;params:{facetName:string;facetQuery:string}}>)=>Promise.all(requests.map(({indexName,params:{facetName,facetQuery,...params}})=>post('/api/facets',{indexName,facetName,facetQuery,params}))),
 addAlgoliaAgent:()=>{},
};
// The proxy preserves Algolia's search response envelope; runtime schemas validate required fields.
export const searchClient=proxyClient as unknown as SearchClient;
