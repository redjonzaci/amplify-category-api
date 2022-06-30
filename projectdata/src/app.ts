#!/usr/bin/env node
/* eslint-disable no-new */
import 'source-map-support/register';
import * as cdk from 'aws-cdk-lib';
import { AggregateStack, EventBridgeStack, RDSAdapterStack } from './stacks';
import { zipLambdas } from './utils/zip-lambda';

const DATA_STREAM_NAMESPACE = 'DataStream';

const generateApp = async (): Promise<void> => {
  await zipLambdas();

  const app = new cdk.App();

  new AggregateStack(app, `${DATA_STREAM_NAMESPACE}Aggregates`);
  new EventBridgeStack(app, `${DATA_STREAM_NAMESPACE}EventBridge`);
  new RDSAdapterStack(app, `${DATA_STREAM_NAMESPACE}RDSAdapter`);
};

generateApp();
