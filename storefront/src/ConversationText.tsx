import {Fragment} from 'react';
/** Render basic emphasis as React text, never model-supplied HTML. */
export function ConversationText({text}:{text:string}){return <>{text.split(/\n\s*\n/).filter(Boolean).map((p,i)=><p key={i}>{p.split(/(\*\*[^*]+\*\*)/g).map((part,j)=>part.startsWith('**')&&part.endsWith('**')?<strong key={j}>{part.slice(2,-2)}</strong>:<Fragment key={j}>{part}</Fragment>)}</p>)}</>}
