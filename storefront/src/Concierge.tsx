import {forwardRef,useImperativeHandle,useRef,useMemo,useState,useCallback,useEffect,type ComponentProps} from 'react';
import {Chat,ChatTrigger,SearchIndexToolType,GroupedResultsToolType,DisplayResultsToolType,type ChatHandle} from 'react-instantsearch';
import type {ChatLayoutOwnProps} from 'instantsearch-ui-components';
import type {IndexUiState} from 'instantsearch.js';
import {MessageCircle,ChevronDown} from 'lucide-react';
import {OptionalSuggestions} from './OptionalSuggestions';
import {WorkspaceResultsBridge} from './WorkspaceResultsBridge';
import {AgentResults} from './AgentResults';
import {ProductCard} from './ProductCard';
import {searchURL} from './routing';
import {useShopping} from './ShoppingProvider';
import {ShoppingWorkspace} from './ShoppingWorkspace';
import {ShoppingBrief} from './ShoppingBrief';
import {createConciergeTransport} from './conciergeTransport';
import {createBriefState} from '../shared/briefState';
import {responseBindings,clientTraces} from './telemetry';
import {encodeShoppingContext,mergeShoppingContext} from './workspaceContext';
import './shopping-workspace.css';
import './concierge-workspace.css';
export interface ConciergeHandle{ask:()=>void}
export const demoTrace:{context:Record<string,string>|null;contextError:string;requests:Array<{at:string;context:unknown;conversationId?:string;status?:number;elapsedMs?:number}>}={context:null,contextError:'',requests:[]};
const translations={header:{title:'JTV Jewelry Concierge'}};
const baselineTools={[SearchIndexToolType]:{layoutComponent:AgentResults}};
const workspaceTools={...baselineTools,algolia_search_for_facet_values:{layoutComponent:()=> <></>,shouldRender:()=>false},[SearchIndexToolType]:{layoutComponent:()=> <></>},[GroupedResultsToolType]:{layoutComponent:WorkspaceResultsBridge},[DisplayResultsToolType]:{layoutComponent:WorkspaceResultsBridge}};
const searchPageURL=(state:IndexUiState)=>searchURL('/search',state);
function ChatItem({item}:{item:{objectID:string}}){return <ProductCard item={item}/>;}
function ChatLayout(props:ChatLayoutOwnProps){
 const shopping=useShopping();const [section,setSection]=useState<'conversation'|'shopping'>('conversation');
 const shown=useRef(shopping?.displayRequest);useEffect(()=>{if(shopping?.displayRequest!==shown.current){shown.current=shopping?.displayRequest;setSection('shopping')}},[shopping?.displayRequest]);
 const [resetting,setResetting]=useState(false);const [sendError,setSendError]=useState('');const awaiting=props.status==='streaming'||props.status==='submitted';const currentUser=props.messages.filter(m=>m.role==='user').at(-1)?.id;const trace=[...clientTraces].reverse().find(t=>t.turnId===currentUser);const updatingBrief=awaiting&&!trace?.events.some(e=>e.type==='data-shopping-brief');
 const reset=()=>{props.stop();props.clearMessages?.();shopping?.resetMission();setResetting(false);setSection('conversation')};
 if(!props.open)return <></>;
 return <aside className={`concierge-panel ${shopping?'concierge-workspace':''} ${shopping&&!shopping.hasDisplay?'conversation-first':''} ${props.maximized?'maximized':''}`} aria-label="Jewelry buying concierge">
 <div className="concierge-header">{props.headerComponent}<button className="new-conversation" onClick={()=>setResetting(true)}>New conversation</button>{shopping&&!shopping.hasDisplay&&(shopping.products.length>0||shopping.selectionRecords.length>0)&&<button className="review-saved" onClick={()=>{shopping.setView('saved');shopping.openWorkspace()}}>Review saved pieces</button>}</div>
 {resetting&&<div className="mission-reset" role="alert"><p>Start fresh? Your shopping brief will be cleared. Saved pieces will stay for you to review.</p><button onClick={reset}>Start a new mission</button><button onClick={()=>setResetting(false)}>Keep shopping</button></div>}
 {shopping?.hasDisplay&&<nav className="workspace-sections" aria-label="Concierge sections"><button aria-pressed={section==='conversation'} onClick={()=>setSection('conversation')}>Conversation</button><button aria-pressed={section==='shopping'} onClick={()=>setSection('shopping')}>Products</button></nav>}
 <div className="concierge-workspace-body" data-section={section}>
 <section className="conversation-column" aria-label="Conversation">{shopping&&<ShoppingBrief busy={updatingBrief}/>}<div className="concierge-messages">{sendError&&<p className="brief-error" role="alert">{sendError}</p>}{props.messagesComponent}</div><div className="concierge-prompt">{props.promptComponent}</div></section>
 {shopping?.hasDisplay&&<section className="shopping-column" aria-label="Your shopping workspace">
 <ShoppingWorkspace onSend={text=>{setSection('conversation');if(demoTrace.contextError){setSendError(demoTrace.contextError);return}setSendError('');void props.sendMessage({text}).catch(e=>setSendError(e instanceof Error?e.message:'Your message could not be sent.'))}} onReset={()=>setResetting(true)}/>
 </section>}
 </div></aside>;
}
function ConciergeToggle({isOpen}:{isOpen:boolean}){return <>{isOpen?<ChevronDown size={20}/>:<MessageCircle size={20}/>}<span>Concierge</span></>;}
type ErrorViewProps=Parameters<NonNullable<ComponentProps<typeof Chat>['messagesErrorComponent']>>[0];
export function ChatFailure({context}:ErrorViewProps){const sendNew=context.error?.message.includes('after this message was sent');const stale=context.error?.message.includes('preferences changed');const brief=context.error?.message.includes('preference change has not');return <article className="brief-error" role="alert"><p>{sendNew?'Your newer brief is safe. Send a new message to continue with it.':stale?'Your preferences changed while that reply was being prepared. Your newer brief is safe; retry with it.':brief?'Your latest preference change has not been applied. Your saved choices are safe; retry before searching.':'That reply couldn’t load. Your saved pieces and shopping brief are still here.'}</p>{!sendNew&&<button onClick={()=>context.onReload()}>Retry this reply</button>}</article>}
function EmptyChat(){return <div className="concierge-welcome"><span className="welcome-gem">◇</span><h2>Find something you’ll love.</h2><p>Tell me what you have in mind, or open a piece and ask me about it.</p><p className="muted">A gift, a little everyday sparkle, or something just for you.</p></div>;}
export const Concierge=forwardRef<ConciergeHandle,{context:()=>Record<string,string>;blocked:string}>(function Concierge({context,blocked},ref){
 const chat=useRef<ChatHandle>(null);const shopping=useShopping();const shoppingRef=useRef(shopping);shoppingRef.current=shopping;const previousMission=useRef(shopping?.missionId);
 useEffect(()=>{if(previousMission.current!==shopping?.missionId){previousMission.current=shopping?.missionId;chat.current?.setOpen(true)}},[shopping?.missionId]);
 const combinedContext=useCallback(()=>{try{const data=shoppingRef.current?.getContext()??{};if(enabledRef.current===true){delete data.brief;delete data.confirmedBrief;delete data.budget}const value=mergeShoppingContext(context(),encodeShoppingContext(data));demoTrace.contextError='';return value}catch(e){demoTrace.contextError=e instanceof Error?e.message:'Shopping context is too large.';throw e}},[context]);
 const [v2Enabled,setV2Enabled]=useState<boolean|undefined>(undefined);const baselineBrief=useRef(createBriefState('baseline-'+crypto.randomUUID()));
 useEffect(()=>{const abort=new AbortController();fetch('/api/health',{signal:abort.signal}).then(r=>r.json()).then(d=>setV2Enabled(d.briefV2Enabled===true)).catch(()=>{if(!abort.signal.aborted)setV2Enabled(false)});return ()=>abort.abort()},[]);
 const enabledRef=useRef(v2Enabled);enabledRef.current=v2Enabled;
 const transport=useMemo(()=>createConciergeTransport(()=>({enabled:enabledRef.current===true,getBrief:()=>shoppingRef.current?.getBrief()??baselineBrief.current,accept:(next,base,mission)=>{if(shoppingRef.current)return shoppingRef.current.acceptServerBrief(next,base,mission);if(baselineBrief.current.missionId!==mission||baselineBrief.current.revision!==base)return false;baselineBrief.current=next;return true},onBinding:binding=>{responseBindings.set(binding.turnId,binding);if(responseBindings.size>100)responseBindings.delete(responseBindings.keys().next().value!);}})),[]);
 const promptProps=useMemo(()=>({disabled:!!blocked||v2Enabled===undefined}),[blocked,v2Enabled]);
 useImperativeHandle(ref,()=>({ask:()=>{chat.current?.setOpen(true);chat.current?.setInput('Tell me about this item.');}}),[]);
 return <>{blocked&&<div className="context-status" role="status">{blocked}</div>}<Chat key={shopping?.missionId??'baseline'} ref={chat} transport={transport} context={combinedContext} persistence={false} showReasoning={false} translations={translations} title="JTV Jewelry Concierge" itemComponent={ChatItem} messagesErrorComponent={ChatFailure} suggestionsComponent={OptionalSuggestions} tools={shopping?workspaceTools:baselineTools} promptProps={promptProps} getSearchPageURL={searchPageURL} layoutComponent={ChatLayout} emptyComponent={EmptyChat}/><ChatTrigger aria-label="Open jewelry concierge" toggleIconComponent={ConciergeToggle}/></>;
});
