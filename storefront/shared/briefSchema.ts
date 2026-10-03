import {z} from 'zod';
import {BRIEF_FIELDS} from './shopping.js';
const id=z.string().min(1).max(300);
export const briefValueSchema=z.discriminatedUnion('kind',[
 z.object({kind:z.literal('text'),text:z.string().min(1).max(500)}).strict(),
 z.object({kind:z.literal('money'),cents:z.number().int().nonnegative().max(100000000),currency:z.literal('USD'),operator:z.enum(['lt','lte']),basis:z.enum(['total','per-item','unresolved'])}).strict(),
 z.object({kind:z.literal('facet'),attribute:z.string().min(1).max(120),values:z.array(z.string().min(1).max(150)).min(1).max(20),operator:z.enum(['any','none'])}).strict(),
]);
export const briefEvidenceSchema=z.object({messageId:id,quote:z.string().min(1).max(2000),explicit:z.boolean(),verified:z.boolean()}).strict();
const factShape={id,field:z.enum(BRIEF_FIELDS),value:briefValueSchema,scope:z.object({kind:z.enum(['mission','item','recipient']),key:id.optional()}).strict().refine(s=>s.kind==='mission'||!!s.key,'Scoped facts need a key'),strength:z.enum(['requirement','preference']),origin:z.enum(['spoken','ui']),evidence:briefEvidenceSchema};
export const briefFactInputSchema=z.object({...factShape,status:z.enum(['active','tentative'])}).strict();
export const briefFactSchema=z.object({...factShape,status:z.enum(['active','tentative','retracted','superseded']),revision:z.number().int().nonnegative(),createdAt:z.string().max(100)}).strict().transform(f=>f.status==='active'&&f.value.kind==='money'&&f.value.basis==='unresolved'?{...f,status:'tentative' as const}:f);
export const briefOperationSchema=z.discriminatedUnion('type',[
 z.object({type:z.literal('reset-brief'),evidence:briefEvidenceSchema.optional()}).strict(),
 z.object({type:z.literal('add'),fact:briefFactInputSchema}).strict(),
 z.object({type:z.literal('replace'),factIds:z.array(id).min(1).max(40),fact:briefFactInputSchema}).strict(),
 ...(['retract','confirm','mark-tentative'] as const).map(type=>z.object({type:z.literal(type),factIds:z.array(id).min(1).max(40)}).strict()),
]);
export const briefPatchSchema=z.object({missionId:id,expectedRevision:z.number().int().nonnegative(),turnId:id,operations:z.array(briefOperationSchema).max(40)}).strict();
const tombstoneSchema=z.object({factId:id,messageId:id,quote:z.string().max(2000),revision:z.number().int().nonnegative()}).strict();
const eventSchema=z.object({resetEvidence:briefEvidenceSchema.optional(),revision:z.number().int().nonnegative(),turnId:id,beforeFacts:z.array(briefFactSchema).max(200),beforeTombstones:z.array(tombstoneSchema).max(200)}).strict();
export const briefStateSchema=z.object({version:z.literal(2),missionId:id,revision:z.number().int().nonnegative(),facts:z.array(briefFactSchema).max(200),processedTurns:z.array(id).max(200),tombstones:z.array(tombstoneSchema).max(200),events:z.array(eventSchema).max(20)}).strict().refine(s=>new Set(s.facts.map(f=>f.id)).size===s.facts.length,'Duplicate fact IDs');
export type BriefFactInput=z.infer<typeof briefFactInputSchema>;
export type BriefFactV2=z.infer<typeof briefFactSchema>;
export type BriefOperation=z.infer<typeof briefOperationSchema>;
export type BriefPatch=z.infer<typeof briefPatchSchema>;
export type BriefState=z.infer<typeof briefStateSchema>;
export function formatBriefValue(value:BriefFactV2['value']):string{if(value.kind==='text')return value.text;if(value.kind==='facet')return `${value.operator==='none'?'No ':''}${value.values.join(' or ')}`;return `${value.operator==='lt'?'Under':'Up to'} $${(value.cents/100).toFixed(2)}${value.basis==='total'?' total':value.basis==='per-item'?' per item':' (scope unclear)'}`;}
