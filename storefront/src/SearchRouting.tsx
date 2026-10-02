import {useEffect,useMemo,useRef} from 'react';
import {useLocation,useNavigate} from 'react-router-dom';
import type {UiState} from 'instantsearch.js';
import {readSearchState,searchURL} from './routing';
/** One adapter coordinates React Router navigation and InstantSearch URL writes. */
export function useSearchRouting(){
 const navigate=useNavigate();const location=useLocation();
 const update=useRef<((state:UiState)=>void)|null>(null);const lastWrite=useRef('');
 const nav=useRef(navigate);nav.current=navigate;
 const routing=useMemo(()=>({
  router:{
   read:()=>({prod_catalog:readSearchState(window.location.href)}),
   write:(state:UiState)=>{const current=window.location.pathname+window.location.search;const url=searchURL(current,state.prod_catalog||{});if(url!==current){lastWrite.current=url;nav.current(url);}},
   createURL:(state:UiState)=>searchURL(window.location.pathname+window.location.search,state.prod_catalog||{}),
   onUpdate:(callback:(state:UiState)=>void)=>{update.current=callback;},
   dispose:()=>{update.current=null;},
  }
 }),[]);
 useEffect(()=>{const path=location.pathname+location.search;if(lastWrite.current===path){lastWrite.current='';return;}update.current?.({prod_catalog:readSearchState(path)});},[location]);
 return routing;
}
