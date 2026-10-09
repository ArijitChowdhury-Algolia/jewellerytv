import {isUpperMoneyBound,moneyOperatorSymbol,satisfiesMoneyBound,hasImpossibleMoneyInterval} from './moneyBounds.js';
import {briefStateSchema,formatBriefValue,hasAcceptedSourceEvidence,type BriefState,type BriefFactV2} from './briefSchema.js';
import type {CatalogVocabulary} from './concierge/vocabularyContract.js';
/** Empty fallback: used only when no live vocabulary is supplied. There is no
 * frozen value copy any more — the live payload from /api/catalog-vocabulary is
 * the sole source of catalogue truth, and an absent vocabulary degrades to
 * 'unknown' (Needs verification), never to stale validation. */
const EMPTY_VOCABULARY:Readonly<Record<string,readonly string[]>>={};
const CATALOGUE_FACET_VALUES:Readonly<Record<string,readonly string[]>>=EMPTY_VOCABULARY;
type VocabLookup=Readonly<Record<string,readonly string[]>>;
function supportedFacet(f:BriefFactV2,vocab:VocabLookup=CATALOGUE_FACET_VALUES){const v=f.value;return v.kind==='facet'&&!!vocab[v.attribute]&&v.values.every(x=>vocab[v.attribute].includes(x));}
/** The exact ceiling is verified; only how it covers a selection remains unresolved.
 * Either total or per-item scope implies this necessary bound on each candidate.
 * Scoped money cannot become a global filter, and no affordability is established. */
function verifiedUnresolvedBudget(f:BriefFactV2){return (f.status==='active'||f.status==='tentative')&&f.field==='budget'&&f.strength==='requirement'&&f.evidence.explicit&&hasAcceptedSourceEvidence(f.evidence)&&f.value.kind==='money'&&f.value.basis==='unresolved';}
export function canUseUnresolvedBudgetBound(f:BriefFactV2){return verifiedUnresolvedBudget(f)&&f.value.kind==='money'&&isUpperMoneyBound(f.value.operator)&&f.scope.kind==='mission'&&f.value.kind==='money'&&f.value.currency==='USD';}
function unavailable(f:BriefFactV2,scopeResolved=false,vocab:VocabLookup=CATALOGUE_FACET_VALUES):string|undefined{
 const unresolvedBound=canUseUnresolvedBudgetBound(f);
 if(f.status!=='active'&&!unresolvedBound)return 'Needs clarification before applying';
 if(f.strength!=='requirement')return 'Preference used as conversation context';
 if(!scopeResolved&&f.scope.kind!=='mission')return 'Scoped to a specific item or recipient; cannot safely apply as a global search filter';
 if(['recipient','occasion','unknown'].includes(f.field))return 'No verified catalogue semantics for this field';
 if(f.value.kind==='text')return 'No canonical catalogue constraint; conversation context only';
 if(f.value.kind==='money'&&f.value.currency!=='USD')return `Budget currency ${f.value.currency} needs a verified conversion before comparison with USD catalogue prices`;
 if(f.value.kind==='money'&&(f.field!=='budget'||(f.value.basis==='unresolved'&&!unresolvedBound)))return 'Budget scope is unresolved';
 if(f.value.kind==='facet'&&!supportedFacet(f,vocab))return 'Attribute or exact value is not in the verified catalogue vocabulary';
 return undefined;
}
function requestedProductTypes(state:BriefState,vocab:VocabLookup=CATALOGUE_FACET_VALUES){return [...new Set(state.facts.filter(f=>!unavailable(f,false,vocab)).flatMap(f=>f.value.kind==='facet'&&f.value.attribute==='Catalog_ProductType'&&f.value.operator==='any'?f.value.values:[]))];}
/** A type-scoped requirement is global only inside an explicitly verified singleton
 * product-type mission. Do not infer a target from aliases or item facts themselves. */
export function canResolveItemTypeScope(f:BriefFactV2,state:BriefState,vocab:VocabLookup=CATALOGUE_FACET_VALUES):boolean{
 if(f.scope.kind!=='item'||!f.scope.key)return false;
 if(state.facts.some(x=>(x.status==='active'||x.status==='tentative')&&x.strength==='requirement'&&x.scope.kind==='recipient'))return false;
 const typeFacts=state.facts.filter(x=>x.scope.kind==='mission'&&x.value.kind==='facet'&&x.value.attribute==='Catalog_ProductType'&&x.value.operator==='any'&&x.strength==='requirement'&&(x.status==='active'||x.status==='tentative'));
 if(!typeFacts.length||typeFacts.some(x=>x.status!=='active'||!x.evidence.explicit||!hasAcceptedSourceEvidence(x.evidence)||unavailable(x,false,vocab)))return false;
 const types=[...new Set(typeFacts.flatMap(x=>x.value.kind==='facet'?x.value.values:[]))];
 return types.length===1&&types[0].toLowerCase()===f.scope.key.toLowerCase();
}
/** Only constraints with verified catalogue semantics can require a retrieval scope.
 * Pure conversational recipient/occasion text remains context. */
function needsScopeResolution(f:BriefFactV2,vocab:VocabLookup=CATALOGUE_FACET_VALUES):boolean{
 if(f.scope.kind==='mission'||f.strength!=='requirement'||['recipient','occasion','unknown'].includes(f.field))return false;
 if(f.status!=='active'&&!verifiedUnresolvedBudget(f))return false;
 if(f.value.kind==='facet')return supportedFacet(f,vocab);
 return f.field==='budget'&&f.value.kind==='money'&&f.value.currency==='USD';
}
export type BriefCompileTarget={kind:'item';key:string};
export type BriefTargetDomain={scope:BriefCompileTarget;productType:string};
function canonicalScopeType(key:string|undefined,vocab:VocabLookup=CATALOGUE_FACET_VALUES){return key===undefined?undefined:(vocab.Catalog_ProductType??[]).find(type=>type.toLowerCase()===key.toLowerCase());}
function resolveCompileTarget(state:BriefState,target:BriefCompileTarget,vocab:VocabLookup=CATALOGUE_FACET_VALUES):{targetDomain?:BriefTargetDomain;rejectedTarget?:{reason:string}}{
 const facts=state.facts.filter(f=>f.status==='active'||f.status==='tentative');
 if(target.kind!=='item'||typeof target.key!=='string'||!facts.some(f=>f.scope.kind==='item'&&f.scope.key===target.key))return {rejectedTarget:{reason:'Target must exactly match an existing active or tentative item scope'}};
 const productType=canonicalScopeType(target.key,vocab);
 if(!productType)return {rejectedTarget:{reason:'Target is not an exact canonical product type'}};
 if(facts.some(f=>f.scope.kind==='recipient'&&f.strength==='requirement'))return {rejectedTarget:{reason:'Recipient-scoped requirements cannot safely be assigned to this item target'}};
 const recipients=facts.filter(f=>f.field==='recipient'&&f.scope.kind==='mission');
 if(new Set(recipients.map(f=>JSON.stringify(f.value))).size>1)return {rejectedTarget:{reason:'Mission recipient attribution is unresolved'}};
 const missionTypes=facts.filter(f=>f.scope.kind==='mission'&&f.strength==='requirement'&&f.value.kind==='facet'&&f.value.attribute==='Catalog_ProductType'&&f.value.operator==='any');
 if(missionTypes.some(f=>f.status!=='active'||!f.evidence.explicit||!hasAcceptedSourceEvidence(f.evidence)||!supportedFacet(f,vocab)))return {rejectedTarget:{reason:'Mission product-type domain is not accepted'}};
 const union=requestedProductTypes(state,vocab);
 if(union.length&&!union.includes(productType))return {rejectedTarget:{reason:'Selected target conflicts with the mission product-type domain'}};
 return {targetDomain:{scope:{kind:'item',key:target.key},productType}};
}
export function compileBriefConstraints(input:BriefState,target?:BriefCompileTarget,vocab:VocabLookup=CATALOGUE_FACET_VALUES){
 const state=briefStateSchema.parse(input),appliedFactIds:string[]=[],context:{factId:string;reason:string}[]=[],filters:string[]=[],unresolvedScopeFactIds:string[]=[],deferredFactIds:string[]=[],moneyConstraintConflicts:{factIds:string[];reason:string}[]=[],appliedMoney:BriefFactV2[]=[];
 const {targetDomain,rejectedTarget}=target?resolveCompileTarget(state,target,vocab):{};
 // ProductType describes each record's category. Multiple requested types select a
 // union of candidates, not a requirement that one item be both necklace and earrings.
 const requestedTypes=requestedProductTypes(state,vocab);
 let emittedTypes=!!targetDomain;
 if(targetDomain)filters.push(`Catalog_ProductType:${JSON.stringify(targetDomain.productType)}`);
 for(const f of state.facts.filter(f=>f.status==='active'||f.status==='tentative')){
  const itemType=f.scope.kind==='item'?canonicalScopeType(f.scope.key,vocab):undefined;
  if(targetDomain&&itemType&&itemType!==targetDomain.productType&&!f.id.startsWith('pending-')&&f.field!=='recipient'){
   deferredFactIds.push(f.id);context.push({factId:f.id,reason:`Deferred: this turn targets ${targetDomain.productType}; this ${itemType} fact remains in the brief`});continue;
  }
  const scopeResolved=targetDomain?f.scope.kind==='item'&&itemType===targetDomain.productType:canResolveItemTypeScope(f,state,vocab);
  // Unresolved scoped budgets remain contextual until their basis is clarified.
  const scopedBudgetUnresolved=f.value.kind==='money'&&f.value.basis==='unresolved';
  if(needsScopeResolution(f,vocab)&&(!scopeResolved||scopedBudgetUnresolved))unresolvedScopeFactIds.push(f.id);
  const reason=unavailable(f,scopeResolved,vocab);if(reason){context.push({factId:f.id,reason});continue;}
  const v=f.value;
  if(v.kind==='money'){if(v.basis==='total'&&!isUpperMoneyBound(v.operator)){context.push({factId:f.id,reason:'Combination minimum only; no individual product price floor is implied'});continue;}appliedMoney.push(f);filters.push(`Pricing_ActivePrice ${moneyOperatorSymbol(v.operator)} ${(v.cents/100).toFixed(2)}`);if(v.basis==='total')context.push({factId:f.id,reason:'Individual price bound only; selected combination still requires an exact total check'});if(v.basis==='unresolved')context.push({factId:f.id,reason:'Verified individual price bound only; budget basis remains unresolved and selected combination affordability is unknown'});}
  if(f.scope.kind==='mission'&&v.kind==='facet'&&v.attribute==='Catalog_ProductType'&&v.operator==='any'){
   if(!emittedTypes){const parts=requestedTypes.map(value=>`Catalog_ProductType:${JSON.stringify(value)}`);filters.push(parts.length===1?parts[0]:`(${parts.join(' OR ')})`);emittedTypes=true;}
  }else if(v.kind==='facet'){const parts=v.values.map(value=>`${v.operator==='none'?'NOT ':''}${v.attribute}:${JSON.stringify(value)}`);filters.push(parts.length===1?parts[0]:`(${parts.join(v.operator==='none'?' AND ':' OR ')})`);}
  appliedFactIds.push(f.id);
 }
 const bounds=(facts:BriefFactV2[])=>facts.flatMap(f=>f.value.kind==='money'?[{operator:f.value.operator,cents:f.value.cents}]:[]);
 if(hasImpossibleMoneyInterval(bounds(appliedMoney)))moneyConstraintConflicts.push({factIds:appliedMoney.map(f=>f.id),reason:'Applied USD price bounds admit no nonnegative integer-cent price'});
 const totalGroups=new Map<string,BriefFactV2[]>();
 for(const f of state.facts){
  if(f.status!=='active'||f.strength!=='requirement'||f.field!=='budget'||f.value.kind!=='money'||f.value.basis!=='total'||deferredFactIds.includes(f.id))continue;
  // Unattributed owner scopes are handled by scope clarification, not joined here.
  if(f.scope.kind!=='mission'&&!(targetDomain&&f.scope.kind==='item'&&canonicalScopeType(f.scope.key,vocab)===targetDomain.productType)&&!canResolveItemTypeScope(f,state,vocab))continue;
  const key=JSON.stringify([f.scope.kind,f.scope.kind==='item'?canonicalScopeType(f.scope.key,vocab):f.scope.key??'',f.value.currency,f.value.basis]);totalGroups.set(key,[...(totalGroups.get(key)??[]),f]);
 }
 for(const facts of totalGroups.values())if(hasImpossibleMoneyInterval(bounds(facts))&&!moneyConstraintConflicts.some(c=>c.factIds.length===facts.length&&c.factIds.every(id=>facts.some(f=>f.id===id))))moneyConstraintConflicts.push({factIds:facts.map(f=>f.id),reason:'Same-scope total budget bounds admit no nonnegative integer-cent total'});
 const blocked=!!rejectedTarget||moneyConstraintConflicts.length>0;
 return {...(!blocked&&filters.length?{filters:filters.join(' AND ')}:{}),appliedFactIds:blocked?[]:appliedFactIds,moneyConstraintConflicts,unresolvedScopeFactIds,deferredFactIds,...(targetDomain?{targetDomain}:{}),...(rejectedTarget?{rejectedTarget}:{}),context,consultationBrief:state.facts.filter(f=>f.status==='active'||f.status==='tentative').map(f=>`${f.status==='tentative'?'Unresolved':'Shopper'} ${f.strength} (${f.scope.kind}${f.scope.key?`: ${f.scope.key}`:''}): ${f.field}: ${formatBriefValue(f.value)}`).join('\n')};
}
export type BriefConflictResult={status:'compliant'|'conflict'|'unknown';reasons:string[]};
function readValues(record:Record<string,unknown>,attribute:string,onMissingBranch?:()=>void):unknown[]{
 if(Object.hasOwn(record,attribute)){const v=record[attribute];return Array.isArray(v)?v:[v];}
 let current:unknown[]=[record];
 for(const key of attribute.split('.'))current=current.flatMap(v=>{
  if(!v||typeof v!=='object'||Array.isArray(v)){onMissingBranch?.();return [];}
  const value=(v as Record<string,unknown>)[key];
  if(Array.isArray(value)){if(!value.length)onMissingBranch?.();return value;}
  return [value];
 });
 return current;
}
/** Resolve only exact product identity or catalogue type, never natural-language aliases. */
function recordScope(f:BriefFactV2,record:Record<string,unknown>,vocab:VocabLookup=CATALOGUE_FACET_VALUES):'applies'|'other'|'unknown'{
 if(f.scope.kind==='mission')return 'applies';
 if(f.scope.kind!=='item'||!f.scope.key)return 'unknown';
 const key=f.scope.key;
 if(typeof record.objectID==='string'&&record.objectID===key)return 'applies';
 const types=readValues(record,'Catalog_ProductType').filter((v):v is string=>typeof v==='string'&&!!v);
 if(types.some(type=>type.toLowerCase()===key.toLowerCase()))return 'applies';
 const knownTypes=vocab.Catalog_ProductType??[];
 if(knownTypes.some(type=>type.toLowerCase()===key.toLowerCase())&&types.length&&types.every(type=>knownTypes.some(known=>known.toLowerCase()===type.toLowerCase())))return 'other';
 return 'unknown';
}
/** Fact IDs that can influence an assessment for this exact record. */
export function relevantBriefFactIds(state:BriefState,record:Record<string,unknown>):string[]{
 return state.facts.filter(f=>((f.status==='active'&&f.strength==='requirement')||verifiedUnresolvedBudget(f))&&!['recipient','occasion'].includes(f.field)&&recordScope(f,record)!=='other').map(f=>f.id);
}
export function checkBriefConflicts(state:BriefState,record:Record<string,unknown>,vocab:VocabLookup=CATALOGUE_FACET_VALUES):BriefConflictResult{
 const reasons:string[]=[];let unknown=false,conflict=false;
 const requestedTypes=requestedProductTypes(state,vocab);let checkedTypes=false;
 for(const f of state.facts.filter(f=>(f.status==='active'&&f.strength==='requirement')||verifiedUnresolvedBudget(f))){
  // Gift context guides the conversation; it is not a checkable property of a product.
  if(f.field==='recipient'||f.field==='occasion')continue;
  const scope=recordScope(f,record,vocab);if(scope==='other')continue;
  if(scope==='unknown'||unavailable(f,true,vocab)){unknown=true;reasons.push(`${formatBriefValue(f.value)}: evidence or scope unavailable`);continue;}
  const v=f.value;
  if(v.kind==='money'){
   if(v.basis==='total'&&!isUpperMoneyBound(v.operator)){unknown=true;reasons.push('Combination minimum remains unassessed; no individual product minimum is implied');continue;}
   const price=record.Pricing_ActivePrice;if(typeof price!=='number'||!Number.isFinite(price)||price<0){unknown=true;reasons.push('Price is unknown');continue;}
   const cents=Math.round((price+Number.EPSILON)*100);if(!satisfiesMoneyBound(cents,v.operator,v.cents)){conflict=true;reasons.push(`Price conflicts with ${formatBriefValue(v).toLowerCase()}`);}else if(v.basis==='total'||v.basis==='unresolved'){unknown=true;reasons.push(v.basis==='unresolved'?'Individual item fits the verified price bound; budget basis and combination affordability remain unresolved':'Individual item fits the price bound; combination total remains unassessed');}
  }else if(v.kind==='facet'){
   // An exclusion needs evidence for every observed branch, even if traversal drops a missing parent.
   let missingBranch=false;
   const observed=readValues(record,v.attribute,v.operator==='none'?()=>{missingBranch=true;}:undefined);
   const values=observed.filter((x):x is string=>typeof x==='string'&&!!x);
   if(!values.length){unknown=true;reasons.push(`${v.attribute}: catalogue evidence missing`);continue;}
   const union=f.scope.kind==='mission'&&v.attribute==='Catalog_ProductType'&&v.operator==='any';
   if(union&&checkedTypes)continue;if(union)checkedTypes=true;
   const matched=values.some(x=>(union?requestedTypes:v.values).includes(x));if(v.operator==='none'?matched:!matched){conflict=true;reasons.push(`Catalogue ${v.attribute} conflicts with ${formatBriefValue(v)}`);}
   else if(v.operator==='none'&&(missingBranch||values.length!==observed.length)){unknown=true;reasons.push(`${v.attribute}: catalogue evidence incomplete`);}
  }
 }
 return {status:conflict?'conflict':unknown?'unknown':'compliant',reasons};
}
