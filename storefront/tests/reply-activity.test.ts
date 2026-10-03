import {it,expect} from 'vitest';
import {replyActivity} from '../src/ReplyActivity';
import {beginTrace,observeTrace} from '../src/telemetry';
it('does not invent searches or intermediate verification stages for conversation-only turns',()=>{
 const trace=beginTrace('no-search','mission');observeTrace(trace,{type:'data-shopping-brief'},10);
 expect(replyActivity(trace)).toEqual({label:'Working on your request',history:['Request started','Shopping brief received']});
 observeTrace(trace,{type:'text-delta',delta:'private answer'},20);
 expect(replyActivity(trace).label).toBe('Preparing your reply');
 expect(replyActivity(trace).history.join(' ')).not.toContain('Catalogue');
});
it('tracks repeated searches by actual tool identity without exposing payloads',()=>{
 const t=beginTrace('search','mission');
 observeTrace(t,{type:'tool-input-start',toolName:'algolia_search_index_prod_catalog',toolCallId:'one',input:{query:'PRIVATE'}},10);
 observeTrace(t,{type:'tool-input-available',toolName:'algolia_search_index_prod_catalog',toolCallId:'one'},15);
 expect(replyActivity(t).label).toBe('Searching the catalogue');
 observeTrace(t,{type:'tool-output-available',toolCallId:'one'},20);
 expect(replyActivity(t).label).toBe('Putting your reply together');
 observeTrace(t,{type:'tool-input-start',toolName:'algolia_search_index_prod_catalog',toolCallId:'two'},30);
 expect(replyActivity(t).label).toBe('Searching the catalogue');
 expect(replyActivity(t).history).toContain('2 catalogue searches started');
 expect(JSON.stringify(t)).not.toContain('PRIVATE');
});
it('never treats errors or cancelled work as successful completion',()=>{
 const t=beginTrace('fail','mission');observeTrace(t,{type:'error'},5);observeTrace(t,{type:'finish'},6);
 expect(replyActivity(t).label).toBe('Reply interrupted');
 t.termination='cancelled';expect(replyActivity(t).label).toBe('Reply stopped');
});
