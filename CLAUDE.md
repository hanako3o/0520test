# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**Anonymous WebSocket Chat** — A serverless, single-channel, anonymous chat room. This repository is currently in the **design/planning phase**. The spec documents in `documents/` define the full system; the code has not been written yet.

The planned target repository for the actual implementation is `git@github.com:samsonchen/ai_course_2.git`.

## Planned Repository Structure

```
ai_course_2/
├── webui/                   # React + Vite + TypeScript frontend
│   └── src/
│       ├── App.tsx
│       ├── components/      # JoinScreen, ChatScreen, MessageList, MessageItem, MessageInput, StatusIndicator
│       ├── hooks/useWebSocket.ts
│       ├── types/index.ts
│       └── config.ts
├── lambda/
│   ├── connect/connect.py          # $connect route handler
│   ├── disconnect/disconnect.py    # $disconnect route handler
│   └── send_message/send_message.py # sendMessage route handler
├── template.yaml            # AWS SAM template (full template in documents/03-aws-configuration.md)
└── events/                  # SAM local test event JSON files
```

## Frontend Commands (once `webui/` exists)

```bash
cd webui
npm install
npm run dev        # Dev server at http://localhost:5173
npm run build      # Output to webui/dist/
```

**WebSocket endpoint for local dev** — create `webui/.env.local`:
```
VITE_WS_ENDPOINT=wss://{api-id}.execute-api.{region}.amazonaws.com/prod
```

The Vite config must set `base: '/ai_course_2/'` for GitHub Pages deployment.

## Backend Commands (once `lambda/` and `template.yaml` exist)

```bash
sam validate --template template.yaml
sam build
sam deploy --no-confirm-changeset    # After initial guided deploy
sam deploy --guided                  # First-time interactive deploy (human required)

# Local Lambda testing
sam local invoke ConnectFunction -e events/connect_valid.json

# View logs
sam logs -n ConnectFunction --stack-name anonymous-chat --tail

# Inspect DynamoDB
aws dynamodb scan --table-name ChatConnections

# Get WebSocket URL after deploy
aws cloudformation describe-stacks \
  --stack-name anonymous-chat \
  --query "Stacks[0].Outputs[?OutputKey=='WebSocketUrl'].OutputValue" \
  --output text
```

**Stack name:** `anonymous-chat` | **Region:** `us-west-2`

## Architecture

Browser (React, GitHub Pages) → WebSocket (`wss://`) → API Gateway v2 WebSocket → Lambda (Python 3.12) → DynamoDB (`ChatConnections` table)

**Three Lambda functions:**
- `connect` (`$connect` route): validates `callsign` query param, writes `{connectionId, callsign, connectedAt}` to DynamoDB, broadcasts `user_joined` system event
- `disconnect` (`$disconnect` route): deletes `connectionId` from DynamoDB, broadcasts `user_left` system event
- `send_message` (`sendMessage` route): reads sender's callsign from DynamoDB by `connectionId`, scans all connections, calls `PostToConnection` on each; deletes stale connections on `GoneException`

**DynamoDB table `ChatConnections`:** partition key `connectionId` (String). Only stores active connections — no message history. Access patterns: PUT on connect, DELETE on disconnect, full SCAN for broadcast fan-out.

**No message persistence by design** — messages are ephemeral, delivered in real-time only.

## Key Implementation Details

**Callsign:** passed as query string on WebSocket handshake (`?callsign=CoolDog`), validated with `^[a-zA-Z0-9_]{1,20}$`. The `sendMessage` Lambda retrieves it from DynamoDB rather than trusting the client payload, preventing spoofing.

**API Gateway Management API endpoint** (for `PostToConnection`):
```python
endpoint_url = f"https://{event['requestContext']['domainName']}/{event['requestContext']['stage']}"
```

**Environment variable:** `TABLE_NAME` is injected automatically by SAM — no manual configuration needed.

**Local DynamoDB for testing:** Lambda code should check for `DYNAMODB_ENDPOINT` env var and use it when present.

**`$connect` returning non-200** rejects the WebSocket handshake entirely.

## Server → Client Message Formats

```typescript
// Chat message
{ type: "message", callsign: string, text: string, timestamp: string }

// System event
{ type: "system", event: "user_joined" | "user_left", callsign: string, timestamp: string }
```

## Human-Only Steps

- `sam deploy --guided` (first deploy — requires interactive terminal)
- `aws configure` (credentials setup)
- GitHub Pages activation (repo Settings → Pages)

## Design Documents

All specs live in `documents/`:
- `01-system-architecture.md` — full architecture and design rationale
- `02-api-specification.md` — WebSocket routes, payloads, DynamoDB schema
- `03-aws-configuration.md` — SAM template and deployment procedures
- `04-lambda-connect-spec.md` — connect Lambda with test event examples
- `05-lambda-disconnect-spec.md` — disconnect Lambda spec
- `06-lambda-send-message-spec.md` — send_message Lambda spec
- `07-frontend-design.md` — React component structure, TypeScript interfaces, RWD requirements
