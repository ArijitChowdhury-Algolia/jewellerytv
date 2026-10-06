import {createPortal} from 'react-dom';
import {SlidersHorizontal,RotateCcw,ChevronDown,X} from 'lucide-react';
import {useRef,useState,useId,type FormEvent} from 'react';
import {useShopping,uiFact} from './ShoppingProvider';
import type {BriefFactV2,BriefFactInput,BriefOperation} from '../shared/briefSchema';
import {compileBriefConstraints,CATALOGUE_FACET_VALUES} from '../shared/briefConstraints';
import {moneyOperatorLabel,isUpperMoneyBound,type MoneyOperator} from '../shared/moneyBounds';
import './shopping-brief.css';
const fields=['budget','material','style','recipient','occasion','exclusion'] as const;
const labels={budget:'Budget',material:'Material',style:'Style',recipient:'Recipient',occasion:'Occasion',exclusion:'Avoid',other:'Preference',unknown:'To clarify'};
export function briefFactFieldLabel(f:BriefFactV2){const facetLabels:Record<string,string>={Catalog_JewelryMaterialNavigationName:'Material',Catalog_JewelryMaterialNavigationPurity:'Purity',Catalog_JewelryMaterialNavigationColor:'Colour',Catalog_ProductType:'Jewellery type','Catalog_GemstoneInformation.GemstoneShape':'Gemstone shape'};return (f.value.kind==='facet'?facetLabels[f.value.attribute]:undefined)??labels[f.field]}
export function briefFactLabel(f:BriefFactV2){const v=f.value;return v.kind==='text'?v.text:v.kind==='facet'?`${v.operator==='none'?'No ':''}${v.values.join(', ')}`:`${moneyOperatorLabel(v.operator)} ${new Intl.NumberFormat('en-US',{style:'currency',currency:v.currency,maximumFractionDigits:2}).format(v.cents/100)} ${v.basis==='total'?'together':v.basis==='per-item'?'per item':'(scope to clarify)'}`}
const MATERIAL_ATTRIBUTE='Catalog_JewelryMaterialNavigationName';
/** Exact catalogue choices stay typed; editing one fact never changes sibling constraints. */
export function editorFact(field:BriefFactInput['field'],text:string,selected:BriefFactV2|undefined,attribute:string,values:string[]):BriefFactInput{
 const fact=uiFact(field,attribute?values.join(', '):text);if(selected){fact.scope=selected.scope;fact.strength=selected.strength;}
 if(selected?.value.kind==='facet'&&attribute!==selected.value.attribute)throw new Error('Keep the same catalogue attribute when editing this filter.');
 if(attribute){if(!values.length||values.some(value=>!CATALOGUE_FACET_VALUES[attribute]?.includes(value)))throw new Error('Choose an exact catalogue value.');fact.value={kind:'facet',attribute,values,operator:selected?.value.kind==='facet'?selected.value.operator:'any'};}
 else if(selected?.value.kind==='facet')throw new Error('Keep a catalogue choice when editing this filter.');
 return fact;
}
/** A resolved bound replaces only the same direction, currency and basis in the same scope; an explicitly edited fact is also replaced. */
export function editorOperations(facts:readonly BriefFactV2[],fact:BriefFactInput,selected?:BriefFactV2):BriefOperation[]{
 const targets=new Set(selected?[selected.id]:[]);const value=fact.value;
 if(fact.field==='budget'&&value.kind==='money'&&value.basis!=='unresolved')for(const previous of facts){
  if((previous.status==='active'||previous.status==='tentative')&&previous.field==='budget'&&previous.strength===fact.strength&&previous.value.kind==='money'&&previous.value.basis===value.basis&&previous.value.currency===value.currency&&isUpperMoneyBound(previous.value.operator)===isUpperMoneyBound(value.operator)&&previous.scope.kind===fact.scope.kind&&previous.scope.key===fact.scope.key)targets.add(previous.id);
 }
 return [targets.size?{type:'replace',factIds:[...targets],fact}:{type:'add',fact}];
}
export function initialBriefEditor(f?:BriefFactV2){return {field:f?.field??'budget' as const,draft:f?f.value.kind==='money'?(f.value.currency==='USD'?String(f.value.cents/100):''):briefFactLabel(f):''}}
export function briefAnnouncement(revision:number,facts:BriefFactV2[],manual:{text:string;revision:number}){if(manual.revision===revision&&manual.text)return manual.text;return facts.length?`Your brief was updated: ${facts.slice(-6).map(briefFactLabel).join('; ')}.`:revision>0?'Your brief is now clear.':''}
/** Range creation stays opt-in until the deployed interpreter supports four operators.
 * Keep a selected persisted floor editable without converting or deleting its data. */
export function PriceLimitOptions({selectedOperator}:{selectedOperator?:MoneyOperator}={}){
 const rangesEnabled=import.meta.env.VITE_BRIEF_PRICE_RANGES_ENABLED==='true';
 return <><option value="lte">Up to and including</option><option value="lt">Strictly under</option>{(rangesEnabled||selectedOperator==='gte')&&<option value="gte">At least</option>}{(rangesEnabled||selectedOperator==='gt')&&<option value="gt">Strictly over</option>}</>;
}
export function ShoppingBrief({busy=false,error:externalError,controlsTarget}:{busy?:boolean;error?:string;controlsTarget?:HTMLElement|null}={}){
 const panelId=useId();const [expanded,setExpanded]=useState(false);
 const s=useShopping();const [materialMode,setMaterialMode]=useState('catalogue');const [facetValues,setFacetValues]=useState<string[]>([]);const [editing,setEditing]=useState<string|null>(null);const [field,setField]=useState<BriefFactInput['field']>('budget');const [draft,setDraft]=useState('');const [basis,setBasis]=useState<'total'|'per-item'|'unresolved'>('total');const [operator,setOperator]=useState<MoneyOperator>('lte');const [strength,setStrength]=useState<'requirement'|'preference'>('preference');const [scope,setScope]=useState('');const [revision,setRevision]=useState(0);const [error,setError]=useState('');const [announcement,setAnnouncement]=useState({text:'',revision:-1});const trigger=useRef<HTMLElement|null>(null);const addButton=useRef<HTMLButtonElement>(null);
 if(!s)return null;
 const visible=s.brief.facts.filter(f=>f.status==='active'||f.status==='tentative');const selected=visible.find(f=>f.id===editing);const compiled=compileBriefConstraints(s.brief);const facetAttribute=selected?.value.kind==='facet'?selected.value.attribute:field==='material'&&materialMode==='catalogue'?MATERIAL_ATTRIBUTE:'';const hasValue=facetAttribute?facetValues.length>0:!!draft.trim();
 function announce(text:string){setAnnouncement({text,revision:s!.getBrief().revision})}
 function close(){setEditing(null);setError('');requestAnimationFrame(()=>{const target=trigger.current;((target?.isConnected?target:addButton.current))?.focus()})}
 function open(f?:BriefFactV2){setExpanded(true);trigger.current=document.activeElement as HTMLElement;setRevision(s!.brief.revision);setMaterialMode(f?.value.kind==='text'?'context':'catalogue');setFacetValues(f?.value.kind==='facet'?[...f.value.values]:[]);setError('');setEditing(f?.id??'add');const initial=initialBriefEditor(f);setField(initial.field);setDraft(initial.draft);setBasis(f?.value.kind==='money'?f.value.basis:'total');setOperator(f?.value.kind==='money'?f.value.operator:'lte');setStrength(f?.strength??'preference');setScope(f?.scope.kind==='item'?f.scope.key??'':'')}
 function save(e:FormEvent){e.preventDefault();if(!hasValue)return;let fact:BriefFactInput;try{fact=editorFact(field,draft,selected,facetAttribute,facetValues)}catch(e){setError(e instanceof Error?e.message:'Choose a catalogue value.');return}fact.strength=strength;fact.scope=scope.trim()?{kind:'item',key:scope.trim()}:selected?.scope.kind==='recipient'?selected.scope:{kind:'mission'};
  if(field==='budget'){if(!/^\d+(\.\d{1,2})?$/.test(draft)||Number(draft)>1000000){setError('Enter an amount from $0 to $1,000,000, with at most two decimal places.');return}fact={...fact,strength:selected?.strength??'requirement',value:{kind:'money',cents:Math.round(Number(draft)*100),currency:'USD',operator,basis}}}
  if(s!.applyBriefOperations(editorOperations(s!.brief.facts,fact,selected),revision)){announce('Your brief has been updated.');close()}else setError('Your brief changed. Close this editor and try again.');
 }
 function collapse(){setExpanded(false);setEditing(null);setError('');requestAnimationFrame(()=>addButton.current?.focus())}
 const controls=<div className="cb-controls"><button ref={addButton} onClick={()=>{if(expanded)collapse();else if(!visible.length)open();else setExpanded(true)}} aria-label={`Preferences (${visible.length})`} title="Review and edit preferences" aria-expanded={expanded} aria-controls={panelId}><SlidersHorizontal size={18} aria-hidden="true"/><span>Preferences</span><b className="cb-count" aria-hidden="true">({visible.length})</b><ChevronDown className={expanded?'cb-chevron cb-chevron-open':'cb-chevron'} size={14} aria-hidden="true"/></button></div>;
 return <section className={`conversation-brief ${controlsTarget!==undefined&&!expanded&&!busy&&!externalError?'cb-empty':''}`} aria-label="Your brief" onKeyDown={e=>{if(e.key==='Escape'&&expanded){e.stopPropagation();if(editing)close();else collapse()}}}>
  {controlsTarget?createPortal(controls,controlsTarget):controlsTarget===undefined?controls:null}
  <div id={panelId} hidden={!expanded} className="cb-panel">
  {!editing&&<div className="cb-panel-actions"><button onClick={()=>open()}>Add preference</button>{s.brief.events.length>0&&<button onClick={()=>{if(s.undoBriefEdit())announce('Your last brief change was undone.')}}><RotateCcw size={16} aria-hidden="true"/>Undo</button>}<button className="cb-close" aria-label="Close preferences" onClick={collapse}>Close</button></div>}
  {!visible.length&&!editing&&<p className="cb-context">Preferences will appear here as we talk. You can also add one.</p>}
  {!!visible.length&&<div className="cb-chips">{visible.map(f=><div key={f.id} className={f.status==='tentative'?'cb-chip cb-tentative':'cb-chip'}><button className="cb-chip-edit" onClick={()=>open(f)} title="Edit preference" aria-label={`Edit ${briefFactFieldLabel(f)}: ${briefFactLabel(f)}`}><span>{f.status==='tentative'?'To clarify: ':''}{briefFactFieldLabel(f)}: {briefFactLabel(f)}</span>{f.scope.kind==='item'&&<small>{f.scope.key}</small>}</button><button className="cb-chip-remove" title="Remove preference" aria-label={`Remove ${briefFactFieldLabel(f)}: ${briefFactLabel(f)}`} onClick={()=>{if(s.applyBriefOperations([{type:'retract',factIds:[f.id]}],s.brief.revision)){announce('Preference removed. You can undo this change.');if(editing===f.id)setEditing(null);requestAnimationFrame(()=>addButton.current?.focus())}}}><X size={16} aria-hidden="true"/></button></div>)}</div>}
  {editing&&<form className="cb-editor" onSubmit={save} aria-label={selected?`Edit ${selected.field}`:'Add a preference'}>
   {!selected&&<div className="cb-field-choices" aria-label="Choose a preference">{fields.map(f=><button type="button" key={f} aria-pressed={field===f} onClick={()=>{setField(f);setDraft('');setFacetValues([]);setMaterialMode('catalogue')}}>{labels[f]}</button>)}</div>}
   {field==='material'&&selected?.value.kind!=='facet'&&<div className="cb-field-choices" aria-label="Material entry"><button type="button" aria-pressed={materialMode==='catalogue'} onClick={()=>setMaterialMode('catalogue')}>Catalogue material</button><button type="button" aria-pressed={materialMode==='context'} onClick={()=>setMaterialMode('context')}>Other preference</button></div>}
   {facetAttribute?<label>{facetAttribute.endsWith('Purity')?'Material purity':field==='material'?'Material':'Catalogue value'}<select autoFocus multiple={selected?.value.kind==='facet'&&selected.value.values.length>1} size={selected?.value.kind==='facet'&&selected.value.values.length>1?4:1} value={selected?.value.kind==='facet'&&selected.value.values.length>1?facetValues:facetValues[0]??''} onChange={e=>setFacetValues(Array.from(e.target.selectedOptions,option=>option.value).filter(Boolean))}><option value="" disabled>Choose a catalogue value</option>{(CATALOGUE_FACET_VALUES[facetAttribute]??facetValues).map(value=><option key={value} value={value}>{value}</option>)}</select>{selected?.value.kind==='facet'&&selected.value.operator==='none'&&<small>Exclude the selected value.</small>}</label>:<label>{field==='budget'?'Amount (USD)':labels[field]}<input autoFocus value={draft} inputMode={field==='budget'?'decimal':'text'} maxLength={300} onChange={e=>setDraft(e.target.value)} placeholder={field==='material'?'Describe what matters to you':field==='style'?'For example, delicate and simple':undefined}/></label>}
   {field==='material'&&!facetAttribute&&<p className="cb-context">Your concierge will use this as context. It does not apply a catalogue filter.</p>}

   {selected?.value.kind==='money'&&selected.value.currency!=='USD'&&<p className="cb-context">Your earlier budget is in {selected.value.currency}. Enter a USD amount to replace it. No currency conversion is applied.</p>}
   {field==='budget'?<div className="cb-row"><label>Limit<select value={operator} onChange={e=>setOperator(e.target.value as typeof operator)}><PriceLimitOptions selectedOperator={selected?.value.kind==='money'?selected.value.operator:undefined}/></select></label><label>For<select value={basis} onChange={e=>setBasis(e.target.value as typeof basis)}><option value="total">Whole combination</option><option value="per-item">Each item</option><option value="unresolved">Still deciding</option></select></label></div>:<><label>How important?<select value={strength} onChange={e=>setStrength(e.target.value as typeof strength)}><option value="preference">A preference</option><option value="requirement">A must-have</option></select></label>{!['recipient','occasion'].includes(field)&&<label>For a specific piece (optional)<input value={scope} onChange={e=>setScope(e.target.value)} maxLength={100} placeholder="For example, necklace"/></label>}</>}
   {selected&&<><p className="cb-context">{selected.status==='tentative'?'Needs clarification before it guides your search.':compiled.appliedFactIds.includes(selected.id)?'Applied search filter':'Preference or context for your concierge'}</p><details><summary>Where this came from</summary><p>{selected.origin==='ui'?'You added or edited this.':`You said: “${selected.evidence.quote}”`}</p></details></>}
   {error&&<p role="alert" className="cb-error">{error}</p>}
   <div className="cb-actions"><button type="submit" disabled={!hasValue}>Save</button><button type="button" onClick={close}>Cancel</button>{selected&&<button type="button" onClick={()=>{if(s.applyBriefOperations([{type:'retract',factIds:[selected.id]}],revision)){announce('Preference removed. You can undo this change.');close()}}}>Remove</button>}</div>
  </form>}
 </div>
  {busy&&<p className="cb-context" role="status">Updating your brief…</p>}{externalError&&<p className="cb-error" role="alert">{externalError}</p>}
  <span className="cb-sr" role="status" aria-live="polite">{briefAnnouncement(s.brief.revision,visible,announcement)}</span>
 </section>;
}
