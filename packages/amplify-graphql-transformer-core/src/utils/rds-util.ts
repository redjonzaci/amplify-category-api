import path from 'path';
import _ from 'lodash';
import { TransformerContextProvider } from '@aws-amplify/graphql-transformer-interfaces';
import { DDB_DB_TYPE, MYSQL_DB_TYPE, ModelDatasourceType } from '../types';
import { APICategory } from '.';

const getParameterNameForDBSecret = (secret: string, secretsKey: string): string => {
  return `${secretsKey}_${secret}`;
};

/* This adheres to the following convention:
  /amplify/<appId>/<envName>/AMPLIFY_${categoryName}${resourceName}${paramName}
  where paramName is secretsKey_<secretName>
*/
export const getParameterStoreSecretPath = (
  secret: string,
  secretsKey: string,
  apiName: string,
  environmentName: string,
  appId: string,
): string => {
  if (_.isEmpty(appId)) {
    throw new Error('Unable to read the App ID');
  }
  const categoryName = APICategory;
  const paramName = getParameterNameForDBSecret(secret, secretsKey);

  if (!environmentName) {
    throw new Error('Unable to create RDS secret path, environment not found/defined');
  }
  return path.posix.join('/amplify', appId, environmentName, `AMPLIFY_${categoryName}${apiName}${paramName}`);
};

/**
 * Get the datasource type of the model.
 * @param ctx Transformer Context
 * @param typename Model name
 * @returns datasource type
 */
export const getModelDatasourceType = (ctx: TransformerContextProvider, typename: string): ModelDatasourceType => {
  const config = ctx.modelToDatasourceMap.get(typename);
  return config?.dbType || DDB_DB_TYPE;
};

/**
 * Checks if the given model is a DynamoDB model
 * @param ctx Transformer Context
 * @param typename Model name
 * @returns boolean
 */
export const isDynamoDBModel = (ctx: TransformerContextProvider, typename: string): boolean => {
  return getModelDatasourceType(ctx, typename) === DDB_DB_TYPE;
};

/**
 * Checks if the given model is a RDS model
 * @param ctx Transformer Context
 * @param typename Model name
 * @returns boolean
 */
export const isRDSModel = (ctx: TransformerContextProvider, typename: string): boolean => {
  return getModelDatasourceType(ctx, typename) === MYSQL_DB_TYPE;
};