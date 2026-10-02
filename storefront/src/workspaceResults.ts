import {normalizeProduct,type Product} from './catalog';
export type WorkspaceView='discover'|'compare'|'saved'|'combination';
export type WorkspaceGroup={title:string;why?:string;items:{product:Product;why?:string}[]};
/** Accept only curated IDs hydrated from actual tool records, never model-created products. */
export function workspaceGroups(payload:unknown,lookup:(id:string)=>unknown):{intro:string;groups:WorkspaceGroup[]}{
 if(!payload||typeof payload!=='object')return {intro:'',groups:[]};
 const p=payload as {intro?:unknown;groups?:unknown};
 if(!Array.isArray(p.groups))return {intro:'',groups:[]};
 const groups=p.groups.slice(0,3).flatMap(g=>{
  if(!g||typeof g!=='object'||!Array.isArray(g.results))return [];
  const seen=new Set<string>();
  const items=g.results.slice(0,3).flatMap((r:Record<string,unknown>)=>{
   if(typeof r?.objectID!=='string'||seen.has(r.objectID))return [];
   try{const product=normalizeProduct(lookup(r.objectID));if(product.id!==r.objectID)return [];seen.add(r.objectID);return [{product,...(typeof r.why==='string'?{why:r.why.slice(0,500)}:{})}]}catch{return []}
  });
  return items.length?[{title:typeof g.title==='string'?g.title.slice(0,300):'Suggestions',...(typeof g.why==='string'?{why:g.why.slice(0,500)}:{}),items}]:[];
 });
 return {intro:typeof p.intro==='string'?p.intro.slice(0,6000):'',groups};
}
export function mayCommitResults(status:string|undefined,latest:boolean,state:string){return status==='ready'&&latest&&state==='output-available'}
