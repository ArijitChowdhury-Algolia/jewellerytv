import {useNavigate} from 'react-router-dom';
import {getApplyFiltersParamsFromToolInput,getResolvedSearchParams,type ClientSideToolComponentProps,type SearchToolInput} from 'instantsearch-ui-components';
import {z} from 'zod';
import {ProductCard} from './ProductCard';
import {agentSearchURL} from './routing';
const resultSchema=z.object({hits:z.array(z.object({objectID:z.string()}).passthrough()),nbHits:z.number().optional()}).passthrough();
/** Replace the default full-page View all transition with a local SPA transition. */
export function AgentResults({context}:ClientSideToolComponentProps){
 const navigate=useNavigate();const parsed=resultSchema.safeParse(context.message.output);
 if(!parsed.success)return <></>;
 const {hits,nbHits}=parsed.data;
 const resolved=getResolvedSearchParams(context.messages,context.message.toolCallId);
 const constraints=getApplyFiltersParamsFromToolInput(context.message.input as SearchToolInput,resolved);
 return <section className="agent-results"><div className="agent-results-heading"><span>{hits.length}{nbHits!==undefined?` of ${nbHits.toLocaleString()}`:''} results</span><button onClick={()=>{navigate(agentSearchURL(constraints));context.onClose();}}>View all</button></div><div className="agent-results-cards">{hits.map(hit=><ProductCard key={hit.objectID} item={hit}/>)}</div></section>;
}
