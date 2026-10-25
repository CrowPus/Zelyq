# Slack notify

Posts a message to a Slack channel when your pipeline reaches this step.

```yaml
- plugin: zelyq/slack-notify@1.0.0
  with:
    webhook: vault://SLACK_WEBHOOK
    message: "Shop is live"
```

| Input | |
| --- | --- |
| `webhook` | **Required.** The channel's incoming-webhook address, from Vault. Create one in Slack: *Apps → Incoming Webhooks*. |
| `message` | What to post. `${ZELYQ_RUN_NUMBER}`, `${ZELYQ_RUN_ID}` and `${ZELYQ_PIPELINE}` are filled in. Default: which run of which pipeline finished. |

Output `status`: the HTTP status Slack answered with. The step fails unless it is 2xx.

Runs on Linux and macOS runners with `curl`.
