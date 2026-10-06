import {expect,it} from 'vitest';
import {newShoppingState,pinRecord,commitDiscoveries,STALE_DISCOVERY_NOTICE} from '../src/ShoppingProvider';
import {normalizeProduct} from '../src/catalog';
const record={objectID:'saved',Catalog_TitleDescription:'Saved ring',Pricing_ActivePrice:50,Inventory_InStock:true};
const group=[{title:'Current results',items:[{product:normalizeProduct({...record,Pricing_ActivePrice:45})}]}];
it('clears an old stale warning only when matching current results successfully commit',()=>{
 const initial=pinRecord(newShoppingState(),record);const current={...initial,brief:{...initial.brief,revision:2},compareIds:['saved']};
 const rejected=commitDiscoveries(current,group,'Old reply',{missionId:current.missionId,revision:1});
 expect(rejected.notice).toBe(STALE_DISCOVERY_NOTICE);expect(rejected.discoveries).toEqual([]);expect(rejected.products[0].product.price).toBe(50);
 const fresh=commitDiscoveries(rejected,group,'Current reply',{missionId:current.missionId,revision:2});
 expect(fresh.notice).toBe('');expect(fresh.displayIntro).toBe('Current reply');expect(fresh.products[0].product.id).toBe('saved');expect(fresh.products[0].product.price).toBe(45);expect(fresh.compareIds).toEqual(['saved']);
});
it('keeps another error notice on a successful result commit',()=>{
 const state={...newShoppingState(),notice:'Your shortlist holds 12 pieces.'};
 expect(commitDiscoveries(state,group,'Current',{missionId:state.missionId,revision:0}).notice).toBe(state.notice);
});
it('does not clear stale notice for unbound results or mismatched mission',()=>{
 const state={...newShoppingState(),notice:STALE_DISCOVERY_NOTICE};
 expect(commitDiscoveries(state,group,'Unbound').notice).toBe(STALE_DISCOVERY_NOTICE);
 const rejected=commitDiscoveries(state,group,'Wrong mission',{missionId:'different',revision:0});
 expect(rejected.notice).toBe(STALE_DISCOVERY_NOTICE);expect(rejected.discoveries).toEqual([]);
});
