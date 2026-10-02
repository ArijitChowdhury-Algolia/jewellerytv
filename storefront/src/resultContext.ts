/** Only advertise records actually rendered in the current, settled view. */
export function visibleResultIds(path:string,ready:boolean,ids:string[]):string[]{
 if(!ready)return [];
 if(path==='/')return ids.slice(0,4);
 if(path==='/search'||path.startsWith('/category/'))return ids.slice(0,24);
 return [];
}
export function sameRefinements(a:Record<string,string[]>={},b:Record<string,string[]>={}):boolean{
 const canonical=(value:Record<string,string[]>)=>JSON.stringify(Object.entries(value).filter(([,v])=>v.length).sort(([a],[b])=>a.localeCompare(b)).map(([k,v])=>[k,[...v].sort()]));return canonical(a)===canonical(b);
}
export function samePriceRange(range:Record<string,string>={},numeric:Record<string,Record<string,(number|number[])[]>>={}):boolean{
 const [min,max]=(range.Pricing_ActivePrice||':').split(':');const values=numeric.Pricing_ActivePrice||{};
 return (min===''?!(values['>=']?.length):values['>=']?.[0]===Number(min))&&(max===''?!(values['<=']?.length):values['<=']?.[0]===Number(max));
}
