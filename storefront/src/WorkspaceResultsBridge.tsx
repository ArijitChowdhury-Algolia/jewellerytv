import {useEffect,useRef} from 'react';
import type {ClientSideToolComponentProps} from 'instantsearch-ui-components';
import {responseBindings,workspaceTraceForTool} from './telemetry';
import {ConversationText} from './ConversationText';
import {useShopping} from './ShoppingProvider';
import {workspaceGroups,mayCommitResults} from './workspaceResults';
/** Product tools hydrate the workspace; conversation gets a short handoff, not duplicate cards. */
export function WorkspaceResultsBridge({context}:ClientSideToolComponentProps){
 const shopping=useShopping();const latest=useRef(shopping);latest.current=shopping;const committed=useRef('');
 const part=context.message;const payload=part.input??part.output;
 const result=workspaceGroups(payload,id=>context.records?.get(id));
 const message=context.messages.find(m=>m.parts.some(p=>p===part||('toolCallId' in p&&p.toolCallId===part.toolCallId)));
 const isLatest=message===context.messages.at(-1);
 const identity=JSON.stringify([part.toolCallId,result.groups.map(g=>g.items.map(i=>[i.product.id,i.product.price]))]);
 useEffect(()=>{
  if(!latest.current||!result.groups.length||!mayCommitResults(context.status,isLatest,part.state)||committed.current===identity)return;
  const index=message?context.messages.indexOf(message):-1;const user=context.messages.slice(0,index).filter(m=>m.role==='user').at(-1);const binding=user?responseBindings.get(user.id):undefined;
  const trace=user?workspaceTraceForTool(user.id,part.toolCallId):undefined;
  committed.current=identity;latest.current.setDiscoveries(result.groups,result.intro,binding?{...binding,...(trace?{trace:{requestId:trace.requestId,turnId:trace.turnId,missionId:binding.missionId,revision:binding.revision}}:{})}:undefined);
 },[context.status,isLatest,part.state,identity]);
 if(!shopping)return <></>;
 if(context.status==='streaming'&&isLatest)return <p className="workspace-handoff" role="status">Putting your choices together…</p>;
 if(!result.groups.length)return <></>;
 return <div className="workspace-conversation"><ConversationText text={result.intro}/><button className="workspace-product-link" onClick={()=>shopping.openWorkspace()}>View these pieces</button></div>;
}
