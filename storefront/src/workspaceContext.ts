export type UserEvidence = {id:string;text:string};
type Message = {id:string;role:string;parts:ReadonlyArray<{type:string;text?:unknown}>};
/** Only current-mission human text can support proposed shopping preferences. */
export function missionMessages(messages:ReadonlyArray<Message>):UserEvidence[]{
 return messages.filter(m=>m.role==='user').map(m=>({id:m.id,text:m.parts.filter(p=>p.type==='text'&&typeof p.text==='string').map(p=>p.text as string).join('\n')})).filter(m=>m.text.trim());
}
/** The platform rejects oversized context; never silently drop confirmed constraints. */
export function mergeShoppingContext(page:Record<string,string>,shopping:Record<string,string>):Record<string,string>{
 if(Object.keys(shopping).some(k=>k in page))throw new Error('Shopping context conflicts with page context.');
 const result={...page,...shopping}; const bytes=(s:string)=>new TextEncoder().encode(s).length;
 if(Object.keys(result).length>32||Object.values(result).some(v=>bytes(v)>1024)||bytes(JSON.stringify(result))>4096)throw new Error('Your shopping brief is too long to send. Shorten it before continuing.');
 return result;
}
/** Encode lists without breaking the platform's per-field string limits. */
export function encodeShoppingContext(state:Record<string,unknown>):Record<string,string>{
 const result:Record<string,string>={};const bytes=(s:string)=>new TextEncoder().encode(s).length;
 for(const [name,value] of Object.entries(state)){
  if(value===null||value===undefined)continue;
  if(Array.isArray(value)){
   let chunk:unknown[]=[];let index=0;
   for(const item of value){if(bytes(JSON.stringify([item]))>1024)throw new Error('A shopping preference is too long. Shorten it before continuing.');
    if(bytes(JSON.stringify([...chunk,item]))>1024){result[`shopping_${name}_${index++}`]=JSON.stringify(chunk);chunk=[];}chunk.push(item);}
   if(chunk.length)result[`shopping_${name}_${index}`]=JSON.stringify(chunk);
  }else result[`shopping_${name}`]=typeof value==='string'?value:JSON.stringify(value);
 }
 return mergeShoppingContext({},result);
}
export {briefEvidenceWindow} from '../shared/shopping';
