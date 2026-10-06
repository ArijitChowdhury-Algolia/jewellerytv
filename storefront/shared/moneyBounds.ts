export const MONEY_OPERATORS=['lt','lte','gt','gte'] as const;
export type MoneyOperator=typeof MONEY_OPERATORS[number];
export function isUpperMoneyBound(operator:MoneyOperator){return operator==='lt'||operator==='lte';}
export function moneyOperatorSymbol(operator:MoneyOperator){return {lt:'<',lte:'<=',gt:'>',gte:'>='}[operator];}
export function moneyOperatorLabel(operator:MoneyOperator){return {lt:'Under',lte:'Up to',gt:'Over',gte:'At least'}[operator];}
export function satisfiesMoneyBound(cents:number,operator:MoneyOperator,boundCents:number):boolean{
 if(!Number.isFinite(cents)||!Number.isFinite(boundCents))return false;
 switch(operator){case 'lt':return cents<boundCents;case 'lte':return cents<=boundCents;case 'gt':return cents>boundCents;case 'gte':return cents>=boundCents;}
}
/** Catalogue prices use nonnegative integer cents. Strict endpoints exclude one cent. */
export function hasImpossibleMoneyInterval(bounds:readonly {operator:MoneyOperator;cents:number}[]):boolean{
 let minimum=0,maximum=Number.POSITIVE_INFINITY;
 for(const b of bounds){if(b.operator==='gt')minimum=Math.max(minimum,b.cents+1);else if(b.operator==='gte')minimum=Math.max(minimum,b.cents);else if(b.operator==='lt')maximum=Math.min(maximum,b.cents-1);else maximum=Math.min(maximum,b.cents);}
 return minimum>maximum;
}
