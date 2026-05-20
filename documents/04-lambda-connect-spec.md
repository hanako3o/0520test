# Lambda Specification: connect

## Function Identity

| Field | Value |
|-------|-------|
| Function Name | `chat-connect` |
| Handler | `connect.handler` |
| Runtime | Python 3.12 |
| Code Location | `lambda/connect/connect.py` |
| Route | `$connect` |
| Timeout | 10 seconds |
| Memory | 128 MB |

## Purpose

Handles new WebSocket connections. Stores the `connectionId` and user `callsign` in DynamoDB so the system knows who is currently connected.

## Input

**Event source:** API Gateway WebSocket `$connect` route.

**Relevant fields from `event`:**

```python
connection_id = event["requestContext"]["connectionId"]  # mandatory, provided by API Gateway
callsign = event.get("queryStringParameters", {}).get("callsign")  # mandatory, from client
```

**Validation rules:**

| Field | Rule |
|-------|------|
| `callsign` | Required. Must be 1–20 characters. Alphanumeric and underscores only (`^[a-zA-Z0-9_]{1,20}$`). |

## Processing Logic

```
1. Extract connectionId from event.requestContext.connectionId
2. Extract callsign from event.queryStringParameters.callsign
3. Validate callsign:
   - If missing or invalid → return 400
4. Write to DynamoDB:
   - connectionId (PK)
   - callsign
   - connectedAt (ISO 8601 UTC timestamp)
5. Broadcast a "user_joined" system event to all existing connections
6. Return 200
```

## DynamoDB Operations

**Write item:**

```python
table.put_item(
    Item={
        "connectionId": connection_id,
        "callsign": callsign,
        "connectedAt": datetime.utcnow().isoformat() + "Z",
    }
)
```

## Output

**Success (200):**

```json
{
  "statusCode": 200,
  "body": "Connected"
}
```

**Validation error (400):**

```json
{
  "statusCode": 400,
  "body": "Invalid or missing callsign"
}
```

**Internal error (500):**

```json
{
  "statusCode": 500,
  "body": "Internal server error"
}
```

**Note:** Returning non-200 from `$connect` causes API Gateway to reject the WebSocket handshake.

## Environment Variables

| Variable | Source | Description |
|----------|--------|-------------|
| `TABLE_NAME` | SAM template | DynamoDB table name |

## IAM Permissions Required

- `dynamodb:PutItem` on the Connections table
- `dynamodb:Scan` on the Connections table (for broadcasting join event)
- `execute-api:ManageConnections` (for broadcasting join event)

## Implementation Notes

- The `callsign` is passed as a query string parameter during the WebSocket handshake, not in the body. The `$connect` route does not have access to a request body.
- The `connectedAt` timestamp is stored for informational purposes (e.g., debugging stale connections). It is not used in any query.
- Keep the function fast — the WebSocket handshake has a timeout. Avoid heavy processing.
- The broadcast of `user_joined` is a nice-to-have. If it adds too much latency to the connect handshake, it can be made optional or moved to an async invocation.

## Error Handling

| Error | Action |
|-------|--------|
| Missing `queryStringParameters` | Return 400 |
| DynamoDB `PutItem` fails | Log error, return 500 |
| Broadcast fails for one connection | Log, skip (do not fail the connect) |

## SAM Local Test Plan

### Test 1: Successful connection

**Command:**

```bash
sam local invoke ConnectFunction -e events/connect_valid.json
```

**Event file (`events/connect_valid.json`):**

```json
{
  "requestContext": {
    "connectionId": "test-conn-001",
    "routeKey": "$connect",
    "eventType": "CONNECT",
    "domainName": "localhost",
    "stage": "prod"
  },
  "queryStringParameters": {
    "callsign": "TestUser"
  }
}
```

**Expected result:** Status 200, item written to DynamoDB.

### Test 2: Missing callsign

**Event file (`events/connect_no_callsign.json`):**

```json
{
  "requestContext": {
    "connectionId": "test-conn-002",
    "routeKey": "$connect",
    "eventType": "CONNECT",
    "domainName": "localhost",
    "stage": "prod"
  },
  "queryStringParameters": null
}
```

**Expected result:** Status 400, no DynamoDB write.

### Test 3: Invalid callsign (too long)

**Event file (`events/connect_bad_callsign.json`):**

```json
{
  "requestContext": {
    "connectionId": "test-conn-003",
    "routeKey": "$connect",
    "eventType": "CONNECT",
    "domainName": "localhost",
    "stage": "prod"
  },
  "queryStringParameters": {
    "callsign": "ThisCallsignIsWayTooLongToBeValid"
  }
}
```

**Expected result:** Status 400, no DynamoDB write.

### DynamoDB Local Setup

To test against a local DynamoDB instance:

```bash
# Start DynamoDB Local (Docker)
docker run -p 8000:8000 amazon/dynamodb-local

# Create the table locally
aws dynamodb create-table \
  --table-name ChatConnections \
  --attribute-definitions AttributeName=connectionId,AttributeType=S \
  --key-schema AttributeName=connectionId,KeyType=HASH \
  --billing-mode PAY_PER_REQUEST \
  --endpoint-url http://localhost:8000

# Set environment variable for Lambda to use local DynamoDB
# In template.yaml or env.json:
# DYNAMODB_ENDPOINT: http://host.docker.internal:8000
```

**Note:** The Lambda code should check for a `DYNAMODB_ENDPOINT` environment variable and use it if present, allowing seamless switching between local and AWS DynamoDB.
