import {useEffect,useState,type RefObject} from 'react';
import {buildContext,type PageContextState} from './context';
import {clientTraces} from './telemetry';
import {demoTrace} from './Concierge';
/** Local-only inspection of factual transport context, never model reasoning. */
export function DevInspector({state}:{state:RefObject<PageContextState>}){
 const [preview,setPreview]=useState('');
 useEffect(()=>{const timer=setInterval(()=>{try{setPreview(JSON.stringify({currentContext:buildContext(state.current||{}),requests:demoTrace.requests,timings:clientTraces},null,2));}catch(e:unknown){setPreview(e instanceof Error?e.message:'Context unavailable');}},750);return()=>clearInterval(timer);},[state]);
 return <details className="dev-inspector"><summary>Demo diagnostics</summary><p>Page context and request timing. No provider secrets or model reasoning.</p><pre data-testid="demo-diagnostics">{preview}</pre></details>;
}
