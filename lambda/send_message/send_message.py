import json
import logging
import os
from datetime import datetime, timezone

import boto3

logger = logging.getLogger()
logger.setLevel(logging.INFO)

TABLE_NAME = os.environ["TABLE_NAME"]

_dynamodb_kwargs = {}
if os.environ.get("DYNAMODB_ENDPOINT"):
    _dynamodb_kwargs["endpoint_url"] = os.environ["DYNAMODB_ENDPOINT"]

dynamodb = boto3.resource("dynamodb", **_dynamodb_kwargs)
table = dynamodb.Table(TABLE_NAME)


def handler(event, context):
    rc = event.get("requestContext", {})
    connection_id = rc.get("connectionId")
    domain = rc.get("domainName")
    stage = rc.get("stage")

    # Parse and validate body
    try:
        body = json.loads(event.get("body") or "")
    except (json.JSONDecodeError, TypeError):
        return {"statusCode": 400, "body": "Invalid JSON body"}

    text = body.get("text")
    if not text or not isinstance(text, str) or not text.strip():
        return {"statusCode": 400, "body": "Missing or invalid text"}
    if len(text) > 1000:
        return {"statusCode": 400, "body": "Text exceeds 1000 character limit"}

    # Lookup sender's callsign from DynamoDB (prevents callsign spoofing)
    try:
        resp = table.get_item(Key={"connectionId": connection_id})
        sender = resp.get("Item")
    except Exception:
        logger.exception("get_item failed for sender %s", connection_id)
        return {"statusCode": 500, "body": "Internal server error"}

    if not sender:
        return {"statusCode": 400, "body": "Unknown sender"}

    callsign = sender["callsign"]
    timestamp = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")

    payload = {
        "type": "message",
        "callsign": callsign,
        "text": text,
        "timestamp": timestamp,
    }

    # Collect all active connections (paginated scan)
    try:
        connections = []
        scan_kwargs = {"ProjectionExpression": "connectionId"}
        while True:
            resp = table.scan(**scan_kwargs)
            connections.extend(resp["Items"])
            if "LastEvaluatedKey" not in resp:
                break
            scan_kwargs["ExclusiveStartKey"] = resp["LastEvaluatedKey"]
    except Exception:
        logger.exception("DynamoDB scan failed")
        return {"statusCode": 500, "body": "Internal server error"}

    # Fan-out to all connections (sender receives their own message too)
    endpoint = f"https://{domain}/{stage}"
    apigw = boto3.client("apigatewaymanagementapi", endpoint_url=endpoint)
    data = json.dumps(payload).encode("utf-8")

    for conn in connections:
        cid = conn["connectionId"]
        try:
            apigw.post_to_connection(ConnectionId=cid, Data=data)
        except apigw.exceptions.GoneException:
            logger.info("Cleaning up stale connection %s", cid)
            try:
                table.delete_item(Key={"connectionId": cid})
            except Exception:
                pass
        except Exception:
            logger.warning("Failed to post to connection %s", cid)

    logger.info("Broadcast from %s (%s): %d chars to %d connections",
                connection_id, callsign, len(text), len(connections))

    return {"statusCode": 200, "body": "Message sent"}
