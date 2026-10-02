import {useState,useEffect} from 'react';
import {useRefinementList,useRange,useSearchBox,useSortBy,usePagination,useInstantSearch,CurrentRefinements,ClearRefinements} from 'react-instantsearch';
import {allFacetAttributes,sortOptions,type FacetDefinition} from './catalog';
const LIMIT=100;
function VirtualFacet({attribute}:{attribute:string}){useRefinementList({attribute,limit:LIMIT});return null;}
/** Keep widget ownership mounted even when a product page replaces the listing. */
export function PersistentSearchState(){useSearchBox({});useSortBy({items:sortOptions});usePagination({});useRange({attribute:'Pricing_ActivePrice'});return <>{allFacetAttributes.map(attribute=><VirtualFacet key={attribute} attribute={attribute}/>)}</>;}
export function Facet({definition}:{definition:FacetDefinition}){
 const {items,refine}=useRefinementList({attribute:definition.attribute,limit:LIMIT,sortBy:['name:asc']});const [term,setTerm]=useState('');const {setIndexUiState}=useInstantSearch();
 const toggle=(value:string)=>{if(definition.kind==='price')setIndexUiState(s=>({...s,range:{},page:1}));refine(value);};
 return <details className="facet"><summary>{definition.label}</summary>
 {definition.kind==='price'&&<PriceRange/>}
 {items.length>8&&<input aria-label={`Find ${definition.label}`} placeholder={`Find ${definition.label.toLowerCase()}`} value={term} onChange={e=>setTerm(e.target.value)}/>}
 <div className={definition.kind==='size'?'size-facets':'facet-values'}>{items.filter(i=>i.label.toLowerCase().includes(term.toLowerCase())).map(item=><label key={item.value}><input type="checkbox" checked={item.isRefined} onChange={()=>toggle(item.value)}/><span>{item.label}</span><small>{item.count.toLocaleString()}</small></label>)}</div>
 {!items.length&&<p className="muted">No values in these results.</p>}{items.length>=LIMIT&&<small>Showing the first {LIMIT} values.</small>}
 </details>;
}
function PriceRange(){
 const {start}=useRange({attribute:'Pricing_ActivePrice'});const [min,setMin]=useState('');const [max,setMax]=useState('');
 useEffect(()=>{setMin(Number.isFinite(start[0])?String(start[0]):'');setMax(Number.isFinite(start[1])?String(start[1]):'');},[start[0],start[1]]);const [error,setError]=useState('');const {setIndexUiState}=useInstantSearch();
 return <form className="price-range" onSubmit={e=>{e.preventDefault();if((min!==''&&Number(min)<0)||(max!==''&&Number(max)<0)||(min&&max&&Number(min)>Number(max))){setError('Enter a valid price range.');return;}setError('');setIndexUiState(s=>({...s,page:1,refinementList:{...s.refinementList,Pricing_PriceRange:[]},range:{Pricing_ActivePrice:`${min}:${max}`}}));}}>
 <input aria-label="Minimum price" type="number" min="0" step="0.01" placeholder="$ Min" value={min} onChange={e=>setMin(e.target.value)}/><span>to</span><input aria-label="Maximum price" type="number" min="0" step="0.01" placeholder="$ Max" value={max} onChange={e=>setMax(e.target.value)}/><button>Go</button>{error&&<span role="alert">{error}</span>}</form>;
}
export function ActiveFilters(){return <div className="active-filters"><CurrentRefinements/><ClearRefinements translations={{resetButtonText:'Clear filters'}}/></div>;}
