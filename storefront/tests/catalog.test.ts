import { describe,it,expect } from 'vitest';
import {normalizeProduct,facetsByCategory} from '../src/catalog';
describe('catalogue adapter',()=>{
 it('uses exact identity, available sizes and preserves weight bands',()=>{
 const p=normalizeProduct({objectID:'MFP256C',Catalog_ProductNumber:'MFP256',Catalog_SKUNumbers:['MFP256C-6','MFP256C-7'],Inventory_AvailableSkuSizes:['7'],Inventory_AvailableSkuSizeNames:['Size 7'],Catalog_GemstoneInformationPrimary:[{GemstoneCTW:'1-2 ctw'}]});
 expect(p.id).toBe('MFP256C');expect(p.familyId).toBe('MFP256');expect(p.sizes).toEqual([{value:'7',label:'Size 7'}]);expect(p.attributes).toContainEqual({label:'Primary gemstone carat range',value:'1-2 ctw'});
 });
 it('does not invent missing facts or accept invalid identities',()=>{const p=normalizeProduct({objectID:'x'});expect(p.price).toBeNull();expect(p.referencePrice).toBeNull();expect(p.sizes).toEqual([]);expect(p.inStock).toBeNull();expect(()=>normalizeProduct({Catalog_ProductNumber:'family'})).toThrow();});
 it('preserves plating qualifications and excludes unsafe image URLs',()=>{const p=normalizeProduct({objectID:'x',Catalog_TitleDescription:'14K gold over silver',Media_Images:['javascript:alert(1)','https://images.jtv.com/a.jpg']});expect(p.title).toContain('over silver');expect(p.images).toEqual(['https://images.jtv.com/a.jpg']);});
 it('does not pair mismatched size arrays positionally',()=>{expect(normalizeProduct({objectID:'x',Inventory_AvailableSkuSizes:['7','8'],Inventory_AvailableSkuSizeNames:['Size 8','Size 7']}).sizes).toEqual([{value:'7',label:'Size 7'},{value:'8',label:'Size 8'}]);});
 it('has all seventeen ring facet groups',()=>expect(facetsByCategory.rings).toHaveLength(17));
});

import fixtures from '../src/catalog/fixtures.json';
it('parses captured records and preserves MFP256C diamond equivalent weight wording',()=>{
 const products=fixtures.records.map(normalizeProduct);const ring=products.find(p=>p.id==='MFP256C')!;
 expect(ring.familyId).toBe('MFP256');expect(ring.title).toContain('DEW');expect(ring.description).toContain('Actual moissanite weight is 1.50ctw.');
});
it('preserves length units from available SKU labels',()=>{expect(normalizeProduct({objectID:'necklace',Inventory_AvailableSkuSizes:['18'],Inventory_AvailableSkuSizeNames:['18 Inch']}).sizes).toEqual([{value:'18',label:'18 Inch'}]);});
