import {
  addApiWithoutSchema,
  amplifyPush,
  createNewProjectDir,
  deleteDBInstance,
  deleteProject,
  deleteProjectDir,
  getAppSyncApi,
  getProjectMeta,
  importRDSDatabase,
  initJSProjectWithProfile,
  getResource,
  sleep,
  setupRDSInstanceAndData,
} from 'amplify-category-api-e2e-core';
import { existsSync, readFileSync } from 'fs-extra';
import generator from 'generate-password';
import { ObjectTypeDefinitionNode, parse } from 'graphql';
import path from 'path';
import AWSAppSyncClient, { AUTH_TYPE } from 'aws-appsync';
import gql from 'graphql-tag';

// to deal with bug in cognito-identity-js
(global as any).fetch = require('node-fetch');

const CDK_FUNCTION_TYPE = 'AWS::Lambda::Function';
const CDK_VPC_ENDPOINT_TYPE = 'AWS::EC2::VPCEndpoint';

describe('RDS Model Directive', () => {
  const [db_user, db_password, db_identifier] = generator.generateMultiple(3);

  // Generate settings for RDS instance
  const username = db_user;
  const password = db_password;
  let region = 'us-east-1';
  let port = 3306;
  const database = 'default_db';
  let host = 'localhost';
  const identifier = `integtest${db_identifier}`;
  const projName = 'rdsmodelapitest';

  let projRoot;
  let appSyncClient;

  beforeAll(async () => {
    projRoot = await createNewProjectDir('rdsmodelapi');
    await initProjectAndImportSchema();
    await amplifyPush(projRoot);
    await sleep(2 * 60 * 1000); // Wait for 2 minutes for the VPC endpoints to be live.

    await verifyApiEndpointAndCreateClient();
    verifySQLLambdaIsInVpc();
  });

  const verifyApiEndpointAndCreateClient = async (): Promise<void> => {
    const meta = getProjectMeta(projRoot);
    const appRegion = meta.providers.awscloudformation.Region;
    const { output } = meta.api.rdsapi;
    const { GraphQLAPIIdOutput, GraphQLAPIEndpointOutput, GraphQLAPIKeyOutput } = output;
    const { graphqlApi } = await getAppSyncApi(GraphQLAPIIdOutput, appRegion);

    expect(GraphQLAPIIdOutput).toBeDefined();
    expect(GraphQLAPIEndpointOutput).toBeDefined();
    expect(GraphQLAPIKeyOutput).toBeDefined();

    expect(graphqlApi).toBeDefined();
    expect(graphqlApi.apiId).toEqual(GraphQLAPIIdOutput);

    const apiEndPoint = GraphQLAPIEndpointOutput as string;
    const apiKey = GraphQLAPIKeyOutput as string;

    appSyncClient = new AWSAppSyncClient({
      url: apiEndPoint,
      region,
      disableOffline: true,
      auth: {
        type: AUTH_TYPE.API_KEY,
        apiKey,
      },
    });
  };

  const verifySQLLambdaIsInVpc = (): void => {
    // Validate the generated resources in the CloudFormation template
    const apisDirectory = path.join(projRoot, 'amplify', 'backend', 'api');
    const apiDirectory = path.join(apisDirectory, 'rdsapi');
    const cfnRDSTemplateFile = path.join(apiDirectory, 'build', 'stacks', 'RdsApiStack.json');
    const cfnTemplate = JSON.parse(readFileSync(cfnRDSTemplateFile, 'utf8'));
    expect(cfnTemplate.Resources).toBeDefined();
    const resources = cfnTemplate.Resources;

    // Validate if the SQL lambda function has VPC configuration even if the database is accessible through internet
    const rdsLambdaFunction = getResource(resources, 'RDSLambdaLogicalID', CDK_FUNCTION_TYPE);
    expect(rdsLambdaFunction).toBeDefined();
    expect(rdsLambdaFunction.Properties).toBeDefined();
    expect(rdsLambdaFunction.Properties.VpcConfig).toBeDefined();
    expect(rdsLambdaFunction.Properties.VpcConfig.SubnetIds).toBeDefined();
    expect(rdsLambdaFunction.Properties.VpcConfig.SubnetIds.length).toBeGreaterThan(0);
    expect(rdsLambdaFunction.Properties.VpcConfig.SecurityGroupIds).toBeDefined();
    expect(rdsLambdaFunction.Properties.VpcConfig.SecurityGroupIds.length).toBeGreaterThan(0);

    expect(getResource(resources, 'RDSVpcEndpointssm', CDK_VPC_ENDPOINT_TYPE)).toBeDefined();
    expect(getResource(resources, 'RDSVpcEndpointssmmessages', CDK_VPC_ENDPOINT_TYPE)).toBeDefined();
    expect(getResource(resources, 'RDSVpcEndpointkms', CDK_VPC_ENDPOINT_TYPE)).toBeDefined();
    expect(getResource(resources, 'RDSVpcEndpointec2', CDK_VPC_ENDPOINT_TYPE)).toBeDefined();
    expect(getResource(resources, 'RDSVpcEndpointec2messages', CDK_VPC_ENDPOINT_TYPE)).toBeDefined();
  };

  afterAll(async () => {
    const metaFilePath = path.join(projRoot, 'amplify', '#current-cloud-backend', 'amplify-meta.json');
    if (existsSync(metaFilePath)) {
      await deleteProject(projRoot);
    }
    deleteProjectDir(projRoot);
    await cleanupDatabase();
  });

  const setupDatabase = async (): Promise<void> => {
    const dbConfig = {
      identifier,
      engine: 'mysql' as const,
      dbname: database,
      username,
      password,
      region,
    };
    const queries = [
      'CREATE TABLE Contact (id VARCHAR(40) PRIMARY KEY, firstName VARCHAR(20), lastName VARCHAR(50))',
      'CREATE TABLE Person (personId INT PRIMARY KEY, firstName VARCHAR(20), lastName VARCHAR(50))',
      'CREATE TABLE Employee (id INT PRIMARY KEY, firstName VARCHAR(20), lastName VARCHAR(50))',
      'CREATE TABLE Student (studentId INT NOT NULL, classId CHAR(1) NOT NULL, firstName VARCHAR(20), lastName VARCHAR(50), PRIMARY KEY (studentId, classId))',
    ];

    const db = await setupRDSInstanceAndData(dbConfig, queries);
    port = db.port;
    host = db.endpoint;
  };

  const cleanupDatabase = async (): Promise<void> => {
    await deleteDBInstance(identifier, region);
  };

  const initProjectAndImportSchema = async (): Promise<void> => {
    const apiName = 'rdsapi';
    await initJSProjectWithProfile(projRoot, {
      disableAmplifyAppCreation: false,
      name: projName,
    });

    const metaAfterInit = getProjectMeta(projRoot);
    region = metaAfterInit.providers.awscloudformation.Region;
    await setupDatabase();

    const rdsSchemaFilePath = path.join(projRoot, 'amplify', 'backend', 'api', apiName, 'schema.rds.graphql');

    await addApiWithoutSchema(projRoot, { transformerVersion: 2, apiName });

    await importRDSDatabase(projRoot, {
      database,
      host,
      port,
      username,
      password,
      useVpc: true,
      apiExists: true,
    });

    const schemaContent = readFileSync(rdsSchemaFilePath, 'utf8');
    const schema = parse(schemaContent);

    // Generated schema should contains the types and fields from the database
    const contactObjectType = schema.definitions.find(
      (d) => d.kind === 'ObjectTypeDefinition' && d.name.value === 'Contact',
    ) as ObjectTypeDefinitionNode;
    const personObjectType = schema.definitions.find((d) => d.kind === 'ObjectTypeDefinition' && d.name.value === 'Person');
    const employeeObjectType = schema.definitions.find((d) => d.kind === 'ObjectTypeDefinition' && d.name.value === 'Employee');

    expect(contactObjectType).toBeDefined();
    expect(personObjectType).toBeDefined();
    expect(employeeObjectType).toBeDefined();

    // Verify the fields in the generated schema on type 'Contacts'
    const contactsIdFieldType = contactObjectType.fields.find((f) => f.name.value === 'id');
    const contactsFirstNameFieldType = contactObjectType.fields.find((f) => f.name.value === 'firstName');
    const contactsLastNameFieldType = contactObjectType.fields.find((f) => f.name.value === 'lastName');

    expect(contactsIdFieldType).toBeDefined();
    expect(contactsFirstNameFieldType).toBeDefined();
    expect(contactsLastNameFieldType).toBeDefined();

    // PrimaryKey directive must be defined on Id field.
    expect(contactsIdFieldType.directives.find((d) => d.name.value === 'primaryKey')).toBeDefined();
  };

  test('check CRUDL on contact table with default primary key', async () => {
    const contact1 = await createContact('David', 'Smith');
    const contact2 = await createContact('Chris', 'Sundersingh');

    expect(contact1.data.createContact.id).toBeDefined();
    expect(contact1.data.createContact.firstName).toEqual('David');
    expect(contact1.data.createContact.lastName).toEqual('Smith');

    expect(contact2.data.createContact.id).toBeDefined();
    expect(contact2.data.createContact.firstName).toEqual('Chris');
    expect(contact2.data.createContact.lastName).toEqual('Sundersingh');

    const getContact1 = await getContact(contact1.data.createContact.id);
    expect(getContact1.data.getContact.id).toEqual(contact1.data.createContact.id);
    expect(getContact1.data.getContact.firstName).toEqual('David');
    expect(getContact1.data.getContact.lastName).toEqual('Smith');

    const contact1Updated = await updateContact(contact1.data.createContact.id, 'David', 'Jones');
    expect(contact1Updated.data.updateContact.id).toEqual(contact1.data.createContact.id);
    expect(contact1Updated.data.updateContact.firstName).toEqual('David');
    expect(contact1Updated.data.updateContact.lastName).toEqual('Jones');

    const getContact1Updated = await getContact(contact1.data.createContact.id);
    expect(getContact1Updated.data.getContact.id).toEqual(contact1.data.createContact.id);
    expect(getContact1Updated.data.getContact.firstName).toEqual('David');
    expect(getContact1Updated.data.getContact.lastName).toEqual('Jones');

    const listContactsResult = await listContacts();
    expect(listContactsResult.data.listContacts.items.length).toEqual(2);
    expect(listContactsResult.data.listContacts.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: contact1.data.createContact.id, firstName: 'David', lastName: 'Jones' }),
        expect.objectContaining({ id: contact2.data.createContact.id, firstName: 'Chris', lastName: 'Sundersingh' }),
      ]),
    );

    const deleteContact1 = await deleteContact(contact1.data.createContact.id);
    expect(deleteContact1.data.deleteContact.id).toEqual(contact1.data.createContact.id);
    expect(deleteContact1.data.deleteContact.firstName).toEqual('David');
    expect(deleteContact1.data.deleteContact.lastName).toEqual('Jones');

    const listContactsResultAfterDelete = await listContacts();
    expect(listContactsResultAfterDelete.data.listContacts.items.length).toEqual(1);
    expect(listContactsResultAfterDelete.data.listContacts.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: contact2.data.createContact.id, firstName: 'Chris', lastName: 'Sundersingh' }),
      ]),
    );
  });

  test('check CRUDL, filter, limit and nextToken on student table with composite key', async () => {
    const student1A = await createStudent(1, 'A', 'David', 'Smith');
    const student1B = await createStudent(1, 'B', 'Chris', 'Sundersingh');
    const student2A = await createStudent(2, 'A', 'John', 'Doe');
    const student2B = await createStudent(2, 'B', 'Jane', 'Doe');

    expect(student1A.data.createStudent.studentId).toEqual(1);
    expect(student1A.data.createStudent.classId).toEqual('A');
    expect(student1A.data.createStudent.firstName).toEqual('David');
    expect(student1A.data.createStudent.lastName).toEqual('Smith');

    expect(student1B.data.createStudent.studentId).toEqual(1);
    expect(student1B.data.createStudent.classId).toEqual('B');
    expect(student1B.data.createStudent.firstName).toEqual('Chris');
    expect(student1B.data.createStudent.lastName).toEqual('Sundersingh');

    expect(student2A.data.createStudent.studentId).toEqual(2);
    expect(student2A.data.createStudent.classId).toEqual('A');
    expect(student2A.data.createStudent.firstName).toEqual('John');
    expect(student2A.data.createStudent.lastName).toEqual('Doe');

    expect(student2B.data.createStudent.studentId).toEqual(2);
    expect(student2B.data.createStudent.classId).toEqual('B');
    expect(student2B.data.createStudent.firstName).toEqual('Jane');
    expect(student2B.data.createStudent.lastName).toEqual('Doe');

    const student1AUpdated = await updateStudent(1, 'A', 'David', 'Jones');
    const student2AUpdated = await updateStudent(2, 'A', 'John', 'Smith');

    expect(student1AUpdated.data.updateStudent.studentId).toEqual(1);
    expect(student1AUpdated.data.updateStudent.classId).toEqual('A');
    expect(student1AUpdated.data.updateStudent.firstName).toEqual('David');
    expect(student1AUpdated.data.updateStudent.lastName).toEqual('Jones');

    expect(student2AUpdated.data.updateStudent.studentId).toEqual(2);
    expect(student2AUpdated.data.updateStudent.classId).toEqual('A');
    expect(student2AUpdated.data.updateStudent.firstName).toEqual('John');
    expect(student2AUpdated.data.updateStudent.lastName).toEqual('Smith');

    const student1ADeleted = await deleteStudent(1, 'A');

    expect(student1ADeleted.data.deleteStudent.studentId).toEqual(1);
    expect(student1ADeleted.data.deleteStudent.classId).toEqual('A');
    expect(student1ADeleted.data.deleteStudent.firstName).toEqual('David');
    expect(student1ADeleted.data.deleteStudent.lastName).toEqual('Jones');

    const getStudent1B = await getStudent(1, 'B');

    expect(getStudent1B.data.getStudent.studentId).toEqual(1);
    expect(getStudent1B.data.getStudent.classId).toEqual('B');
    expect(getStudent1B.data.getStudent.firstName).toEqual('Chris');
    expect(getStudent1B.data.getStudent.lastName).toEqual('Sundersingh');

    const listStudentsResult = await listStudents();
    expect(listStudentsResult.data.listStudents.items.length).toEqual(3);
    expect(listStudentsResult.data.listStudents.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ studentId: 1, classId: 'B', firstName: 'Chris', lastName: 'Sundersingh' }),
        expect.objectContaining({ studentId: 2, classId: 'A', firstName: 'John', lastName: 'Smith' }),
        expect.objectContaining({ studentId: 2, classId: 'B', firstName: 'Jane', lastName: 'Doe' }),
      ]),
    );

    // Validate limit and nextToken
    const listStudentsResultWithLimit = await listStudents(2);
    expect(listStudentsResultWithLimit.data.listStudents.items.length).toEqual(2);
    expect(listStudentsResultWithLimit.data.listStudents.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ studentId: 1, classId: 'B', firstName: 'Chris', lastName: 'Sundersingh' }),
        expect.objectContaining({ studentId: 2, classId: 'A', firstName: 'John', lastName: 'Smith' }),
      ]),
    );
    expect(listStudentsResultWithLimit.data.listStudents.nextToken).toBeDefined();

    const listStudentsResultWithNextToken = await listStudents(2, listStudentsResultWithLimit.data.listStudents.nextToken);
    expect(listStudentsResultWithNextToken.data.listStudents.items.length).toEqual(1);
    expect(listStudentsResultWithNextToken.data.listStudents.items).toEqual(
      expect.arrayContaining([expect.objectContaining({ studentId: 2, classId: 'B', firstName: 'Jane', lastName: 'Doe' })]),
    );
    expect(listStudentsResultWithNextToken.data.listStudents.nextToken).toBeNull();

    // Validate filter
    const listStudentsResultWithFilter = await listStudents(10, null, {
      and: [{ firstName: { eq: 'John' } }, { lastName: { eq: 'Smith' } }],
    });
    expect(listStudentsResultWithFilter.data.listStudents.items.length).toEqual(1);
    expect(listStudentsResultWithFilter.data.listStudents.items).toEqual(
      expect.arrayContaining([expect.objectContaining({ studentId: 2, classId: 'A', firstName: 'John', lastName: 'Smith' })]),
    );
    expect(listStudentsResultWithFilter.data.listStudents.nextToken).toBeNull();

    const listStudentsResultWithFilter2 = await listStudents(10, null, { firstName: { size: { eq: 4 } } });
    expect(listStudentsResultWithFilter2.data.listStudents.items.length).toEqual(2);
    expect(listStudentsResultWithFilter2.data.listStudents.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ studentId: 2, classId: 'A', firstName: 'John', lastName: 'Smith' }),
        expect.objectContaining({ studentId: 2, classId: 'A', firstName: 'John', lastName: 'Smith' }),
      ]),
    );
  });

  test('check invalid CRUD operation returns generic error message', async () => {
    const contact1 = await createContact('David', 'Smith');
    expect(contact1.data.createContact.id).toBeDefined();

    try {
      await createContact('Jason', 'Bourne', contact1.data.createContact.id);
    } catch (err) {
      await checkGenericError(err?.message);
    }

    const nonExistentId = 'doesnotexist';
    try {
      await updateContact(nonExistentId, 'David', 'Jones');
    } catch (err) {
      await checkGenericError(err?.message);
    }

    try {
      await deleteContact(nonExistentId);
    } catch (err) {
      await checkGenericError(err?.message);
    }
  });

  // CURDL on Contact table helpers
  const createContact = async (firstName: string, lastName: string, id?: string): Promise<Record<string, any>> => {
    const createMutation = /* GraphQL */ `
      mutation CreateContact($input: CreateContactInput!, $condition: ModelContactConditionInput) {
        createContact(input: $input, condition: $condition) {
          id
          firstName
          lastName
        }
      }
    `;
    const createInput = {
      input: {
        firstName,
        lastName,
      },
    };

    if (id) {
      createInput.input['id'] = id;
    }

    const createResult: any = await appSyncClient.mutate({
      mutation: gql(createMutation),
      fetchPolicy: 'no-cache',
      variables: createInput,
    });

    return createResult;
  };

  const updateContact = async (id: string, firstName: string, lastName: string): Promise<Record<string, any>> => {
    const updateMutation = /* GraphQL */ `
      mutation UpdateContact($input: UpdateContactInput!, $condition: ModelContactConditionInput) {
        updateContact(input: $input, condition: $condition) {
          id
          firstName
          lastName
        }
      }
    `;
    const updateInput = {
      input: {
        id,
        firstName,
        lastName,
      },
    };
    const updateResult: any = await appSyncClient.mutate({
      mutation: gql(updateMutation),
      fetchPolicy: 'no-cache',
      variables: updateInput,
    });

    return updateResult;
  };

  const deleteContact = async (id: string): Promise<Record<string, any>> => {
    const deleteMutation = /* GraphQL */ `
      mutation DeleteContact($input: DeleteContactInput!, $condition: ModelContactConditionInput) {
        deleteContact(input: $input, condition: $condition) {
          id
          firstName
          lastName
        }
      }
    `;
    const deleteInput = {
      input: {
        id,
      },
    };
    const deleteResult: any = await appSyncClient.mutate({
      mutation: gql(deleteMutation),
      fetchPolicy: 'no-cache',
      variables: deleteInput,
    });

    return deleteResult;
  };

  const getContact = async (id: string): Promise<Record<string, any>> => {
    const getQuery = /* GraphQL */ `
      query GetContact($id: String!) {
        getContact(id: $id) {
          id
          firstName
          lastName
        }
      }
    `;
    const getInput = {
      id,
    };
    const getResult: any = await appSyncClient.query({
      query: gql(getQuery),
      fetchPolicy: 'no-cache',
      variables: getInput,
    });

    return getResult;
  };

  const listContacts = async (): Promise<Record<string, any>> => {
    const listQuery = /* GraphQL */ `
      query ListContact {
        listContacts {
          items {
            id
            firstName
            lastName
          }
        }
      }
    `;
    const listResult: any = await appSyncClient.query({
      query: gql(listQuery),
      fetchPolicy: 'no-cache',
    });

    return listResult;
  };

  // CURDL on Student table helpers
  const createStudent = async (studentId: number, classId: string, firstName: string, lastName: string): Promise<Record<string, any>> => {
    const createMutation = /* GraphQL */ `
      mutation CreateStuden($input: CreateStudentInput!, $condition: ModelStudentConditionInput) {
        createStudent(input: $input, condition: $condition) {
          studentId
          classId
          firstName
          lastName
        }
      }
    `;
    const createInput = {
      input: {
        studentId,
        classId,
        firstName,
        lastName,
      },
    };
    const createResult: any = await appSyncClient.mutate({
      mutation: gql(createMutation),
      fetchPolicy: 'no-cache',
      variables: createInput,
    });

    return createResult;
  };

  const updateStudent = async (studentId: number, classId: string, firstName: string, lastName: string): Promise<Record<string, any>> => {
    const updateMutation = /* GraphQL */ `
      mutation UpdateStudent($input: UpdateStudentInput!, $condition: ModelStudentConditionInput) {
        updateStudent(input: $input, condition: $condition) {
          studentId
          classId
          firstName
          lastName
        }
      }
    `;
    const updateInput = {
      input: {
        studentId,
        classId,
        firstName,
        lastName,
      },
    };
    const updateResult: any = await appSyncClient.mutate({
      mutation: gql(updateMutation),
      fetchPolicy: 'no-cache',
      variables: updateInput,
    });

    return updateResult;
  };

  const deleteStudent = async (studentId: number, classId: string): Promise<Record<string, any>> => {
    const deleteMutation = /* GraphQL */ `
      mutation DeleteStudent($input: DeleteStudentInput!, $condition: ModelStudentConditionInput) {
        deleteStudent(input: $input, condition: $condition) {
          studentId
          classId
          firstName
          lastName
        }
      }
    `;
    const deleteInput = {
      input: {
        studentId,
        classId,
      },
    };
    const deleteResult: any = await appSyncClient.mutate({
      mutation: gql(deleteMutation),
      fetchPolicy: 'no-cache',
      variables: deleteInput,
    });

    return deleteResult;
  };

  const getStudent = async (studentId: number, classId: string): Promise<Record<string, any>> => {
    const getQuery = /* GraphQL */ `
      query GetStudent($studentId: Int!, $classId: String!) {
        getStudent(studentId: $studentId, classId: $classId) {
          studentId
          classId
          firstName
          lastName
        }
      }
    `;
    const getInput = {
      studentId,
      classId,
    };
    const getResult: any = await appSyncClient.query({
      query: gql(getQuery),
      fetchPolicy: 'no-cache',
      variables: getInput,
    });

    return getResult;
  };

  const listStudents = async (limit = 100, nextToken: string | null = null, filter: any = null): Promise<Record<string, any>> => {
    const listQuery = /* GraphQL */ `
      query ListStudents($limit: Int, $nextToken: String, $filter: ModelStudentFilterInput) {
        listStudents(limit: $limit, nextToken: $nextToken, filter: $filter) {
          items {
            studentId
            classId
            firstName
            lastName
          }
          nextToken
        }
      }
    `;
    const listResult: any = await appSyncClient.query({
      query: gql(listQuery),
      fetchPolicy: 'no-cache',
      variables: {
        limit,
        nextToken,
        filter,
      },
    });

    return listResult;
  };

  const checkGenericError = async (errorMessage?: string): Promise<void> => {
    expect(errorMessage).toBeDefined();
    expect(errorMessage).toEqual('GraphQL error: Error processing the request. Check the logs for more details.');
  };
});