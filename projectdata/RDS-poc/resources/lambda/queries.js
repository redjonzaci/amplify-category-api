import { dbBuilder }  from './connection.js';

const getKeys = async (tableName) => {
	const fields = await dbBuilder('INFORMATION_SCHEMA.COLUMNS')
		.where({
			TABLE_SCHEMA: process.env['db_name'],
			TABLE_NAME: tableName,
			COLUMN_KEY: 'PRI'
		})
		.select('COLUMN_NAME');
	return fields.map(column => column.COLUMN_NAME);
};

const insert = async (tableName, record) => {
	await dbBuilder(tableName).insert(record);
	return await get(tableName, record);
}

const get = async (tableName, condition) => {
	if (!condition) {
		return await dbBuilder(tableName).select();
	}
	return await dbBuilder(tableName).where(condition);
}

const update = async (tableName, input, condition) => {
	if (!condition) {
		throw "Condition is required for Update operation";
	}
	const keys = await getKeys(tableName)
	const keyValues = await dbBuilder(tableName).where(condition).select(...keys);
	console.log(keyValues);
	await dbBuilder(tableName).where(condition).update(input);
	const result = [];
	for (const value of keyValues) {
		result.push(...(await dbBuilder(tableName).where(value).select()));
	}
	return result;
}

const del = async (tableName, condition) => {
	if (!condition) {
		throw "Condition is required for Delete operation";
	}
	const recordsToBeDeleted = await get(tableName, condition);
	await dbBuilder(tableName).where(condition).del();
	return recordsToBeDeleted;
}

const handleQuery = async (event) => {
  let result;
  if (event.detail.operation === 'INSERT') {
    result = await insert(event.detail.tableName, event.detail.args.input);
  }
  else if (event.detail.operation === 'UPDATE') {
    result = await update(event.detail.tableName, event.detail.args.input, event.detail.args.condition);
  } 
  else if (event.detail.operation === 'GET') {
    result = await get(event.detail.tableName, event.detail.args.condition);
  } 
  else if (event.detail.operation === 'DELETE') {
    result = await del(event.detail.tableName, event.detail.args.condition);
  } 
  else {
    throw 'Unknown operation';
  }
  console.log('Query has been executed.');
  return result;
}

export { handleQuery };
