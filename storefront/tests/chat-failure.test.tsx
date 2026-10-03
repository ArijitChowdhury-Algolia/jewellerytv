import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {it,expect} from 'vitest';
import {ChatFailure} from '../src/Concierge';
it('requires a new message when retrying would replay an obsolete shopper instruction',()=>{const html=renderToStaticMarkup(<ChatFailure context={{error:new Error('Your preferences changed after this message was sent. Send a new message to continue with your newer brief.'),onReload:()=>{}} as any}/>);expect(html).toContain('Send a new message');expect(html).not.toContain('<button');});
it('keeps retry available for a recoverable failed response',()=>{const html=renderToStaticMarkup(<ChatFailure context={{error:new Error('Network unavailable'),onReload:()=>{}} as any}/>);expect(html).toContain('Retry this reply');});
