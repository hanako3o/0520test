# API Specification

## Overview

The backend exposes a single **WebSocket API** via AWS API Gateway v2. There are no REST/HTTP endpoints. All communication happens over a persistent WebSocket connection.

**Endpoint format:** `wss://{api-id}.execute-api.{region}.amazonaws.com/{stage}`

## Route Selection

API Gateway routes incoming WebSocket frames based on the `action` field in the JSON body:

```
Route Selection Expression: $request.body.action
```

| Route | Trigger | Lambda |
|-------|---------|--------|
| `$connect` | Client opens WebSocket connection | `connect.handler` |
| `$disconnect` | Client closes connection or connection drops | `disconnect.handler` |
| `sendMessage` | Client sends `{"action": "sendMessage", ...}` | `send_message.handler` |

## Route: `$connect`

**Trigger:** Automatic when a client initiates a WebSocket handshake.

**Query String Parameters:**

| Parameter | Required | Type | Description |
|-----------|----------|------|-------------|
| `callsign` | Yes | string | The user's display name. Max 20 characters, alphanumeric and underscores only. |

**Example connection URL:**

```
wss://abc123.execute-api.us-west-2.amazonaws.com/prod?callsign=CoolDog
```

**Lambda receives (event):**

```json
{
  "requestContext": {
    "connectionId": "abc123=",
    "routeKey": "$connect",
    "eventType": "CONNECT",
    "domainName": "abc123.execute-api.us-west-2.amazonaws.com",
    "stage": "prod"
  },
  "queryStringParameters": {
    "callsign": "CoolDog"
  }
}
```

**Response:**

| Status | Meaning |
|--------|---------|
| 200 | Connection accepted, `connectionId` stored |
| 400 | Missing or invalid `callsign` |
| 500 | Internal error (DynamoDB write failure) |

**Note:** Returning a non-200 status code from `$connect` rejects the WebSocket handshake.

## Route: `$disconnect`

**Trigger:** Automatic when the client closes the connection or the connection times out.

**Lambda receives (event):**

```json
{
  "requestContext": {
    "connectionId": "abc123=",
    "routeKey": "$disconnect",
    "eventType": "DISCONNECT",
    "domainName": "abc123.execute-api.us-west-2.amazonaws.com",
    "stage": "prod"
  }
}
```

**Parameters:** None. The `connectionId` is extracted from `requestContext`.

**Response:**

| Status | Meaning |
|--------|---------|
| 200 | Connection record deleted |
| 500 | Internal error (DynamoDB delete failure) |

**Note:** The response status code for `$disconnect` is informational only — the connection is already closed.

## Route: `sendMessage`

**Trigger:** Client sends a JSON frame with `"action": "sendMessage"`.

**WebSocket Frame (client → server):**

```json
{
  "action": "sendMessage",
  "text": "Hello everyone!"
}
```

| Field | Required | Type | Description |
|-------|----------|------|-------------|
| `action` | Yes | string | Must be `"sendMessage"` |
| `text` | Yes | string | The message content. Max 1000 characters. |

**Note:** The `callsign` is **not** sent in the message body. It is retrieved from DynamoDB using the sender's `connectionId`, which was stored during `$connect`. This prevents callsign spoofing.

**Lambda receives (event):**

```json
{
  "requestContext": {
    "connectionId": "abc123=",
    "routeKey": "sendMessage",
    "eventType": "MESSAGE",
    "domainName": "abc123.execute-api.us-west-2.amazonaws.com",
    "stage": "prod"
  },
  "body": "{\"action\":\"sendMessage\",\"text\":\"Hello everyone!\"}"
}
```

**Broadcast payload (server → all clients):**

```json
{
  "type": "message",
  "callsign": "CoolDog",
  "text": "Hello everyone!",
  "timestamp": "2025-01-15T10:30:00Z"
}
```

**Response:**

| Status | Meaning |
|--------|---------|
| 200 | Message broadcasted |
| 400 | Missing or invalid `text` field |
| 500 | Internal error |

## Server-Push: PostToConnection

The `send_message` Lambda uses the API Gateway Management API to push messages to connected clients.

**API Gateway Management Endpoint:**

```
https://{domainName}/{stage}
```

This is constructed from `event["requestContext"]["domainName"]` and `event["requestContext"]["stage"]`.

**SDK call:**

```python
apigw = boto3.client(
    "apigatewaymanagementapi",
    endpoint_url=f"https://{domain}/{stage}"
)

apigw.post_to_connection(
    ConnectionId="abc123=",
    Data=json.dumps(payload).encode("utf-8")
)
```

**Error handling:**

- `GoneException` (410): The connection is stale. Delete it from DynamoDB.
- Other exceptions: Log and continue to next connection.

## System Events (Server → Client)

In addition to chat messages, the server may push system events:

**User joined:**

```json
{
  "type": "system",
  "event": "user_joined",
  "callsign": "CoolDog",
  "timestamp": "2025-01-15T10:30:00Z"
}
```

**User left:**

```json
{
  "type": "system",
  "event": "user_left",
  "callsign": "CoolDog",
  "timestamp": "2025-01-15T10:30:00Z"
}
```

## DynamoDB Table Schema

**Table name:** `Connections`

| Attribute | Type | Key | Description |
|-----------|------|-----|-------------|
| `connectionId` | String | Partition Key | API Gateway assigned connection ID |
| `callsign` | String | — | User's display name |
| `connectedAt` | String | — | ISO 8601 timestamp of connection |

**Billing mode:** PAY_PER_REQUEST (on-demand)

No GSI or LSI required. The only access pattern is:
- PUT on connect
- DELETE on disconnect
- SCAN to get all connections for broadcast

**Note on SCAN:** For a small-scale educational project, scanning the entire table is acceptable. For production scale (hundreds+ concurrent users), consider pagination or a different fan-out strategy (e.g., SNS).
