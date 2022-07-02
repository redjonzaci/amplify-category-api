import AWS from 'aws-sdk';
import mysql2 from 'mysql2/promise';
import knex from 'knex';

let connection = null;
let dbBuilder;

const initDbBuilder = () => {
	if (dbBuilder !== undefined) {
    return;
  }
	var signer = new AWS.RDS.Signer({
	    region: 'us-west-2',
	    hostname: process.env['db_host'],
			port: 3306,
	    username: process.env['db_user']
	  });
	
	let token = signer.getAuthToken({
	  username: process.env['db_user']
	});

	let connectionConfig = {
	  host: process.env['db_host'],
		user: process.env['db_user'],
	  database: process.env['db_name'],
	  ssl: { rejectUnauthorized: false},
		password: token,
		authPlugins: {
      mysql_clear_password: () => () => {
				console.log('new auth plugin invoked');
        return Buffer.from(token + '\0');
      }
    }
	};

	connectionConfig.authSwitchHandler = (data, cb) => {
	    if (data.pluginName === 'mysql_clear_password') {
				console.log('Test Auth change');
	      // See https://dev.mysql.com/doc/internals/en/clear-text-authentication.html
	      let password = token + '\0';
	      let buffer = Buffer.from(password);
	      cb(null, password);
	    }
	};
	
	dbBuilder = knex({
		client: 'mysql2',
		connection: connectionConfig,
		  pool: {
		    min: 5, 
		    max: 30,
		    createTimeoutMillis: 30000,
		    acquireTimeoutMillis: 30000,
		    idleTimeoutMillis: 30000,
		    reapIntervalMillis: 1000,
		    createRetryIntervalMillis: 100
		  },
		  debug: true
	});
}

initDbBuilder();

export { dbBuilder };
