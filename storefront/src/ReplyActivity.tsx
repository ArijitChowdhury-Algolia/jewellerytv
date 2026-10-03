import {useEffect,useState,type ComponentProps} from 'react';
import {Chat} from 'react-instantsearch';
import {clientTraces,type ClientTrace,traceElapsed} from './telemetry';
import './reply-activity.css';

export function replyActivity(trace?:ClientTrace){
 const events=trace?.events??[];
 const searches=new Set(events.filter(e=>e.toolKind==='search').map(e=>e.toolCallId).filter((id):id is string=>!!id));
 const completed=new Set(events.filter(e=>e.type==='tool-output-available'&&!!e.toolCallId&&searches.has(e.toolCallId)).map(e=>e.toolCallId));
 const pending=[...searches].some(id=>!events.some(e=>e.toolCallId===id&&(e.type==='tool-output-available'||e.type==='tool-output-error')));
 const history=['Request started'];
 if(events.some(e=>e.type==='data-shopping-brief'))history.push('Shopping brief received');
 if(searches.size)history.push(`${searches.size===1?'Catalogue search started':`${searches.size} catalogue searches started`}`);
 if(completed.size)history.push('Catalogue results received');
 const writing=trace?.firstUsefulOutputMs!==undefined;
 if(writing)history.push('Reply started');
 const label=trace?.termination==='failed'?'Reply interrupted':trace?.termination==='cancelled'?'Reply stopped':trace?.termination==='finished'?'Reply ready':pending?'Searching the catalogue':writing?'Preparing your reply':completed.size?'Putting your reply together':'Working on your request';
 return {label,history};
}
export function useReplyActivity(turnId:string|undefined,active:boolean){
 const [,refresh]=useState(0);
 useEffect(()=>{if(!active)return;const timer=setInterval(()=>refresh(n=>n+1),500);return()=>clearInterval(timer)},[active,turnId]);
 const trace=[...clientTraces].reverse().find(t=>t.turnId===turnId);
 return {...replyActivity(trace),elapsed:trace?Math.floor(traceElapsed(trace)/1000):0};
}
type Props=Parameters<NonNullable<ComponentProps<typeof Chat>['loaderComponent']>>[0];
/** Public activity only. No internal reasoning, query text, guessed stages or percentages. */
export function ReplyActivity({context}:Props){
 const turnId=context.messages.filter(m=>m.role==='user').at(-1)?.id;
 const active=context.status==='submitted'||context.status==='streaming';
 const {label,history,elapsed}=useReplyActivity(turnId,active);
 if(!active)return <></>;
 return <details className="reply-activity"><summary><span className="reply-activity-label" role="status" aria-live="polite">{label}</span><span className="reply-activity-time" aria-hidden="true">{elapsed}s</span><span className="reply-activity-disclosure" aria-hidden="true">⌄</span></summary><ol aria-label="Activity so far">{history.map(item=><li key={item}>{item}</li>)}</ol></details>;
}
