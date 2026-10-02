import {useEffect,useRef,useState} from 'react';
import {validateProposals} from '../shared/shopping';
import {missionMessages,briefEvidenceWindow} from './workspaceContext';
import {useShopping} from './ShoppingProvider';
import type {ChatLayoutOwnProps} from 'instantsearch-ui-components';
/** Extraction never blocks a reply; confirmed brief changes require the shopper's action. */
export function useBriefProposals(messages:ChatLayoutOwnProps['messages'],status:ChatLayoutOwnProps['status']){
 const shopping=useShopping();const latest=useRef(shopping);latest.current=shopping;
 const [error,setError]=useState('');const [loading,setLoading]=useState(false);const [retry,setRetry]=useState(0);
 const window=briefEvidenceWindow(missionMessages(messages));const users=window.messages;const signature=JSON.stringify(users);const missionId=shopping?.missionId;
 useEffect(()=>{
  if(!missionId||!users.length||status==='streaming'||status==='submitted'){setLoading(false);setError('');return;}
  const abort=new AbortController();setLoading(true);setError('');
  fetch('/api/brief',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({missionId,messages:users}),signal:abort.signal})
   .then(async r=>{if(!r.ok)throw new Error('Your shopping notes could not be updated. You can edit them yourself or retry.');return r.json()})
   .then(body=>{const proposals=validateProposals(body,users);latest.current?.addProposals(proposals,missionId)})
   .catch(e=>{if(!abort.signal.aborted)setError(e instanceof Error?e.message:'Shopping notes could not be updated.')})
   .finally(()=>{if(!abort.signal.aborted)setLoading(false)});
  return ()=>abort.abort();
 // Serialized user text is the request identity; assistant streaming must not trigger more calls.
 },[signature,missionId,status==='streaming'||status==='submitted',retry]);
 return {error,loading,notice:window.error?window.error:window.omittedCount?'Automatic notes use recent complete messages. Your confirmed preferences remain saved. You can add anything missed manually.':'',retry:()=>setRetry(x=>x+1)};
}
