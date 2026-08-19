---
"effect-lambda": patch
---

Rename internal Context tag identifier strings to the deterministic format `effect-lambda/<file>/<ClassName>` (enforced by the Effect language service `deterministicKeys` rule). Affected tags:

- `APIGatewayAuthorizerEvent` → `effect-lambda/CustomAuthorizer/APIGatewayAuthorizerEvent`
- `DynamoDBStreamEvent` → `effect-lambda/DynamoDb/DynamoDBStreamEvent`
- `DynamoDBRecord` → `effect-lambda/DynamoDb/DynamoDBRecord`
- `APIGatewayProxyEventV2` → `effect-lambda/HttpApi/APIGatewayProxyEventV2`
- `APIGatewayProxyEvent` → `effect-lambda/RestApi/APIGatewayProxyEvent`
- `SNSEvent` → `effect-lambda/Sns/SNSEvent`
- `SQSEvent` → `effect-lambda/Sqs/SQSEvent`
- `SQSRecord` → `effect-lambda/Sqs/SQSRecord`
- `HandlerContext` → `effect-lambda/common/HandlerContext`

The exported class symbols are unchanged — consumers importing the tags (e.g. `import { SQSEvent } from 'effect-lambda/Sqs'`) are unaffected. Only code that constructed tags by the raw identifier string, or cross-module code that compared stringified tag ids, will need to update.
