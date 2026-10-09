import {expect,it} from 'vitest';
import {checkBriefConflicts as checkBriefConflictsBase} from '../shared/briefConstraints';
import {createBriefState,applyBriefOperations} from '../shared/briefState';
const attribute='Catalog_GemstoneInformation.GemstoneName';
function brief(operator:'any'|'none'='none'){
 const initial=createBriefState('partial-exclusion');
 return applyBriefOperations(initial,{missionId:initial.missionId,expectedRevision:0,turnId:'requirement',operations:[{type:'add',fact:{id:'diamond',field:'exclusion',value:{kind:'facet',attribute,values:['Diamond'],operator},scope:{kind:'mission'},strength:'requirement',status:'active',origin:'ui',evidence:{messageId:'requirement',quote:operator==='none'?'No Diamond':'Diamond required',explicit:true,verified:true}}}]});
}
// These fail if missing branches are discarded before proving an exclusion.
const incompleteComponents=[
 {name:'missing leaf',branch:{}},
 {name:'undefined leaf',branch:{GemstoneName:undefined}},
 {name:'null leaf',branch:{GemstoneName:null}},
 {name:'empty leaf',branch:{GemstoneName:''}},
 {name:'empty leaf array',branch:{GemstoneName:[]}},
 {name:'nonstring leaf',branch:{GemstoneName:7}},
 {name:'null component',branch:null},
 {name:'undefined component',branch:undefined},
 {name:'nonobject component',branch:7},
 {name:'empty component array',branch:[]},
];
it.each(incompleteComponents)('keeps a negative requirement unresolved with known other value and $name',({branch})=>{
 const assessment=checkBriefConflicts(brief(),{Catalog_GemstoneInformation:[{GemstoneName:'Pearl'},branch]});
 expect(assessment.status).toBe('unknown');expect(assessment.reasons.join(' ')).toContain('catalogue evidence');
});
it.each(incompleteComponents)('keeps known excluded-value conflict priority with $name',({branch})=>{
 const assessment=checkBriefConflicts(brief(),{Catalog_GemstoneInformation:[{GemstoneName:'Diamond'},branch]});
 expect(assessment.status).toBe('conflict');expect(assessment.reasons.join(' ')).toContain('No Diamond');
});
it.each([{name:'null',missing:null},{name:'undefined',missing:undefined},{name:'empty string',missing:''},{name:'empty array',missing:[]},{name:'number',missing:7}])('does not prove a flat exclusion from partial array containing $name',({missing})=>{
 expect(checkBriefConflicts(brief(),{[attribute]:['Pearl',missing]}).status).toBe('unknown');
 expect(checkBriefConflicts(brief(),{[attribute]:['Diamond',missing]}).status).toBe('conflict');
});
it('keeps complete allowed nested and flat values compliant',()=>{
 expect(checkBriefConflicts(brief(),{Catalog_GemstoneInformation:[{GemstoneName:'Pearl'},{GemstoneName:['Ruby','Sapphire']}]}).status).toBe('compliant');
 expect(checkBriefConflicts(brief(),{[attribute]:['Pearl','Ruby']}).status).toBe('compliant');
});
it('keeps a totally missing or empty evidence list unknown',()=>{
 for(const record of [{},{Catalog_GemstoneInformation:[]},{Catalog_GemstoneInformation:[{}]},{[attribute]:[]}])expect(checkBriefConflicts(brief(),record).status).toBe('unknown');
});
it.each(incompleteComponents)('preserves positive any semantics with $name',({branch})=>{
 expect(checkBriefConflicts(brief('any'),{Catalog_GemstoneInformation:[{GemstoneName:'Diamond'},branch]}).status).toBe('compliant');
 expect(checkBriefConflicts(brief('any'),{Catalog_GemstoneInformation:[{GemstoneName:'Pearl'},branch]}).status).toBe('conflict');
});
it('does not change positive any behavior for partially known flat arrays',()=>{
 expect(checkBriefConflicts(brief('any'),{[attribute]:['Diamond',null]}).status).toBe('compliant');
 expect(checkBriefConflicts(brief('any'),{[attribute]:['Pearl',null]}).status).toBe('conflict');
});

// Fixture live vocabulary (values observed by read-only index interrogation;
// the runtime receives them from /api/catalog-vocabulary). The frozen JSON
// fallback these tests previously relied on is retired.
const testVocabValues:Readonly<Record<string,readonly string[]>>={
 'Catalog_ProductType':['Ring','Earrings','Necklace','Bracelet','Pendant','Wrist Watch'],
 'Catalog_GemstoneInformation.GemstoneName':['Diamond','Pearl'],
};
const checkBriefConflicts=(...args:Parameters<typeof checkBriefConflictsBase>)=>checkBriefConflictsBase(args[0],args[1],testVocabValues);
