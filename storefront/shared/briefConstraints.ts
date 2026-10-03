import {briefStateSchema,formatBriefValue,type BriefState,type BriefFactV2} from './briefSchema.js';
import {pairTotal} from './shopping.js';
import catalogueFacetValues from './catalogueFacetValues.json' with {type:'json'};
/** Public values observed by a read-only facet query; provenance and completeness are in the JSON.
 * Unknown values stay context. Neither compiler nor dictionary changes index settings. */
export const CATALOGUE_FACET_VALUES:Readonly<Record<string,readonly string[]>>=catalogueFacetValues.values;
function supportedFacet(f:BriefFactV2){const v=f.value;return v.kind==='facet'&&!!CATALOGUE_FACET_VALUES[v.attribute]&&v.values.every(x=>CATALOGUE_FACET_VALUES[v.attribute].includes(x));}
function unavailable(f:BriefFactV2,scopeResolved=false):string|undefined{
 if(f.status!=='active')return 'Needs clarification before applying';
 if(f.strength!=='requirement')return 'Preference used as conversation context';
 if(!scopeResolved&&f.scope.kind!=='mission')return 'Scoped to a specific item or recipient; cannot safely apply as a global search filter';
 if(['recipient','occasion','unknown'].includes(f.field))return 'No verified catalogue semantics for this field';
 if(f.value.kind==='text')return 'No canonical catalogue constraint; conversation context only';
 if(f.value.kind==='money'&&(f.field!=='budget'||f.value.basis==='unresolved'))return 'Budget scope is unresolved';
 if(f.value.kind==='facet'&&!supportedFacet(f))return 'Attribute or exact value is not in the verified catalogue vocabulary';
 return undefined;
}
function requestedProductTypes(state:BriefState){return [...new Set(state.facts.filter(f=>!unavailable(f)).flatMap(f=>f.value.kind==='facet'&&f.value.attribute==='Catalog_ProductType'&&f.value.operator==='any'?f.value.values:[]))];}
export function compileBriefConstraints(input:BriefState){
 const state=briefStateSchema.parse(input),appliedFactIds:string[]=[],context:{factId:string;reason:string}[]=[],filters:string[]=[];
 // ProductType describes each record's category. Multiple requested types select a
 // union of candidates, not a requirement that one item be both necklace and earrings.
 const requestedTypes=requestedProductTypes(state);
 let emittedTypes=false;
 for(const f of state.facts.filter(f=>f.status==='active'||f.status==='tentative')){
  const reason=unavailable(f);if(reason){context.push({factId:f.id,reason});continue;}
  const v=f.value;
  if(v.kind==='money'){filters.push(`Pricing_ActivePrice ${v.operator==='lt'?'<':'<='} ${(v.cents/100).toFixed(2)}`);if(v.basis==='total')context.push({factId:f.id,reason:'Individual price bound only; selected combination still requires an exact total check'});}
  if(v.kind==='facet'&&v.attribute==='Catalog_ProductType'&&v.operator==='any'){
   if(!emittedTypes){const parts=requestedTypes.map(value=>`Catalog_ProductType:${JSON.stringify(value)}`);filters.push(parts.length===1?parts[0]:`(${parts.join(' OR ')})`);emittedTypes=true;}
  }else if(v.kind==='facet'){const parts=v.values.map(value=>`${v.operator==='none'?'NOT ':''}${v.attribute}:${JSON.stringify(value)}`);filters.push(parts.length===1?parts[0]:`(${parts.join(v.operator==='none'?' AND ':' OR ')})`);}
  appliedFactIds.push(f.id);
 }
 return {...(filters.length?{filters:filters.join(' AND ')}:{}),appliedFactIds,context,consultationBrief:state.facts.filter(f=>f.status==='active'||f.status==='tentative').map(f=>`${f.status==='tentative'?'Unresolved':'Shopper'} ${f.strength} (${f.scope.kind}${f.scope.key?`: ${f.scope.key}`:''}): ${f.field}: ${formatBriefValue(f.value)}`).join('\n')};
}
export type BriefConflictResult={status:'compliant'|'conflict'|'unknown';reasons:string[]};
function readValues(record:Record<string,unknown>,attribute:string):unknown[]{
 if(Object.hasOwn(record,attribute)){const v=record[attribute];return Array.isArray(v)?v:[v];}
 let current:unknown[]=[record];for(const key of attribute.split('.'))current=current.flatMap(v=>v&&typeof v==='object'&&!Array.isArray(v)?(Array.isArray((v as Record<string,unknown>)[key])?(v as Record<string,unknown>)[key] as unknown[]:[(v as Record<string,unknown>)[key]]):[]);return current;
}
/** Resolve only exact product identity or catalogue type, never natural-language aliases. */
function recordScope(f:BriefFactV2,record:Record<string,unknown>):'applies'|'other'|'unknown'{
 if(f.scope.kind==='mission')return 'applies';
 if(f.scope.kind!=='item'||!f.scope.key)return 'unknown';
 const key=f.scope.key;
 if(typeof record.objectID==='string'&&record.objectID===key)return 'applies';
 const types=readValues(record,'Catalog_ProductType').filter((v):v is string=>typeof v==='string'&&!!v);
 if(types.some(type=>type.toLowerCase()===key.toLowerCase()))return 'applies';
 const knownTypes=CATALOGUE_FACET_VALUES.Catalog_ProductType;
 if(knownTypes.some(type=>type.toLowerCase()===key.toLowerCase())&&types.length&&types.every(type=>knownTypes.some(known=>known.toLowerCase()===type.toLowerCase())))return 'other';
 return 'unknown';
}
export function checkBriefConflicts(state:BriefState,record:Record<string,unknown>):BriefConflictResult{
 const reasons:string[]=[];let unknown=false,conflict=false;
 const requestedTypes=requestedProductTypes(state);let checkedTypes=false;
 for(const f of state.facts.filter(f=>f.status==='active'&&f.strength==='requirement')){
  // Gift context guides the conversation; it is not a checkable property of a product.
  if(f.field==='recipient'||f.field==='occasion')continue;
  const scope=recordScope(f,record);if(scope==='other')continue;
  if(scope==='unknown'||unavailable(f,true)){unknown=true;reasons.push(`${formatBriefValue(f.value)}: evidence or scope unavailable`);continue;}
  const v=f.value;
  if(v.kind==='money'){
   const price=record.Pricing_ActivePrice;if(typeof price!=='number'||!Number.isFinite(price)||price<0){unknown=true;reasons.push('Price is unknown');continue;}
   const cents=Math.round((price+Number.EPSILON)*100);if(v.operator==='lt'?cents>=v.cents:cents>v.cents){conflict=true;reasons.push(`Price conflicts with ${formatBriefValue(v).toLowerCase()}`);}else if(v.basis==='total'){unknown=true;reasons.push('Individual item fits the price bound; combination total remains unassessed');}
  }else if(v.kind==='facet'){
   const values=readValues(record,v.attribute).filter((x):x is string=>typeof x==='string'&&!!x);
   if(!values.length){unknown=true;reasons.push(`${v.attribute}: catalogue evidence missing`);continue;}
   const union=f.scope.kind==='mission'&&v.attribute==='Catalog_ProductType'&&v.operator==='any';
   if(union&&checkedTypes)continue;if(union)checkedTypes=true;
   const matched=values.some(x=>(union?requestedTypes:v.values).includes(x));if(v.operator==='none'?matched:!matched){conflict=true;reasons.push(`Catalogue ${v.attribute} conflicts with ${formatBriefValue(v)}`);}
  }
 }
 return {status:conflict?'conflict':unknown?'unknown':'compliant',reasons};
}
export function checkCombinationBudget(state:BriefState,items:readonly {price:number|null|undefined;quantity?:number}[]):BriefConflictResult{
 const {totalCents}=pairTotal(items),reasons:string[]=[];let unknown=false,conflict=false;
 for(const f of state.facts.filter(f=>f.status==='active'&&f.strength==='requirement'&&f.value.kind==='money')){const v=f.value;if(v.kind!=='money')continue;if(f.scope.kind!=='mission'||v.basis==='unresolved'){unknown=true;reasons.push('Budget scope needs clarification');continue;}if(v.basis!=='total')continue;if(totalCents===null||items.length===0){unknown=true;reasons.push('Combination total is unknown');continue;}if(v.operator==='lt'?totalCents>=v.cents:totalCents>v.cents){conflict=true;reasons.push(`Combination conflicts with ${formatBriefValue(v).toLowerCase()}`);}}
 return {status:conflict?'conflict':unknown?'unknown':'compliant',reasons};
}
