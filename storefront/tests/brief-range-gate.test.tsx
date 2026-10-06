import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {afterEach,expect,it,vi} from 'vitest';
import {PriceLimitOptions,briefFactLabel} from '../src/ShoppingBrief.js';
import type {BriefFactV2} from '../shared/briefSchema.js';
afterEach(()=>vi.unstubAllEnvs());
it.each([undefined,'false'])('hides new floors by default or off (%s)',value=>{vi.stubEnv('VITE_BRIEF_PRICE_RANGES_ENABLED',value);const html=renderToStaticMarkup(<select><PriceLimitOptions/></select>);expect(html).toContain('value="lt"');expect(html).toContain('value="lte"');expect(html).not.toContain('value="gt"');expect(html).not.toContain('value="gte"');});
it('offers both floors only when explicitly enabled',()=>{vi.stubEnv('VITE_BRIEF_PRICE_RANGES_ENABLED','true');const html=renderToStaticMarkup(<select><PriceLimitOptions/></select>);expect(html).toContain('value="gt"');expect(html).toContain('value="gte"');});
it('preserves an existing floor option and label while disabled',()=>{vi.stubEnv('VITE_BRIEF_PRICE_RANGES_ENABLED','false');const html=renderToStaticMarkup(<select><PriceLimitOptions selectedOperator="gte"/></select>);expect(html).toContain('value="gte"');expect(html).not.toContain('value="gt"');const fact={value:{kind:'money',operator:'gte',currency:'USD',cents:2000,basis:'per-item'}} as BriefFactV2;expect(briefFactLabel(fact)).toBe('At least $20.00 per item');});
