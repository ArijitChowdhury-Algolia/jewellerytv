export interface PageContextState {
 route?: string; category?: string; query?: string; refinements?: Record<string, unknown>;
 sort?: string; visibleProductIds?: string[]; selectedProductId?: string | null;
 selectedSize?: string | null; revision?: number | string;
}
const bytes = (value: string) => new TextEncoder().encode(value).length;
/** Capture an immutable, bounded snapshot. Oversize constraints are an explicit error. */
export function buildContext(state: PageContextState): Record<string,string> {
 const result: Record<string,string> = {};
 const add = (key: string,value: string | undefined | null) => {
  if (!value) return;
  if(bytes(value)>1024) throw new Error(`Page context ${key} exceeds 1024 UTF-8 bytes. Reduce active constraints before sending.`);
  result[key]=value;
 };
 add('route',state.route);add('category',state.category);add('query',state.query);add('sort',state.sort);
 if(state.refinements && Object.keys(state.refinements).length) add('refinements',JSON.stringify(state.refinements));
 add('selectedProductId',state.selectedProductId);add('selectedSize',state.selectedSize);
 if(state.revision!==undefined) add('revision',String(state.revision));
 let chunk:string[]=[];let index=0;
 const flush=()=>{if(chunk.length){add(`visibleProductIds_${index++}`,JSON.stringify(chunk));chunk=[];}};
 for(const id of state.visibleProductIds ?? []){
  if(bytes(JSON.stringify([id]))>1024) throw new Error('Page context product identity exceeds 1024 UTF-8 bytes.');
  if(bytes(JSON.stringify([...chunk,id]))>1024) flush();
  chunk.push(id);
 }
 flush();
 if(Object.keys(result).length>32) throw new Error('Page context exceeds 32 fields.');
 // Counting the JSON envelope is deliberately stricter than summing value bytes alone.
 if(bytes(JSON.stringify(result))>4096) throw new Error('Page context exceeds 4096 UTF-8 bytes. Reduce active constraints before sending.');
 return result;
}
