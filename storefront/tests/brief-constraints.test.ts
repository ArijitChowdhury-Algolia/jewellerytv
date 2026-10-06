import {it,expect} from 'vitest';
import {compileBriefConstraints,checkBriefConflicts,checkCombinationBudget} from '../shared/briefConstraints';
import {createBriefState,applyBriefOperations} from '../shared/briefState';
import type {BriefFactInput} from '../shared/briefSchema';
const base:BriefFactInput={id:'budget',field:'budget',value:{kind:'money',cents:20000,currency:'USD',operator:'lt',basis:'total'},scope:{kind:'mission'},strength:'requirement',status:'active',origin:'ui',evidence:{messageId:'ui',quote:'under 200',explicit:true,verified:true}};
const state=(facts:BriefFactInput[])=>applyBriefOperations(createBriefState('m'),{missionId:'m',expectedRevision:0,turnId:'1',operations:facts.map(fact=>({type:'add',fact}))});
it('preserves strict cents and unknown prices',()=>{const s=state([base]);expect(compileBriefConstraints(s).filters).toBe('Pricing_ActivePrice < 200.00');expect(checkBriefConflicts(s,{Pricing_ActivePrice:200}).status).toBe('conflict');expect(checkBriefConflicts(s,{}).status).toBe('unknown');expect(checkCombinationBudget(s,[{price:99.99},{price:100.01}]).status).toBe('conflict');});
it('allows only verified canonical facet vocabulary and OR values',()=>{const f={...base,id:'material',field:'material' as const,value:{kind:'facet' as const,attribute:'Catalog_JewelryMaterialNavigationName',values:['Silver','Gold'],operator:'any' as const}};expect(compileBriefConstraints(state([f])).filters).toBe('(Catalog_JewelryMaterialNavigationName:"Silver" OR Catalog_JewelryMaterialNavigationName:"Gold")');expect(compileBriefConstraints(state([{...f,value:{...f.value,values:['Silver" OR 1=1']}}])).filters).toBeUndefined();});
it('never globalizes piece scope or treats missing exclusion evidence as proof',()=>{const f={...base,id:'silver',field:'material' as const,scope:{kind:'item' as const,key:'Necklace'},value:{kind:'facet' as const,attribute:'Catalog_JewelryMaterialNavigationName',values:['Silver'],operator:'none' as const}};expect(compileBriefConstraints(state([f])).appliedFactIds).toEqual([]);expect(checkBriefConflicts(state([f]),{}).status).toBe('unknown');});
it('does not turn no plating or vague style into filter or evidence',()=>{const s=state([{...base,value:{kind:'text',text:'No plating'},field:'exclusion'}]);expect(compileBriefConstraints(s).filters).toBeUndefined();expect(checkBriefConflicts(s,{Catalog_JewelryMaterialNavigationName:'Silver'}).status).toBe('unknown');});
it('conjoins exclusions while preserving OR inclusions',()=>{
 const gem={...base,id:'shape',field:'exclusion' as const,value:{kind:'facet' as const,attribute:'Catalog_GemstoneInformation.GemstoneShape',values:['Heart','Flower'],operator:'none' as const}};
 const color={...base,id:'yellow',field:'exclusion' as const,value:{kind:'facet' as const,attribute:'Catalog_JewelryMaterialNavigationColor',values:['Yellow'],operator:'none' as const}};
 expect(compileBriefConstraints(state([gem,color])).filters).toBe('(NOT Catalog_GemstoneInformation.GemstoneShape:"Heart" AND NOT Catalog_GemstoneInformation.GemstoneShape:"Flower") AND NOT Catalog_JewelryMaterialNavigationColor:"Yellow"');
 expect(checkBriefConflicts(state([gem]),{'Catalog_GemstoneInformation':[{GemstoneShape:'Heart'}]}).status).toBe('conflict');
 expect(checkBriefConflicts(state([gem]),{}).status).toBe('unknown');
});
it('preserves inclusive bounds and checks exact quantities for combinations',()=>{
 const s=state([{...base,value:{...base.value as Extract<BriefFactInput['value'],{kind:'money'}>,operator:'lte'}}]);
 expect(compileBriefConstraints(s).filters).toBe('Pricing_ActivePrice <= 200.00');
 expect(checkCombinationBudget(s,[{price:100,quantity:2}]).status).toBe('compliant');
 expect(checkCombinationBudget(s,[{price:100,quantity:3}]).status).toBe('conflict');
 expect(checkCombinationBudget(s,[{price:null}]).status).toBe('unknown');
});
it('leaves unverified unresolved and recipient-scoped budgets unapplied',()=>{
 expect(compileBriefConstraints(state([{...base,evidence:{...base.evidence,verified:false},value:{...base.value as Extract<BriefFactInput['value'],{kind:'money'}>,basis:'unresolved'}}])).filters).toBeUndefined();
 expect(compileBriefConstraints(state([{...base,scope:{kind:'recipient',key:'mother'}}])).filters).toBeUndefined();
});
it('compiles read-only verified Ring, Round, Blue and Stud canonical constraints',()=>{
 const inputs=[['ring','other','Catalog_ProductType','Ring'],['round','style','Catalog_GemstoneInformation.GemstoneShape','Round'],['blue','material','Catalog_GemstoneInformation.GemstoneColorGroup','Blue'],['stud','style','Catalog_EarringType','Stud']] as const;
 const s=state(inputs.map(([id,field,attribute,value])=>({...base,id,field,value:{kind:'facet',attribute,values:[value],operator:'any'}})));
 expect(compileBriefConstraints(s).filters).toBe('Catalog_ProductType:"Ring" AND Catalog_GemstoneInformation.GemstoneShape:"Round" AND Catalog_GemstoneInformation.GemstoneColorGroup:"Blue" AND Catalog_EarringType:"Stud"');
 expect(compileBriefConstraints(s).appliedFactIds).toEqual(['ring','round','blue','stud']);
});
it('keeps canonical per-piece shape and earring type out of global filters',()=>{
 const s=state([{...base,id:'round',field:'style',scope:{kind:'item',key:'Ring'},value:{kind:'facet',attribute:'Catalog_GemstoneInformation.GemstoneShape',values:['Round'],operator:'any'}},{...base,id:'stud',field:'style',scope:{kind:'item',key:'Earrings'},value:{kind:'facet',attribute:'Catalog_EarringType',values:['Stud'],operator:'any'}}]);
 const compiled=compileBriefConstraints(s);expect(compiled.filters).toBeUndefined();expect(compiled.appliedFactIds).toEqual([]);expect(compiled.context.every(c=>c.reason.includes('Scoped'))).toBe(true);
});
it('keeps unobserved values and text aesthetics as context after vocabulary expansion',()=>{
 const s=state([{...base,id:'unknown',field:'other',value:{kind:'facet',attribute:'Catalog_ProductType',values:['Imaginary magical ring'],operator:'any'}},{...base,id:'vague',field:'style',value:{kind:'text',text:'understated and elegant'}}]);
 expect(compileBriefConstraints(s).filters).toBeUndefined();expect(compileBriefConstraints(s).context).toHaveLength(2);
});
it('checks necklace and earring scopes independently against exact catalogue product types',()=>{
 const necklace={...base,id:'necklace-silver',field:'material' as const,scope:{kind:'item' as const,key:'necklace'},value:{kind:'facet' as const,attribute:'Catalog_JewelryMaterialNavigationName',values:['Silver'],operator:'any' as const}};
 const earrings={...base,id:'earring-gold',field:'material' as const,scope:{kind:'item' as const,key:'Earrings'},value:{kind:'facet' as const,attribute:'Catalog_JewelryMaterialNavigationName',values:['Gold'],operator:'any' as const}};
 const s=state([necklace,earrings]);expect(compileBriefConstraints(s).filters).toBeUndefined();
 expect(checkBriefConflicts(s,{Catalog_ProductType:'Necklace',Catalog_JewelryMaterialNavigationName:'Gold'}).status).toBe('conflict');
 expect(checkBriefConflicts(s,{Catalog_ProductType:'NECKLACE',Catalog_JewelryMaterialNavigationName:'Silver'}).status).toBe('compliant');
 expect(checkBriefConflicts(s,{Catalog_ProductType:'Earrings',Catalog_JewelryMaterialNavigationName:'Gold'}).status).toBe('compliant');
 expect(checkBriefConflicts(s,{Catalog_ProductType:'Ring'}).status).toBe('compliant');
 expect(checkBriefConflicts(s,{Catalog_JewelryMaterialNavigationName:'Silver'}).status).toBe('unknown');
});
it('resolves objectID item scopes but does not guess aliases or missing item identity',()=>{
 const scoped={...base,id:'specific',scope:{kind:'item' as const,key:'ABC123'},value:{kind:'money' as const,cents:10000,currency:'USD' as const,operator:'lt' as const,basis:'per-item' as const}};
 expect(checkBriefConflicts(state([scoped]),{objectID:'ABC123',Pricing_ActivePrice:100}).status).toBe('conflict');
 expect(checkBriefConflicts(state([scoped]),{objectID:'ABC123',Pricing_ActivePrice:99.99}).status).toBe('compliant');
 expect(checkBriefConflicts(state([scoped]),{objectID:'OTHER',Pricing_ActivePrice:200}).status).toBe('unknown');
 expect(checkBriefConflicts(state([{...scoped,scope:{kind:'item',key:'earring'}}]),{Catalog_ProductType:'Earrings',Pricing_ActivePrice:200}).status).toBe('unknown');
});
it('does not turn scoped no-plating text into evidence or individual total bounds into combination compliance',()=>{
 const scope={kind:'item' as const,key:'Necklace'};
 expect(checkBriefConflicts(state([{...base,scope,value:{kind:'text',text:'No plating'},field:'exclusion'}]),{Catalog_ProductType:'Necklace',Catalog_JewelryMaterialNavigationName:'Silver'}).status).toBe('unknown');
 expect(checkBriefConflicts(state([{...base,scope}]),{Catalog_ProductType:'Necklace',Pricing_ActivePrice:99}).status).toBe('unknown');
 expect(checkBriefConflicts(state([{...base,scope}]),{Catalog_ProductType:'Necklace',Pricing_ActivePrice:200}).status).toBe('conflict');
});
it('does not warn about recipient or occasion context while preserving unknown product requirements',()=>{
 const context=[{...base,id:'recipient',field:'recipient' as const,value:{kind:'text' as const,text:'my wife'}},{...base,id:'occasion',field:'occasion' as const,value:{kind:'text' as const,text:'anniversary'}}];
 expect(checkBriefConflicts(state(context),{})).toEqual({status:'compliant',reasons:[]});
 const plating=checkBriefConflicts(state([...context,{...base,id:'unplated',field:'exclusion',value:{kind:'text',text:'No plating'}}]),{Catalog_JewelryMaterialNavigationName:'Silver'});
 expect(plating.status).toBe('unknown');expect(plating.reasons).toHaveLength(1);expect(plating.reasons[0]).toContain('No plating');
 const price=checkBriefConflicts(state([...context,base]),{});expect(price.status).toBe('unknown');expect(price.reasons).toEqual(['Price is unknown']);
});
it('unions separately requested mission product types while preserving exclusions and price constraints',()=>{
 const type=(id:string,value:string,operator:'any'|'none'='any'):BriefFactInput=>({...base,id,field:'other',value:{kind:'facet',attribute:'Catalog_ProductType',values:[value],operator}});
 const s=state([type('necklace','Necklace'),type('earrings','Earrings'),type('no-ring','Ring','none'),{...base,value:{kind:'money',cents:18000,currency:'USD',operator:'lt',basis:'total'}}]);
 const compiled=compileBriefConstraints(s);expect(compiled.filters).toBe('(Catalog_ProductType:"Necklace" OR Catalog_ProductType:"Earrings") AND NOT Catalog_ProductType:"Ring" AND Pricing_ActivePrice < 180.00');expect(compiled.appliedFactIds).toEqual(['necklace','earrings','no-ring','budget']);
});
it('does not broaden unrelated material requirements into OR across facts',()=>{
 const material=(id:string,value:string):BriefFactInput=>({...base,id,field:'material',value:{kind:'facet',attribute:'Catalog_JewelryMaterialNavigationName',values:[value],operator:'any'}});
 expect(compileBriefConstraints(state([material('silver','Silver'),material('gold','Gold')])).filters).toBe('Catalog_JewelryMaterialNavigationName:"Silver" AND Catalog_JewelryMaterialNavigationName:"Gold"');
});
it('assesses a product against the requested type union rather than every alternative type',()=>{
 const facts=['Necklace','Earrings'].map(value=>({...base,id:value,field:'other' as const,value:{kind:'facet' as const,attribute:'Catalog_ProductType',values:[value],operator:'any' as const}}));
 expect(checkBriefConflicts(state(facts),{Catalog_ProductType:'Necklace'}).status).toBe('compliant');
 expect(checkBriefConflicts(state(facts),{Catalog_ProductType:'Ring'}).status).toBe('conflict');
 expect(checkBriefConflicts(state(facts),{}).status).toBe('unknown');
});
