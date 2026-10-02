import {describe,it,expect} from 'vitest';
import {buildContext} from '../src/context';
describe('per-turn context',()=>{
 it('omits empty fields and produces only strings',()=>{expect(buildContext({})).toEqual({});const c=buildContext({route:'/search',revision:2,refinements:{size:['7']}});expect(c.revision).toBe('2');expect(JSON.parse(c.refinements)).toEqual({size:['7']});});
 it('chunks ordered IDs without losing or reordering them',()=>{const ids=Array.from({length:120},(_,i)=>`record-${i}-${'x'.repeat(18)}`);const c=buildContext({visibleProductIds:ids});expect(Object.values(c).flatMap(v=>JSON.parse(v))).toEqual(ids);for(const v of Object.values(c))expect(new TextEncoder().encode(v).length).toBeLessThanOrEqual(1024);});
 it('rejects excessive constraints instead of truncating them',()=>expect(()=>buildContext({refinements:{metal:['💍'.repeat(300)]}})).toThrow(/1024/));
 it('rejects excessive combined context',()=>expect(()=>buildContext({route:'a'.repeat(1000),category:'a'.repeat(1000),query:'a'.repeat(1000),sort:'a'.repeat(1000),selectedProductId:'a'.repeat(100)})).toThrow(/4096/));
 it('snapshots values independently of subsequent state mutation',()=>{const refinements={size:['7']};const c=buildContext({refinements});refinements.size.push('8');expect(JSON.parse(c.refinements)).toEqual({size:['7']});});
});
