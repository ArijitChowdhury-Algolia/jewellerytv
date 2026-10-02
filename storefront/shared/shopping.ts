/** Current-mission facts are confirmed by the shopper, never by model confidence. */
export const BRIEF_FIELDS = ['recipient','occasion','budget','material','style','exclusion','unknown','other'] as const;
export type BriefField = typeof BRIEF_FIELDS[number];
export type BriefMessage = {id:string;text:string};
export type BriefRequest = {missionId:string;messages:BriefMessage[]};
export type BriefProposal = {id:string;field:BriefField;value:string;quote:string;messageId:string;status:'proposed';scope?:string};
export type BriefFact = Omit<BriefProposal,'status'> & {status:'confirmed';source:'user-confirmed'|'user-edited'};

/** Strict provenance gate. A valid quote is evidence of wording, not proof of interpretation. */
export function validateProposals(raw:unknown,messages:BriefMessage[]):BriefProposal[] {
 const input=Array.isArray(raw)?raw:(raw&&typeof raw==='object'?(raw as {proposals?:unknown}).proposals:undefined);
 if(!Array.isArray(input)||input.length>20)throw new Error('Invalid brief proposals');
 const byId=new Map(messages.map(m=>[m.id,m.text]));
 const seen=new Set<string>();
 return input.map((item)=>{
  if(!item||typeof item!=='object')throw new Error('Invalid brief proposal');
  const p=item as Record<string,unknown>;
  if(!BRIEF_FIELDS.includes(p.field as BriefField)||typeof p.value!=='string'||!p.value.trim()||p.value.length>300||typeof p.quote!=='string'||!p.quote.trim()||p.quote.length>2000||typeof p.messageId!=='string'||!byId.get(p.messageId)?.includes(p.quote)|| (p.scope!==undefined&&(typeof p.scope!=='string'||p.scope.length>200)))throw new Error('Brief proposal failed provenance validation');
  const key=JSON.stringify([p.field,p.value.trim(),p.messageId,p.quote,p.scope??null]);
  if(seen.has(key))throw new Error('Duplicate brief proposal');seen.add(key);
  return {id:`proposal-${encodeURIComponent(key)}`,field:p.field as BriefField,value:p.value.trim(),quote:p.quote,messageId:p.messageId,status:'proposed',...(p.scope?{scope:p.scope as string}:{})};
 });
}
export function confirmProposal(proposal:BriefProposal,editedValue?:string):BriefFact {
 const value=(editedValue??proposal.value).trim();
 if(!value||value.length>300)throw new Error('Brief value must contain 1–300 characters');
 return {...proposal,value,status:'confirmed',source:editedValue===undefined?'user-confirmed':'user-edited'};
}
export function pairTotal(items:readonly {price:number|null|undefined;quantity?:number}[]) {
 let knownSubtotalCents=0;let unknownCount=0;
 for(const item of items){
  const quantity=item.quantity??1;
  if(!Number.isInteger(quantity)||quantity<1||quantity>100)throw new Error('Invalid quantity');
  if(typeof item.price!=='number'||!Number.isFinite(item.price)||item.price<0){unknownCount++;continue;}
  const cents=Math.round((item.price+Number.EPSILON)*100);
  if(!Number.isSafeInteger(cents)||!Number.isSafeInteger(knownSubtotalCents+cents*quantity))throw new Error('Price exceeds supported range');
  knownSubtotalCents+=cents*quantity;
 }
 return {totalCents:unknownCount?null:knownSubtotalCents,knownSubtotalCents,unknownCount};
}

/** A bounded, contiguous recent evidence window. Never truncate a sentence/qualifier. */
export function briefEvidenceWindow(messages:readonly BriefMessage[]):{messages:BriefMessage[];omittedCount:number;error?:string}{
 const selected:BriefMessage[]=[];
 for(let i=messages.length-1;i>=0;i--){
  const candidate=messages[i];
  if(selected.length>=20||candidate.text.length>2000||new TextEncoder().encode(JSON.stringify([candidate,...selected])).length>14000)break;
  selected.unshift(candidate);
 }
 return {messages:selected,omittedCount:messages.length-selected.length,...(!selected.length&&messages.length?{error:'Your latest message is too long for automatic shopping notes. You can edit the brief manually or send a shorter clarification.'}:{})};
}
