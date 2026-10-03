import {ProductWorkspace} from './ProductWorkspace';
import {useShopping} from './ShoppingProvider';
import './shopping-workspace.css';
/** Product work lives here; the editable brief stays alongside the conversation. */
export function ShoppingWorkspace({onSend}:{onSend?:(message:string)=>void;onReset?:()=>void}){
 const s=useShopping();
 if(!s)return null;
 return <aside className="shopping-workspace" aria-label="Your shopping workspace">
  {s.error&&<p className="workspace-error" role="alert">{s.error}</p>}
  <ProductWorkspace onAsk={onSend}/>
 </aside>;
}
