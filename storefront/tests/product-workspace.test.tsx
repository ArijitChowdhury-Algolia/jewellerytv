// Distinct view contracts: comparison isn't a basket; combination arithmetic is explicit; images are real records.
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {it,expect,vi} from 'vitest';
import {normalizeProduct} from '../src/catalog';
const mock=vi.hoisted(()=>({state:{} as any}));
vi.mock('../src/ShoppingProvider',()=>({useShopping:()=>mock.state}));
import {ProductWorkspace} from '../src/ProductWorkspace';
const pieces=[normalizeProduct({objectID:'a',Catalog_TitleDescription:'Necklace',Pricing_ActivePrice:54.99,Media_Images:['https://example.com/a.jpg']}),normalizeProduct({objectID:'b',Catalog_TitleDescription:'Ring',Pricing_ActivePrice:94.99,Media_Images:['https://example.com/b.jpg']})];
function state(view:string){return {products:pieces.map(product=>({product,quantity:1})),selectionRecords:pieces,discoveries:[],displayIntro:'',activeView:view,compareIds:['a','b'],combinationIds:['a','b'],combinationQuantities:{a:1,b:1},budgetCents:15000,budgetScope:'total',refreshing:false,refreshError:'',setView:vi.fn(),refreshProducts:vi.fn(),toggleCompare:vi.fn(),toggleCombination:vi.fn(),pin:vi.fn(),remove:vi.fn(),setQuantity:vi.fn()};}
it('shows image-led comparison without subtotal or a chat submission button',()=>{mock.state=state('compare');const html=renderToStaticMarkup(<ProductWorkspace/>);expect(html).toContain('a.jpg');expect(html).toContain('b.jpg');expect(html).toContain('Not recorded');expect(html).not.toContain('Item subtotal');expect(html).not.toContain('Help me compare');});
it('calculates subtotal only for explicit combination selections',()=>{mock.state=state('combination');const html=renderToStaticMarkup(<ProductWorkspace/>);expect(html).toContain('$149.98');expect(html).toContain('$0.02');expect(html).toContain('Quantity');});
it('renders curated descriptions safely without literal markdown delimiters',()=>{mock.state={...state('discover'),displayIntro:'Choose **blue** <script>bad</script>',discoveries:[{title:'Options',items:[{product:pieces[0],why:'**Small** stone'}]}]};const html=renderToStaticMarkup(<ProductWorkspace/>);expect(html).not.toContain('Choose');expect(html).toContain('<strong>Small</strong>');expect(html).not.toContain('<script>');});
