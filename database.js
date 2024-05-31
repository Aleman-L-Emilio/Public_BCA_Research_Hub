const mysql = require('mysql');
const dotenv = require('dotenv');

var connection = mysql.createConnection({
	host : dotenv.DBHOST,
	user : dotenv.DBUSERNAME,
	password : dotenv.DBPASSWORD
});

connection.connect(function(error){
	if(error) throw error;
	console.log('MySQL Database is connected Successfully');
});

module.exports = connection;