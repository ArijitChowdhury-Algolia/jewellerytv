# Project operating rules

Work locally by default. Deploy to Vercel, including previews, only when Arijit explicitly requests deployment for that release. A code change, GitHub push, checkpoint or successful CI run is not deployment authorization. Keep git.deploymentEnabled false and CI verification-only. Keep Vercel Authentication enabled for all deployments.

The live customer Algolia index and every index configuration setting are strictly read-only. Never change index records, relevancy, attributes, ranking, rules, synonyms or replicas. Recommend any proposed index change to Arijit with reasoning and let him decide. Agent and application changes must not bypass this boundary.

Do not use em dashes in shopper-facing content or agent instructions. Preserve the desktop two-column conversation and product workspace.

## Architecture governance and client-environment discipline

- Treat this as a client system, not a development playground. Use the approved Understanding and Discovery playbook as the requirements baseline; trace implementation and tests to it.
- Evaluate documented native Algolia Agent Studio and InstantSearch capabilities first. Follow current official Algolia recommendations and engineering best practices. Demonstrate Algolia accurately and well; do not mask missing capabilities or bypass controls to make a demo appear successful.
- Custom code is allowed only for a specific justified requirement or demonstrated platform gap. Explain responsibility, inputs/outputs, execution order, failure behavior, latency/cost, maintenance and simpler alternatives. No code or agents for their own sake.
- Agent topology and significant architecture changes require Arijit's explicit decision after options, pros/cons and evidence are presented. Do not assume one, two or more agents is the right answer. Research/prototypes do not authorize cloud resource creation or promotion.
- Do not create, duplicate, publish or repurpose client-side agents without explicit approval for the named purpose and scope. Maintain an inventory of owner, purpose, consumers, status and retirement condition for each agent.
- Review existing agents for cleanup. Preserve configurations and test evidence, verify active consumers and outstanding tests, and retire only confirmed temporary resources within the user's cleanup authorization. Do not delete shared or pre-existing client resources by inference.
- Architecture reviews are read-only for runtime behavior until Arijit chooses the design. Keep production catalogue/index configuration strictly read-only and deployments explicit-only under the rules above.

## Agent language must be generated, not scripted

- Arijit explicitly prohibits hardcoded shopper-facing agent replies and keyword-to-response scripts. The Concierge must generate its language from its instructions, conversation, accepted preferences and supported evidence.
- Good/bad examples illustrate tone and reasoning; never paste them as runtime answers or special-case demo/test inputs.
- Application code may enforce schemas, constraints, arithmetic, identity, access and validation. Return structured outcomes to the conversational owner rather than authoring the answer.
- Fixed UI labels and clearly identified system errors are distinct from agent speech. Do not disguise an application fallback, validation notice or stop template as a generated Concierge reply. Do not remove safeguards to eliminate a template.
- Tests evaluate meaning, factual support, state and helpfulness across varied wording. Exact prose matching is reserved for actual UI labels, not generated dialogue.

## Binding architecture correction: no application-authored agent behavior

Arijit's explicit decision, October 5, 2026, supersedes earlier proposals that put conversational control in application code.

- Agent instructions own intent interpretation, conversational progression, clarification, tone, personality, search decisions, explanations and closing behavior. Examples teach quality and are never fixed runtime responses.
- Application code connects to the agent, implements declared tools, maintains UI/session state, and performs deterministic data/access/arithmetic validation. It must not implement a parallel intent router, conversation policy, canned reply selector, agent-response rewriter or recovery prompt pipeline.
- Validation returns structured outcomes to the agent; application code must not translate those outcomes into shopper-facing agent speech. Fixed UI controls and honestly labelled transport errors are not agent replies.
- Remove the application-authored conversational routing/templates and the recently added conversational recovery/evidence-review prompt pipeline in a coordinated repair. Do not add more model calls or prompt logic in code to compensate. Preserve user data, product identity, required constraints and the two-column UI.
- The current implementation still violates this boundary. Do not claim remediation until runtime paths and native conversations verify it. No new agents, index changes or deployment are authorized by this instruction.
