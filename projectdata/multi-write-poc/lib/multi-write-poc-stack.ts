import { Duration, RemovalPolicy, Stack, StackProps, Token, aws_events as events } from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as appsync from '@aws-cdk/aws-appsync-alpha';
import * as path from 'path';
import * as eventbridge from 'aws-cdk-lib/aws-events';
import * as targets from 'aws-cdk-lib/aws-events-targets';
import * as sqs from 'aws-cdk-lib/aws-sqs';
import { MappingTemplate } from '@aws-cdk/aws-appsync-alpha';
// import * as sqs from 'aws-cdk-lib/aws-sqs';

/**
 * Helpers to compute resource files into cdk objects.
 */
const getResourcePath = (resourceType: string, resourceName: string) => path.join(__dirname, '..', '..', 'resources', resourceType, resourceName);
const getMappingTemplate = (fileName: string): appsync.MappingTemplate => appsync.MappingTemplate.fromFile(getResourcePath('resolver', fileName));
const getSchema = (fileName: string): appsync.Schema => appsync.Schema.fromAsset(getResourcePath('schema', fileName));
const getLambdaCode = (lambdaName: string): any => lambda.Code.fromAsset(getResourcePath('lambda', `${lambdaName}.lambda.zip`));

export class MultiWritePocStack extends Stack {
  constructor(scope: Construct, id: string, props?: StackProps) {
    super(scope, id, props);

    // Create AppSync API
    const api = new appsync.GraphqlApi(this, 'MoviesApi', {
      name: 'movies',
      schema: getSchema('schema.graphql'),
      authorizationConfig: {
        defaultAuthorization: { authorizationType: appsync.AuthorizationType.API_KEY },
      },
      xrayEnabled: true,
    });

    // Create DDB Table for storing Movies
    const todoTable = new dynamodb.Table(this, 'TodoTable', {
      partitionKey: { name: 'id', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'Name', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: RemovalPolicy.DESTROY,
    });

    const logBus = new events.EventBus(this, 'LogBus', {
      eventBusName: 'AmplifyEventSourceBus'
    });
    const writeBus = new events.EventBus(this, 'WriteBus', {
      eventBusName: 'AmplifySecondaryWriteBus'
    });

    const moviesDataSource = api.addDynamoDbDataSource('MoviesDataSource', todoTable);
    const logEventDataSource = api.addHttpDataSource('EventBridgeUSWest2', "https://events.us-west-2.amazonaws.com", {
      name: 'EventLog',
      authorizationConfig: {
        signingRegion: 'us-west-2',
        signingServiceName: 'events',
      },
    });
  }
}
