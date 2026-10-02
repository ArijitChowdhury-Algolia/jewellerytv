import {describe,it,expect} from 'vitest';
import {readSearchState, searchURL} from '../src/routing';
describe('search route contract',()=>{
 it('round trips filters price page and sort',()=>{const state={query:'opal',refinementList:{Catalog_BrandNavigationName:['Bella Luce'],Inventory_AvailableSkuSizes:['7']},range:{Pricing_ActivePrice:'50:100'},page:2,sortBy:'prod_catalog_price_asc'};expect(readSearchState(searchURL('/category/rings',state))).toEqual(state);});
 it('turns header brand and stone presets into refinements',()=>{expect(readSearchState('/search?brand=Bella%20Luce&stone=Opal').refinementList).toEqual({Catalog_BrandNavigationName:['Bella Luce'],'Catalog_GemstoneInformationPrimary.GemstoneName':['Opal']});});
 it('rejects corrupt facet state safely',()=>{expect(readSearchState('/search?f=notjson').refinementList).toEqual({});});
 it('does not lose exact object id in product route',()=>{expect(searchURL('/product/MFP256C',{query:'ring'})).toContain('/product/MFP256C');});
});
