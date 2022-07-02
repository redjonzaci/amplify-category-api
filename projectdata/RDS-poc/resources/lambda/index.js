//https://aws.amazon.com/blogs/compute/using-amazon-rds-proxy-with-aws-lambda/
//https://deniapps.com/blog/setup-aws-lambda-to-use-amazon-rds-proxy
import { handleQuery } from './queries.js';

export const handler = async(event) => {
	console.log(event);
	let result;
	try {
		result = handleQuery(event);
	} catch (error) {
		console.log(error);	
	}
	return result;
};

// This is for debugging handler in local
// handler({
// 	// info: { fieldName: 'createPerson', parentTypeName: 'Mutation', variables: {} },
// 	info: { fieldName: 'createPerson', parentTypeName: 'Query', variables: {} },
// 	detail: {
// 		operation: 'GET',
// 		tableName: 'Tasks',
// 		args: {
// 			input: {
// 				id: 2,
// 				title: 'Task BX',
// 				description: 'Description BY',
// 				priority: 5
// 			},
// 			condition: {
// 				id: 2
// 			}
// 		}
// 	}
// }).then(result => {
// 	console.log('Result');
// 	console.log(result);
// }).catch(error => {
// 	console.log('Error')
// 	console.log(error);
// });
