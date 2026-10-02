import type { IndexUiState } from 'instantsearch.js';
import { z } from 'zod';
const refinementsSchema=z.record(z.string(),z.array(z.string()));
/** Parse only public search state, retaining exact product paths independently. */
export function readSearchState(input:string):IndexUiState {
 const url=new URL(input,'http://localhost:5173');const p=url.searchParams;
 let refinementList:Record<string,string[]>={};
 try{refinementList=refinementsSchema.parse(JSON.parse(p.get('f')||'{}'));}catch{/* A malformed share link starts with no refinements. */}
 if(p.get('brand'))refinementList.Catalog_BrandNavigationName=[p.get('brand')!];
 if(p.get('stone'))refinementList['Catalog_GemstoneInformationPrimary.GemstoneName']=[p.get('stone')!];
 const state:IndexUiState={query:p.get('q')||'',refinementList,sortBy:p.get('sort')||'prod_catalog_featured',page:Math.max(1,Number(p.get('page'))||1)};
 if(p.has('price'))state.range={Pricing_ActivePrice:p.get('price')!};
 return state;
}
/** Build URLs with stable search state and preserve the chosen local page. */
export function searchURL(path:string,state:IndexUiState):string {
 const url=new URL(path,'http://localhost:5173');const p=url.searchParams;
 ['q','f','sort','page','price','brand','stone'].forEach(k=>p.delete(k));
 if(state.query)p.set('q',state.query);
 const refinements=Object.fromEntries(Object.entries(state.refinementList||{}).filter(([,v])=>v.length));
 if(Object.keys(refinements).length)p.set('f',JSON.stringify(refinements));
 if(state.sortBy&&state.sortBy!=='prod_catalog_featured')p.set('sort',state.sortBy);
 if(state.page&&state.page>1)p.set('page',String(state.page));
 if(state.range?.Pricing_ActivePrice)p.set('price',state.range.Pricing_ActivePrice);
 return url.pathname+(p.size?'?'+p.toString():'');
}
const agentConstraintsSchema=z.object({query:z.string().max(4096).optional(),facetFilters:z.array(z.union([z.string(),z.array(z.string())])).optional(),numericFilters:z.array(z.union([z.string(),z.array(z.string())])).optional()}).strict();
export type AgentConstraints=z.infer<typeof agentConstraintsSchema>;
/** Keep exact server-resolved predicates without changing AND/OR semantics. */
export function agentSearchURL(constraints:AgentConstraints):string{const clean=agentConstraintsSchema.parse(constraints);return '/search?'+new URLSearchParams({q:clean.query||'',agent:JSON.stringify(clean)}).toString();}
export function readAgentConstraints(input:string):AgentConstraints{const text=new URL(input,'http://localhost').searchParams.get('agent');if(!text)return {};try{return agentConstraintsSchema.parse(JSON.parse(text));}catch{return {};}}
/** Carry browse context into the exact style route, including deep links. */
export function productURL(id:string,path:string,search:string):string{const params=new URLSearchParams(search);if(path.startsWith('/category/'))params.set('category',path.split('/')[2]);return `/product/${encodeURIComponent(id)}${params.size?'?'+params.toString():''}`;}
/** Use Configure's filters expression so managed price widgets can coexist safely. */
export function agentFilterExpression(input:AgentConstraints):string{
 const facet=(value:string)=>{const split=value.indexOf(':');const attr=value.slice(0,split);let text=value.slice(split+1);if(split<1||!/^\w[\w.]*$/.test(attr))throw new Error('Unsupported agent facet constraint');const negative=text.startsWith('-');if(negative)text=text.slice(1);if(text.startsWith('\\-'))text=text.slice(1);return `${negative?'NOT ':''}${attr}:${JSON.stringify(text)}`;};
 const numeric=(value:string)=>{if(!/^[A-Za-z0-9_.]+\s*(?:<=|>=|!=|=|<|>)\s*-?\d+(?:\.\d+)?$/.test(value))throw new Error('Unsupported agent numeric constraint');return value;};
 const group=(value:string|string[],parse:(v:string)=>string)=>Array.isArray(value)?`(${value.map(parse).join(' OR ')})`:parse(value);
 return [...(input.facetFilters||[]).map(v=>group(v,facet)),...(input.numericFilters||[]).map(v=>group(v,numeric))].join(' AND ');
}
