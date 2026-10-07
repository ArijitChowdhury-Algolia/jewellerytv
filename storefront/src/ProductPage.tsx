import {useEffect,useState} from 'react';
import {Link,useLocation,useParams} from 'react-router-dom';
import {normalizeProduct,type Product} from './catalog';
export function ProductPage({onSelection,onAsk}:{onSelection:(id:string|null,size:string|null)=>void;onAsk:()=>void}){
 const {objectID}=useParams();const location=useLocation();const [product,setProduct]=useState<Product|null>(null);const [error,setError]=useState('');const [size,setSize]=useState('');const [photo,setPhoto]=useState(0);
 useEffect(()=>{const controller=new AbortController();setProduct(null);setError('');setSize('');setPhoto(0);onSelection(objectID||null,null);
 fetch(`/api/products/${encodeURIComponent(objectID||'')}`,{signal:controller.signal}).then(async r=>{if(!r.ok)throw new Error(r.status===404?'This item is no longer in the catalogue.':'Product information could not be loaded.');return r.json();}).then(raw=>setProduct(normalizeProduct(raw))).catch((e:unknown)=>{if(!controller.signal.aborted)setError(e instanceof Error?e.message:'Product information could not be loaded.');});return()=>{controller.abort();onSelection(null,null);};},[objectID,onSelection]);
 if(error)return <main className="page error-state"><h1>Product unavailable</h1><p role="alert">{error}</p><Link to="/search">Browse jewelry</Link></main>;
 if(!product)return <main className="page loading-state" aria-busy="true">Loading product details…</main>;
 const browseParams = new URLSearchParams(location.search);
 const category = browseParams.get('category');
 browseParams.delete('category');
 const browsePath = category && /^[a-z0-9-]+$/.test(category) ? `/category/${category}` : '/search';
 const fallbackReturnTo = browsePath + (browseParams.size ? `?${browseParams.toString()}` : '');
 const returnTo =
   typeof location.state?.returnTo === 'string' ? location.state.returnTo : fallbackReturnTo;
 return <main className="page"><nav className="breadcrumbs"><Link to="/">JTV</Link> / <Link to={returnTo}>Back to results</Link> / {product.id}</nav>
 <section className="product-detail"><div className="gallery"><div className="detail-image">{product.images[photo]?<img src={product.images[photo]} alt={product.title}/>:<p>Image unavailable</p>}</div><div className="thumbnail-row">{product.images.map((src,i)=><button key={src} aria-label={`View product image ${i+1}`} aria-pressed={photo===i} onClick={()=>setPhoto(i)}><img src={src} alt=""/></button>)}</div></div>
 <div className="product-info">{product.brand&&<p className="brand-name">{product.brand}</p>}<h1>{product.title}</h1><p className="muted">Item {product.id}{product.familyId!==product.id&&` · Family ${product.familyId}`}</p>{product.rating!==null&&<p>★ {product.rating.toFixed(1)} out of 5</p>}<p className="detail-price">{product.price!==null?`$${product.price.toFixed(2)}`:'Price unavailable'}</p>{product.priceLabel&&<p>{product.priceLabel}</p>}
 <p>{product.inStock===true?'In stock in the catalogue':product.inStock===false?'Currently unavailable':'Availability not provided'}</p>
 {product.sizes.length>0&&<fieldset><legend>Available size{size?`: ${size}`:''}</legend><div className="size-options">{product.sizes.map(s=><button key={s.value} aria-pressed={size===s.value} onClick={()=>{setSize(s.value);onSelection(product.id,s.value);}}>{s.label}</button>)}</div></fieldset>}
 <button className="primary-button ask-product" onClick={onAsk}>Ask about this item</button><p className="demo-note">Explore with the concierge. Checkout is not available in this local demo.</p>
 <details open className="product-facts"><summary>Product information</summary>{product.description&&<p>{product.description}</p>}<dl>{product.attributes.map(a=><div key={a.label}><dt>{a.label}</dt><dd>{a.value}</dd></div>)}</dl></details>
 <details className="product-facts"><summary>About catalogue information</summary><p>Prices, availability and sizes come from the connected catalogue. They can differ from JTV’s website and are not checkout confirmation. Missing details have not been inferred.</p></details>
 </div></section></main>;
}
