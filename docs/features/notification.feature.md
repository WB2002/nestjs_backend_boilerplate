# Notification Feature

## Overview

Generic outbound notifications via `INotificationService`. Application code depends only on this abstraction. Slack Incoming Webhooks is the first provider. Callers never import Slack types or payloads.

The architecture is compatible with a future queue/worker:

```
Business operation → NotificationService → (optional queue) → Slack / Email / Discord
```

No message bus is implemented yet.

---

## Dependencies

None beyond the existing NestJS stack and `HttpClient` (`src/core/http-client`).

---

## Environment Variables

| Variable | Required | Secret | Description |
|---|---|---|---|
| `SLACK_WEBHOOK_URL` | For Slack sends | Yes | Full Incoming Webhook URL (`https://hooks.slack.com/services/...`) |

Treat the webhook URL as a secret. Never log it, return it from an API, commit it, or expose it to frontend apps. Do not put it in exception messages.

Timeout is fixed at 5 seconds (`SLACK_WEBHOOK_TIMEOUT_MS`). No retries.

---

## Module Layout

```
src/core/notification/          # Global provider (like HttpClient)
├── notification.module.ts
├── notification.constants.ts
├── errors/notification.error.ts
├── types/notification.types.ts
└── providers/
    ├── slack-message.formatter.ts
    └── slack-notification.service.ts

src/example/                    # Demo feature only — not production business logic
├── example.module.ts
├── example-notification.controller.ts
├── example-notification.service.ts
└── dto/
```

Inject with:

```ts
@Inject(NOTIFICATION_SERVICE)
private readonly notificationService: INotificationService
```

Do **not** inject `SlackNotificationService` from feature code.

---

## Generic Model

```ts
interface INotification {
  title?: string;
  message: string;
  metadata?: Record<string, unknown>;
}

interface INotificationService {
  send(notification: INotification): Promise<void>;
}
```

`send` throws `NotificationError` with codes:

| Code | Meaning |
|---|---|
| `MISSING_CONFIGURATION` | Webhook unset/invalid |
| `TIMEOUT` | Slack request timed out |
| `UNAVAILABLE` | Network / Slack unreachable |
| `HTTP_ERROR` | Non-success HTTP from Slack |
| `MALFORMED_RESPONSE` | Unexpected response body |

Callers decide whether to ignore, log, retry, or queue. The example API catches and logs so the business operation still succeeds.

---

## Example API

`POST /example/notification` (JWT required — global `JwtAuthGuard`)

Request:

```json
{
  "message": "Example operation completed successfully",
  "metadata": {
    "operationId": "123",
    "result": "success"
  }
}
```

Response (notification success or failure):

```json
{
  "status": "success",
  "operationId": "123",
  "notificationSent": true
}
```

When Slack fails, `status` remains `"success"` and `notificationSent` is `false`.

---

## Slack Message Format

Provider-only formatting. Example channel text:

```
*Operation Completed*

Example operation completed successfully

Operation ID: 123
Result: success

Additional metadata:
• customKey: value
```

Sensitive metadata keys (password, token, secret, captcha, credential, authorization, api_key, private_key, etc.) are omitted.

---

## Local Setup

1. Create a Slack Incoming Webhook and copy the URL.
2. Set in `.env` (gitignored):

   ```
   SLACK_WEBHOOK_URL=https://hooks.slack.com/services/...
   ```

3. Start the app (`pnpm start:dev`).
4. Authenticate per `docs/features/auth.feature.md`.
5. Call:

   ```bash
   curl -X POST http://localhost:3000/example/notification \
     -H "Authorization: Bearer <accessToken>" \
     -H "Content-Type: application/json" \
     -d '{"message":"Example operation completed successfully","metadata":{"operationId":"123","result":"success"}}'
   ```

6. Confirm the Slack channel message.
7. Unset or invalidate the webhook and confirm the API still returns `status: "success"` with `notificationSent: false`.

---

## Observability

Structured Nest `Logger` events:

- `notification sent` (provider: slack)
- `notification failed` with `reason`: `timeout` | `unavailable` | `http_error` | `malformed_response`

HTTP client metrics are enabled for the Slack client (`serviceName: slack-incoming-webhook`). Request logging/tracing are **disabled** for Slack so the webhook path token is never written to logs.

---

## Future Providers

Swap or add providers by changing the `NOTIFICATION_SERVICE` factory in `NotificationModule` (e.g. Email, Discord) without changing business callers.
