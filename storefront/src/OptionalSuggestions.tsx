import type {ComponentProps} from 'react';
import {Chat} from 'react-instantsearch';
type Props=Parameters<NonNullable<ComponentProps<typeof Chat>['suggestionsComponent']>>[0];
/** Opt-in shortcuts support a conversation without becoming an automatic questionnaire. */
export function OptionalSuggestions({suggestions=[],onSuggestionClick}:Props){
 const options=[...new Set(suggestions.map(s=>s.trim()).filter(Boolean))].slice(0,2);
 if(!options.length)return <></>;
 return <details className="optional-suggestions"><summary>Need an idea for what to ask?</summary><div>{options.map(s=><button key={s} onClick={()=>onSuggestionClick(s)}>{s}</button>)}</div></details>;
}
