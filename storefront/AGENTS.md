# Project operating rules

Work locally by default. Deploy to Vercel, including previews, only when Arijit explicitly requests deployment for that release. A code change, GitHub push, checkpoint or successful CI run is not deployment authorization. Keep git.deploymentEnabled false and CI verification-only. Keep Vercel Authentication enabled for all deployments.

The live customer Algolia index and every index configuration setting are strictly read-only. Never change index records, relevancy, attributes, ranking, rules, synonyms or replicas. Recommend any proposed index change to Arijit with reasoning and let him decide. Agent and application changes must not bypass this boundary.

Do not use em dashes in shopper-facing content or agent instructions. Preserve the desktop two-column conversation and product workspace.
