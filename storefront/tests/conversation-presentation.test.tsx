import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {it,expect} from 'vitest';
import {ConversationText} from '../src/ConversationText';
import {OptionalSuggestions} from '../src/OptionalSuggestions';
it('preserves the agent introduction and question as safe conversational text',()=>{const html=renderToStaticMarkup(<ConversationText text={'Let’s explore **rings**.\n\nWhich style appeals? <script>bad</script>'}/>);expect(html).toContain('<strong>rings</strong>');expect(html).toContain('Which style appeals?');expect(html).toContain('&lt;script&gt;');expect(html).not.toContain('<script>');});
it('makes followups opt-in and removes exact duplicates',()=>{const html=renderToStaticMarkup(<OptionalSuggestions suggestions={['Compare styles','Compare styles','Show colours','More']} onSuggestionClick={()=>{}}/>);expect(html).toContain('<details');expect(html).not.toContain(' open');expect((html.match(/<button/g)||[])).toHaveLength(2);});
