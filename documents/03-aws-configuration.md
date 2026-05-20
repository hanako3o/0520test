# AWS Configuration Guide

## Overview

This document covers all AWS resource provisioning for the Anonymous WebSocket Chat project. Procedures are split into two categories:

- **Claude Code can do:** Automated via CLI/SAM — Claude Code can execute these directly.
- **Human intervention required:** Manual steps in AWS Console or requiring credentials/permissions that Claude Code should not handle.

## Prerequisites

### Human Must Verify

- [ ] AWS CLI v2 is installed and configured (`aws configure`)
- [ ] SAM CLI is installed (`sam --version`)
- [ ] Python 3.12 is installed
- [ ] AWS account has permissions for: API Gateway, Lambda, DynamoDB, IAM, CloudFormation
- [ ] An AWS region is chosen (recommended: `us-west-2`)

### Claude Code Can Verify

```bash
# Verify tooling is installed
aws --version
sam --version
python3 --version

# Verify AWS credentials are configured
aws sts get-caller-identity
```

## SAM Template (`template.yaml`)

> Claude Code: Create this file at the project root.

```yaml
AWSTemplateFormatVersion: '2010-09-09'
Transform: AWS::Serverless-2016-10-31
Description: Anonymous WebSocket Chat - Serverless Backend

Globals:
  Function:
    Runtime: python3.12
    Timeout: 10
    MemorySize: 128
    Environment:
      Variables:
        TABLE_NAME: !Ref ConnectionsTable

Resources:

  # --- WebSocket API ---
  ChatWebSocketApi:
    Type: AWS::ApiGatewayV2::Api
    Properties:
      Name: AnonymousChatWebSocketApi
      ProtocolType: WEBSOCKET
      RouteSelectionExpression: "$request.body.action"

  # --- Routes ---
  ConnectRoute:
    Type: AWS::ApiGatewayV2::Route
    Properties:
      ApiId: !Ref ChatWebSocketApi
      RouteKey: "$connect"
      AuthorizationType: NONE
      Target: !Sub "integrations/${ConnectIntegration}"

  DisconnectRoute:
    Type: AWS::ApiGatewayV2::Route
    Properties:
      ApiId: !Ref ChatWebSocketApi
      RouteKey: "$disconnect"
      AuthorizationType: NONE
      Target: !Sub "integrations/${DisconnectIntegration}"

  SendMessageRoute:
    Type: AWS::ApiGatewayV2::Route
    Properties:
      ApiId: !Ref ChatWebSocketApi
      RouteKey: "sendMessage"
      AuthorizationType: NONE
      Target: !Sub "integrations/${SendMessageIntegration}"

  # --- Integrations ---
  ConnectIntegration:
    Type: AWS::ApiGatewayV2::Integration
    Properties:
      ApiId: !Ref ChatWebSocketApi
      IntegrationType: AWS_PROXY
      IntegrationUri: !Sub "arn:aws:apigateway:${AWS::Region}:lambda:path/2015-03-31/functions/${ConnectFunction.Arn}/invocations"

  DisconnectIntegration:
    Type: AWS::ApiGatewayV2::Integration
    Properties:
      ApiId: !Ref ChatWebSocketApi
      IntegrationType: AWS_PROXY
      IntegrationUri: !Sub "arn:aws:apigateway:${AWS::Region}:lambda:path/2015-03-31/functions/${DisconnectFunction.Arn}/invocations"

  SendMessageIntegration:
    Type: AWS::ApiGatewayV2::Integration
    Properties:
      ApiId: !Ref ChatWebSocketApi
      IntegrationType: AWS_PROXY
      IntegrationUri: !Sub "arn:aws:apigateway:${AWS::Region}:lambda:path/2015-03-31/functions/${SendMessageFunction.Arn}/invocations"

  # --- Stage ---
  ProdStage:
    Type: AWS::ApiGatewayV2::Stage
    Properties:
      ApiId: !Ref ChatWebSocketApi
      StageName: prod
      AutoDeploy: true

  # --- Lambda Functions ---
  ConnectFunction:
    Type: AWS::Serverless::Function
    Properties:
      FunctionName: chat-connect
      Handler: connect.handler
      CodeUri: lambda/connect/
      Policies:
        - DynamoDBCrudPolicy:
            TableName: !Ref ConnectionsTable

  DisconnectFunction:
    Type: AWS::Serverless::Function
    Properties:
      FunctionName: chat-disconnect
      Handler: disconnect.handler
      CodeUri: lambda/disconnect/
      Policies:
        - DynamoDBCrudPolicy:
            TableName: !Ref ConnectionsTable

  SendMessageFunction:
    Type: AWS::Serverless::Function
    Properties:
      FunctionName: chat-send-message
      Handler: send_message.handler
      CodeUri: lambda/send_message/
      Policies:
        - DynamoDBCrudPolicy:
            TableName: !Ref ConnectionsTable
        - Statement:
            - Effect: Allow
              Action:
                - "execute-api:ManageConnections"
              Resource: !Sub "arn:aws:execute-api:${AWS::Region}:${AWS::AccountId}:${ChatWebSocketApi}/*"

  # --- Lambda Permissions (allow API Gateway to invoke) ---
  ConnectPermission:
    Type: AWS::Lambda::Permission
    Properties:
      Action: lambda:InvokeFunction
      FunctionName: !Ref ConnectFunction
      Principal: apigateway.amazonaws.com
      SourceArn: !Sub "arn:aws:execute-api:${AWS::Region}:${AWS::AccountId}:${ChatWebSocketApi}/*/$connect"

  DisconnectPermission:
    Type: AWS::Lambda::Permission
    Properties:
      Action: lambda:InvokeFunction
      FunctionName: !Ref DisconnectFunction
      Principal: apigateway.amazonaws.com
      SourceArn: !Sub "arn:aws:execute-api:${AWS::Region}:${AWS::AccountId}:${ChatWebSocketApi}/*/$disconnect"

  SendMessagePermission:
    Type: AWS::Lambda::Permission
    Properties:
      Action: lambda:InvokeFunction
      FunctionName: !Ref SendMessageFunction
      Principal: apigateway.amazonaws.com
      SourceArn: !Sub "arn:aws:execute-api:${AWS::Region}:${AWS::AccountId}:${ChatWebSocketApi}/*/sendMessage"

  # --- DynamoDB ---
  ConnectionsTable:
    Type: AWS::DynamoDB::Table
    Properties:
      TableName: ChatConnections
      AttributeDefinitions:
        - AttributeName: connectionId
          AttributeType: S
      KeySchema:
        - AttributeName: connectionId
          KeyType: HASH
      BillingMode: PAY_PER_REQUEST

Outputs:
  WebSocketUrl:
    Description: "WebSocket API endpoint"
    Value: !Sub "wss://${ChatWebSocketApi}.execute-api.${AWS::Region}.amazonaws.com/prod"
  ConnectionsTableName:
    Description: "DynamoDB table name"
    Value: !Ref ConnectionsTable
```

## Deployment Procedures

### Claude Code Can Do

#### 1. Validate the SAM template

```bash
sam validate --template template.yaml
```

#### 2. Build the project

```bash
sam build
```

#### 3. Deploy (after initial guided deploy)

```bash
sam deploy --no-confirm-changeset
```

#### 4. Get the WebSocket endpoint after deployment

```bash
aws cloudformation describe-stacks \
  --stack-name anonymous-chat \
  --query "Stacks[0].Outputs[?OutputKey=='WebSocketUrl'].OutputValue" \
  --output text
```

#### 5. Test WebSocket connectivity (requires `wscat`)

```bash
npm install -g wscat
wscat -c "wss://{api-id}.execute-api.{region}.amazonaws.com/prod?callsign=TestUser"
```

#### 6. View Lambda logs

```bash
sam logs -n ConnectFunction --stack-name anonymous-chat --tail
sam logs -n SendMessageFunction --stack-name anonymous-chat --tail
```

#### 7. Check DynamoDB connections table

```bash
aws dynamodb scan --table-name ChatConnections
```

#### 8. Delete the stack (teardown)

```bash
sam delete --stack-name anonymous-chat --no-prompts
```

### Human Intervention Required

#### 1. Initial guided deployment (first time only)

The first `sam deploy` must be interactive to set stack parameters:

```bash
sam deploy --guided
```

Human must answer the prompts:

| Prompt | Recommended Value |
|--------|------------------|
| Stack Name | `anonymous-chat` |
| AWS Region | `us-west-2` (or preferred region) |
| Confirm changes before deploy | `N` |
| Allow SAM CLI IAM role creation | `Y` |
| Disable rollback | `N` |
| Save arguments to samconfig.toml | `Y` |

**Why Claude Code cannot do this:** The `--guided` flag requires interactive terminal input. After the first guided deploy, `samconfig.toml` is generated and subsequent deploys can use `sam deploy` without interaction.

#### 2. AWS credentials setup

If AWS CLI is not yet configured:

```bash
aws configure
```

Human must provide:
- AWS Access Key ID
- AWS Secret Access Key
- Default region
- Output format

**Why Claude Code cannot do this:** Credentials are sensitive. Claude Code should never handle AWS access keys.

#### 3. GitHub Pages configuration

After the frontend is built and pushed to the repository:

1. Go to GitHub repo → Settings → Pages
2. Set source branch (e.g., `gh-pages` or `main` with `/docs` folder)
3. Save

**Why Claude Code cannot do this:** Requires GitHub web UI interaction with authenticated session.

#### 4. Custom domain (optional)

If a custom domain is desired for the WebSocket API:

1. Register/configure domain in Route 53 or external DNS
2. Create ACM certificate in the same region as API Gateway
3. Configure custom domain in API Gateway console

**Why Claude Code cannot do this:** Certificate validation requires DNS record creation and domain ownership verification.

## Environment Variables

| Variable | Set By | Value |
|----------|--------|-------|
| `TABLE_NAME` | SAM template (auto) | DynamoDB table name via `!Ref` |

No manual environment variable configuration is needed — SAM injects `TABLE_NAME` into all Lambda functions automatically.

## IAM Permissions Summary

SAM creates the IAM roles automatically. Here is what each Lambda gets:

| Function | Permissions |
|----------|------------|
| `connect` | DynamoDB CRUD on `ChatConnections` table |
| `disconnect` | DynamoDB CRUD on `ChatConnections` table |
| `send_message` | DynamoDB CRUD on `ChatConnections` table + `execute-api:ManageConnections` on the WebSocket API |

## Post-Deployment Verification Checklist

Claude Code can run these checks after deployment:

```bash
# 1. Stack deployed successfully?
aws cloudformation describe-stacks --stack-name anonymous-chat \
  --query "Stacks[0].StackStatus" --output text
# Expected: CREATE_COMPLETE or UPDATE_COMPLETE

# 2. WebSocket API exists?
aws apigatewayv2 get-apis \
  --query "Items[?Name=='AnonymousChatWebSocketApi'].ApiId" --output text

# 3. DynamoDB table exists?
aws dynamodb describe-table --table-name ChatConnections \
  --query "Table.TableStatus" --output text
# Expected: ACTIVE

# 4. Lambda functions exist?
aws lambda get-function --function-name chat-connect --query "Configuration.FunctionName"
aws lambda get-function --function-name chat-disconnect --query "Configuration.FunctionName"
aws lambda get-function --function-name chat-send-message --query "Configuration.FunctionName"
```
