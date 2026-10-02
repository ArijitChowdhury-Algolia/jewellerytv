// Cases: actual record hydration; invented IDs; duplicate IDs; incomplete/blocked responses.
import {it,expect} from 'vitest';
import {workspaceGroups,mayCommitResults} from '../src/workspaceResults';
it('hydrates curated IDs and rejects unobserved or duplicate IDs',()=>{
 const x=workspaceGroups({intro:'Choices',groups:[{title:'Blue',results:[{objectID:'one',why:'Blue stone'},{objectID:'invented'},{objectID:'one'}]}]},id=>id==='one'?{objectID:id,Catalog_TitleDescription:'Actual piece'}:undefined);
 expect(x.groups[0].items.map(i=>i.product.id)).toEqual(['one']);expect(x.groups[0].items[0].why).toBe('Blue stone');
});
it('does not commit partial, old or error-turn results',()=>{
 expect(mayCommitResults('streaming',true,'output-available')).toBe(false);expect(mayCommitResults('error',true,'output-available')).toBe(false);expect(mayCommitResults('ready',false,'output-available')).toBe(false);expect(mayCommitResults('ready',true,'output-available')).toBe(true);
});
