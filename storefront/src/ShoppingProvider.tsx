import {createContext,useContext,useEffect,useRef,useState,type ReactNode} from 'react';
import {normalizeProduct,type Product} from './catalog';
import {BRIEF_FIELDS,confirmProposal,type BriefFact,type BriefProposal} from '../shared/shopping';
export const SHOPPING_STORAGE_KEY='jtv.shopping.v1';
export type PinnedProduct={product:Product;quantity:number;observedAt:string};
export type ShoppingState={version:1;missionId:string;notice?:string;facts:BriefFact[];proposals:BriefProposal[];dismissedIds:string[];products:PinnedProduct[];compareIds:string[];budgetCents:number|null;budgetScope:'total'|'per-item'};
export const newShoppingState=():ShoppingState=>({version:1,missionId:crypto.randomUUID(),facts:[],proposals:[],dismissedIds:[],products:[],compareIds:[],budgetCents:null,budgetScope:'total'});
export function restoreShoppingState(value:string|null):ShoppingState{
 try{const s=JSON.parse(value||'null');if(s?.version!==1||typeof s.missionId!=='string'||!s.missionId||s.missionId.length>100)return newShoppingState();
 const products=(Array.isArray(s.products)?s.products:[]).slice(0,12).flatMap((p:any)=>{try{return [{product:normalizeProduct(p.product.raw),quantity:Number.isInteger(p.quantity)&&p.quantity>=1&&p.quantity<=10?p.quantity:1,observedAt:typeof p.observedAt==='string'?p.observedAt:''}]}catch{return []}});
 const text=(v:unknown,max:number)=>typeof v==='string'&&v.trim().length>0&&v.length<=max;
 const validFact=(f:any)=>f&&text(f.id,20000)&&BRIEF_FIELDS.includes(f.field)&&text(f.value,300)&&text(f.quote,2000)&&text(f.messageId,200)&&(f.scope===undefined||text(f.scope,200));
 return {...newShoppingState(),missionId:s.missionId,products,dismissedIds:(Array.isArray(s.dismissedIds)?s.dismissedIds:[]).filter((id:unknown)=>typeof id==='string'&&id.length<=20000).slice(-100),facts:(Array.isArray(s.facts)?s.facts:[]).filter((f:any)=>validFact(f)&&f.status==='confirmed'&&(f.source==='user-confirmed'||f.source==='user-edited')).slice(0,40),proposals:(Array.isArray(s.proposals)?s.proposals:[]).filter((f:any)=>validFact(f)&&f.status==='proposed').slice(0,20),compareIds:(Array.isArray(s.compareIds)?s.compareIds:[]).filter((id:string)=>products.some((p:PinnedProduct)=>p.product.id===id)).slice(0,3),budgetCents:Number.isSafeInteger(s.budgetCents)&&s.budgetCents>=0?s.budgetCents:null,budgetScope:s.budgetScope==='per-item'?'per-item':'total'};
 }catch{return newShoppingState()}
}
export function pinRecord(state:ShoppingState,raw:unknown):ShoppingState{
 const product=normalizeProduct(raw);if(state.products.some(p=>p.product.id===product.id))return state;
 if(state.products.length>=12)throw new Error('Your shortlist holds 12 pieces. Remove one before adding another.');
 return {...state,products:[...state.products,{product,quantity:1,observedAt:new Date().toISOString()}]};
}
/** Accept is explicitly labelled as replacement in the UI when that field already exists. */
export function acceptShoppingProposal(state:ShoppingState,id:string):ShoppingState {
 const p=state.proposals.find(p=>p.id===id);if(!p)return state;
 const previous=state.facts.filter(f=>f.field===p.field);
 return {...state,...(p.field==='budget'?{budgetCents:null}:{}),facts:[...state.facts.filter(f=>f.field!==p.field),confirmProposal(p)].slice(-40),dismissedIds:[...state.dismissedIds,...previous.map(f=>f.id)].slice(-100),proposals:state.proposals.filter(p=>p.id!==id)};
}
type Shopping=ShoppingState&{error:string;pin:(raw:unknown)=>void;remove:(id:string)=>void;setQuantity:(id:string,n:number)=>void;toggleCompare:(id:string)=>void;setBudget:(cents:number|null,scope:'total'|'per-item')=>void;addProposals:(p:BriefProposal[],missionId:string)=>void;acceptProposal:(id:string)=>void;rejectProposal:(id:string)=>void;editFact:(id:string,value:string)=>void;removeFact:(id:string)=>void;addFact:(field:BriefFact['field'],value:string)=>void;resetMission:()=>void;getContext:()=>Record<string,unknown>};
const Context=createContext<Shopping|null>(null);
export function useShopping(){return useContext(Context)}
export function ShoppingProvider({children}:{children:ReactNode}){
 const [state,setState]=useState<ShoppingState>(()=>{try{return restoreShoppingState(sessionStorage.getItem(SHOPPING_STORAGE_KEY))}catch{return newShoppingState()}});
 const [error,setError]=useState('');const latest=useRef(state);latest.current=state;
 useEffect(()=>{try{sessionStorage.setItem(SHOPPING_STORAGE_KEY,JSON.stringify(state))}catch{setError('Your shortlist is available now, but this browser could not save it for a refresh.')}},[state]);
 const value:Shopping={...state,error:state.notice||error,
 pin(raw){setState(s=>{try{return {...pinRecord(s,raw),notice:''}}catch(e){return {...s,notice:e instanceof Error?e.message:'This product could not be saved.'}}})},
 remove(id){setState(s=>({...s,products:s.products.filter(p=>p.product.id!==id),compareIds:s.compareIds.filter(x=>x!==id)}))},
 setQuantity(id,n){if(Number.isInteger(n)&&n>=1&&n<=10)setState(s=>({...s,products:s.products.map(p=>p.product.id===id?{...p,quantity:n}:p)}))},
 toggleCompare(id){setState(s=>{if(s.compareIds.includes(id))return {...s,compareIds:s.compareIds.filter(x=>x!==id)};if(s.compareIds.length>=3||!s.products.some(p=>p.product.id===id))return s;return {...s,compareIds:[...s.compareIds,id]}})},
 setBudget(cents,scope){if(cents===null||(Number.isSafeInteger(cents)&&cents>=0))setState(s=>({...s,budgetCents:cents,budgetScope:scope,facts:s.facts.filter(f=>f.field!=='budget'),proposals:s.proposals.filter(p=>p.field!=='budget'),dismissedIds:[...s.dismissedIds,...s.facts.filter(f=>f.field==='budget').map(f=>f.id),...s.proposals.filter(p=>p.field==='budget').map(p=>p.id)].slice(-100)}))},
 addProposals(proposals,missionId){setState(s=>s.missionId!==missionId?s:{...s,proposals:proposals.filter(p=>!s.dismissedIds.includes(p.id)&&!s.facts.some(f=>f.id===p.id)).slice(-20)})},
 acceptProposal(id){setState(s=>acceptShoppingProposal(s,id))},
 rejectProposal(id){setState(s=>({...s,dismissedIds:[...s.dismissedIds,id].slice(-100),proposals:s.proposals.filter(p=>p.id!==id)}))},
 editFact(id,value){if(value.trim())setState(s=>({...s,facts:s.facts.map(f=>f.id===id?{...f,value:value.trim().slice(0,300),source:'user-edited'}:f)}))},
 removeFact(id){setState(s=>({...s,dismissedIds:[...s.dismissedIds,id].slice(-100),facts:s.facts.filter(f=>f.id!==id)}))},
 addFact(field,value){if(value.trim())setState(s=>({...s,...(field==='budget'?{budgetCents:null}:{}),dismissedIds:[...s.dismissedIds,...s.facts.filter(f=>f.field===field).map(f=>f.id)].slice(-100),facts:[...s.facts.filter(f=>f.field!==field),{id:crypto.randomUUID(),field,value:value.trim().slice(0,300),quote:value.trim().slice(0,300),messageId:'explicit-ui-entry',status:'confirmed' as const,source:'user-edited' as const}].slice(-40)}))},
 resetMission(){setState(newShoppingState());setError('')},
 getContext(){const s=latest.current;return {missionId:s.missionId,confirmedBrief:s.facts.map(({field,value,quote,source,scope,messageId})=>({field,value,quote,source,scope,messageId})),budget:s.budgetCents===null?null:{amount:s.budgetCents/100,currency:'USD',scope:s.budgetScope,source:'explicit UI entry'},shortlist:s.products.map(({product:p,quantity,observedAt})=>({objectID:p.id,title:p.title,quantity,observedPrice:p.price,observedAt,priceNeedsRefresh:true})),comparisonIds:s.compareIds}}
 };
 return <Context.Provider value={value}>{children}</Context.Provider>
}
