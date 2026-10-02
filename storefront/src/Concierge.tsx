import {forwardRef,useImperativeHandle,useRef,useMemo,useState,useCallback} from 'react';
import {Chat,ChatTrigger,SearchIndexToolType,type ChatHandle} from 'react-instantsearch';
import type {ChatLayoutOwnProps} from 'instantsearch-ui-components';
import type {IndexUiState} from 'instantsearch.js';
import {MessageCircle,ChevronDown} from 'lucide-react';
import {AgentResults} from './AgentResults';
import {ProductCard} from './ProductCard';
import {searchURL} from './routing';
import {useShopping} from './ShoppingProvider';
import {ShoppingWorkspace} from './ShoppingWorkspace';
import {useBriefProposals} from './useBriefProposals';
import {encodeShoppingContext,mergeShoppingContext} from './workspaceContext';
import './shopping-workspace.css';
import './concierge-workspace.css';
export interface ConciergeHandle{ask:()=>void}
export const demoTrace:{context:Record<string,string>|null;contextError:string;requests:Array<{at:string;context:unknown;conversationId?:string;status?:number;elapsedMs?:number}>}={context:null,contextError:'',requests:[]};
const transport={api:'/api/chat',fetch:async(input:RequestInfo|URL,init?:RequestInit)=>{
 if(demoTrace.contextError)throw new Error(demoTrace.contextError);
 const started=performance.now();let context:unknown=null;let conversationId:string|undefined;
 if(typeof init?.body==='string'){const b=JSON.parse(init.body);conversationId=b.id;context=b.messages?.filter((m:{role:string})=>m.role==='user').at(-1)?.metadata?.turnContext??null;}
 const entry={at:new Date().toISOString(),context,conversationId,status:undefined as number|undefined,elapsedMs:undefined as number|undefined};demoTrace.requests.push(entry);
 const response=await fetch(input,init);entry.status=response.status;entry.elapsedMs=Math.round(performance.now()-started);return response;
}};
const translations={header:{title:'JTV Jewelry Concierge'}};
const tools={[SearchIndexToolType]:{layoutComponent:AgentResults}};
const searchPageURL=(state:IndexUiState)=>searchURL('/search',state);
function ChatItem({item}:{item:{objectID:string}}){return <ProductCard item={item}/>;}
function ChatLayout(props:ChatLayoutOwnProps){
 const shopping=useShopping();const [section,setSection]=useState<'conversation'|'shopping'>('conversation');
 const [resetting,setResetting]=useState(false);const notes=useBriefProposals(props.messages,props.status);
 const reset=()=>{props.stop();props.clearMessages?.();shopping?.resetMission();setResetting(false);setSection('conversation')};
 if(!props.open)return <></>;
 return <aside className={`concierge-panel ${shopping?'concierge-workspace':''} ${props.maximized?'maximized':''}`} aria-label="Jewelry buying concierge">
 <div className="concierge-header">{props.headerComponent}<button className="new-conversation" onClick={()=>setResetting(true)}>New conversation</button></div>
 {resetting&&<div className="mission-reset" role="alert"><p>Start fresh? Your current shopping brief and saved pieces will be cleared.</p><button onClick={reset}>Start a new mission</button><button onClick={()=>setResetting(false)}>Keep shopping</button></div>}
 {shopping&&<nav className="workspace-sections" aria-label="Concierge sections"><button aria-pressed={section==='conversation'} onClick={()=>setSection('conversation')}>Conversation</button><button aria-pressed={section==='shopping'} onClick={()=>setSection('shopping')}>My shopping ({shopping.products.length})</button></nav>}
 <div className="concierge-workspace-body" data-section={section}>
 <section className="conversation-column" aria-label="Conversation"><div className="concierge-messages">{props.messagesComponent}</div><div className="concierge-prompt">{props.promptComponent}<small>Catalogue-backed discovery · Local demo</small></div></section>
 {shopping&&<section className="shopping-column" aria-label="Your shopping workspace">
 {notes.notice&&<p className="brief-status">{notes.notice}</p>}
 {notes.loading&&<p className="brief-status" role="status">Updating your shopping notes…</p>}
 {notes.error&&<div className="brief-error" role="status">{notes.error}<button onClick={notes.retry}>Retry notes</button></div>}
 <ShoppingWorkspace onSend={text=>{setSection('conversation');void props.sendMessage({text})}} onReset={()=>setResetting(true)}/>
 </section>}
 </div></aside>;
}
function ConciergeToggle({isOpen}:{isOpen:boolean}){return <>{isOpen?<ChevronDown size={20}/>:<MessageCircle size={20}/>}<span>Concierge</span></>;}
function EmptyChat(){return <div className="concierge-welcome"><span className="welcome-gem">◇</span><h2>Find something you’ll love.</h2><p>Tell me what you have in mind, or open a piece and ask me about it.</p><p className="muted">A gift, a little everyday sparkle, or something just for you.</p></div>;}
export const Concierge=forwardRef<ConciergeHandle,{context:()=>Record<string,string>;blocked:string}>(function Concierge({context,blocked},ref){
 const chat=useRef<ChatHandle>(null);const shopping=useShopping();const shoppingRef=useRef(shopping);shoppingRef.current=shopping;
 const combinedContext=useCallback(()=>{try{const value=mergeShoppingContext(context(),shoppingRef.current?encodeShoppingContext(shoppingRef.current.getContext()):{});demoTrace.contextError='';return value}catch(e){demoTrace.contextError=e instanceof Error?e.message:'Shopping context is too large.';throw e}},[context]);
 const promptProps=useMemo(()=>({disabled:!!blocked}),[blocked]);
 useImperativeHandle(ref,()=>({ask:()=>{chat.current?.setOpen(true);chat.current?.setInput('Tell me about this item.');}}),[]);
 return <>{blocked&&<div className="context-status" role="status">{blocked}</div>}<Chat key={shopping?.missionId??'baseline'} ref={chat} transport={transport} context={combinedContext} persistence={false} showReasoning={false} translations={translations} title="JTV Jewelry Concierge" itemComponent={ChatItem} tools={tools} promptProps={promptProps} getSearchPageURL={searchPageURL} layoutComponent={ChatLayout} emptyComponent={EmptyChat}/><ChatTrigger aria-label="Open jewelry concierge" toggleIconComponent={ConciergeToggle}/></>;
});
