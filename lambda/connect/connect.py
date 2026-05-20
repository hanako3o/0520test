import json
import logging
import os
import re
from datetime import datetime, timezone

import boto3

logger = logging.getLogger()
logger.setLevel(logging.INFO)

TABLE_NAME = os.environ["TABLE_NAME"]
CALLSIGN_RE = re.compile(r"^[a-zA-Z0-9_]{1,20}$")

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

    qs = event.get("queryStringParameters") or {}
    callsign = qs.get("callsign", "").strip()

    if not callsign or not CALLSIGN_RE.match(callsign):
        return {"statusCode": 400, "body": "Invalid or missing callsign"}

    connected_at = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")

    try:
        table.put_item(Item={
            "connectionId": connection_id,
            "callsign": callsign,
            "connectedAt": connected_at,
        })
    except Exception:
        logger.exception("DynamoDB put_item failed for %s", connection_id)
        return {"statusCode": 500, "body": "Internal server error"}

    logger.info("Connected: %s (%s)", connection_id, callsign)

    _broadcast(domain, stage, {
        "type": "system",
        "event": "user_joined",
        "callsign": callsign,
        "timestamp": connected_at,
    }, exclude=connection_id)

    return {"statusCode": 200, "body": "Connected"}


def _broadcast(domain, stage, payload, exclude=None):
    """Fan-out payload to all connections, cleaning up stale ones."""
    if not domain or not stage:
        return

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
        logger.exception("DynamoDB scan failed during broadcast")
        return

    endpoint = f"https://{domain}/{stage}"
    apigw = boto3.client("apigatewaymanagementapi", endpoint_url=endpoint)
    data = json.dumps(payload).encode("utf-8")

    for conn in connections:
        cid = conn["connectionId"]
        if cid == exclude:
            continue
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
