# Lambda Specification: disconnect

## Function Identity

| Field | Value |
|-------|-------|
| Function Name | `chat-disconnect` |
| Handler | `disconnect.handler` |
| Runtime | Python 3.12 |
| Code Location | `lambda/disconnect/disconnect.py` |
| Route | `$disconnect` |
| Timeout | 10 seconds |
| Memory | 128 MB |

## Purpose

Handles WebSocket disconnections. Removes the `connectionId` from DynamoDB and optionally broadcasts a "user_left" system event to remaining connections.

## Input

**Event source:** API Gateway WebSocket `$disconnect` route.

**Relevant fields from `event`:**

```python
connection_id = event["requestContext"]["connectionId"]  # mandatory, provided by API Gateway
domain_name = event["requestContext"]["domainName"]       # for broadcast endpoint
stage = event["requestContext"]["stage"]                  # for broadcast endpoint
```

**No query string parameters or body.** The `$disconnect` event only provides `requestContext`.

## Processing Logic

```
1. Extract connectionId from event.requestContext.connectionId
2. Read the connection item from DynamoDB to get the callsign (for the leave broadcast)
3. Delete the connectionId from DynamoDB
4. Broadcast a "user_left" system event to all remaining connections
5. Return 200
```

## DynamoDB Operations

**Read item (to get callsign before deletion):**

```python
response = table.get_item(Key={"connectionId": connection_id})
callsign = response.get("Item", {}).get("callsign", "unknown")
```

**Delete item:**

```python
table.delete_item(Key={"connectionId": connection_id})
```

## Output

**Success (200):**

```json
{
  "statusCode": 200,
  "body": "Disconnected"
}
```

**Internal error (500):**

```json
{
  "statusCode": 500,
  "body": "Internal server error"
}
```

**Note:** The response for `$disconnect` is informational only — the WebSocket connection is already closed by the time this Lambda runs. API Gateway does not forward the response to the client.

## Environment Variables

| Variable | Source | Description |
|----------|--------|-------------|
| `TABLE_NAME` | SAM template | DynamoDB table name |

## IAM Permissions Required

- `dynamodb:GetItem` on the Connections table
- `dynamodb:DeleteItem` on the Connections table
- `dynamodb:Scan` on the Connections table (for broadcasting leave event)
- `execute-api:ManageConnections` (for broadcasting leave event)

## Implementation Notes

- The `$disconnect` route fires on both clean closes (client calls `ws.close()`) and dirty disconnects (network drop, browser tab close). Handle both identically.
- The DynamoDB `DeleteItem` is idempotent — calling it on a non-existent key is a no-op, not an error. No need to check existence before deleting.
- If the `GetItem` returns no item (connection was already cleaned up), set callsign to `"unknown"` and proceed. Do not fail.
- The broadcast of `user_left` should be best-effort. If it fails for some connections, log and continue. Do not let broadcast failures cause the disconnect handler to fail.
- If broadcasting adds unacceptable latency or complexity, it can be skipped entirely for the initial implementation. The primary responsibility is removing the DynamoDB record.

## Error Handling

| Error | Action |
|-------|--------|
| `GetItem` returns no item | Use `"unknown"` as callsign, proceed |
| `DeleteItem` fails | Log error, return 500 |
| Broadcast fails for one connection | Log, skip, continue |
| `GoneException` during broadcast | Delete stale connection from DynamoDB |

## SAM Local Test Plan

### Test 1: Successful disconnection

**Command:**

```bash
sam local invoke DisconnectFunction -e events/disconnect_valid.json
```

**Event file (`events/disconnect_valid.json`):**

```json
{
  "requestContext": {
    "connectionId": "test-conn-001",
    "routeKey": "$disconnect",
    "eventType": "DISCONNECT",
    "domainName": "localhost",
    "stage": "prod"
  }
}
```

**Pre-condition:** Insert a test record into DynamoDB Local:

```bash
aws dynamodb put-item \
  --table-name ChatConnections \
  --item '{"connectionId":{"S":"test-conn-001"},"callsign":{"S":"TestUser"},"connectedAt":{"S":"2025-01-01T00:00:00Z"}}' \
  --endpoint-url http://localhost:8000
```

**Expected result:** Status 200, item deleted from DynamoDB.

**Verify:**

```bash
aws dynamodb get-item \
  --table-name ChatConnections \
  --key '{"connectionId":{"S":"test-conn-001"}}' \
  --endpoint-url http://localhost:8000
# Expected: empty response (item gone)
```

### Test 2: Disconnect for non-existent connection

**Event file (`events/disconnect_unknown.json`):**

```json
{
  "requestContext": {
    "connectionId": "non-existent-conn",
    "routeKey": "$disconnect",
    "eventType": "DISCONNECT",
    "domainName": "localhost",
    "stage": "prod"
  }
}
```

**Expected result:** Status 200 (graceful handling, no crash). DynamoDB delete is a no-op.

### DynamoDB Local Setup

Same as described in `04-lambda-connect-spec.md`. Reuse the same local DynamoDB instance and table.
