import {Link,useLocation} from 'react-router-dom';
import {Heart,Star} from 'lucide-react';
import {useShopping} from './ShoppingProvider';
import {productURL} from './routing';
import {normalizeProduct} from './catalog';
export function ProductCard({item}:{item:unknown}){
 const product=normalizeProduct(item);const location=useLocation();const shopping=useShopping();const saved=shopping?.products.some(p=>p.product.id===product.id)??false;
 return <article className="product-card" data-product-id={product.id}>
  {shopping&&<button className="favorite-button" aria-label={`${saved?'Remove':'Save'} ${product.title}`} aria-pressed={saved} onClick={()=>saved?shopping.remove(product.id):shopping.pin(product.raw)}><Heart size={23} fill={saved?'currentColor':'none'}/></button>}
  <Link to={productURL(product.id,location.pathname,location.search)} state={{returnTo:location.pathname+location.search}} className="product-link">
   <div className="product-image-wrap">{product.images[0]?<img className="product-image" src={product.images[0]} alt={product.title} loading="lazy" onError={e=>{e.currentTarget.style.visibility='hidden';e.currentTarget.parentElement?.classList.add('image-unavailable');}}/>:<span>Image unavailable</span>}</div>
   <div className="product-meta">{product.rating!==null&&<span aria-label={`${product.rating} out of 5 stars`}><Star size={12} fill="currentColor"/> {product.rating.toFixed(1)}{product.ratingCount!==null?` (${product.ratingCount})`:''}</span>}{product.inStock===false&&<span>Currently unavailable</span>}</div>
   {product.priceLabel&&<div className="price-label">{product.priceLabel}</div>}
   <div className="product-price">{product.price!==null?new Intl.NumberFormat('en-US',{style:'currency',currency:'USD'}).format(product.price):'Price unavailable'}</div>
   <h3 className="product-title">{product.title}</h3>
  </Link>
  <span className="product-code">Item {product.id}</span>
 </article>;
}
