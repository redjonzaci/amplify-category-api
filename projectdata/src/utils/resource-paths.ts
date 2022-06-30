import * as path from 'path';
import { MappingTemplate, Schema } from '@aws-cdk/aws-appsync-alpha';
import { Code } from 'aws-cdk-lib/aws-lambda';

/**
 * Helpers to compute resource files into cdk objects.
 */
export const getResourcePath = (...pathSegments: string[]): string => path.join(__dirname, '..', '..', 'resources', ...pathSegments);

/**
 * Retrieve an appsync mapping template from the `resources/resolver` directory.
 */
export const getMappingTemplate = (fileName: string): MappingTemplate => MappingTemplate.fromFile(getResourcePath('resolver', fileName));

/**
 * Retrieve an appsync mapping template from the `resources/schema` directory.
 */
export const getSchema = (fileName: string): Schema => Schema.fromAsset(getResourcePath('schema', fileName));

/**
 * Retrieve a zipped lambda from the `resources/lambda` directory.
 */
export const getLambdaCode = (lambdaName: string): Code => Code.fromAsset(getResourcePath('lambda', `${lambdaName}.lambda.zip`));
