const mysql = require('mysql');
const express = require('express');
const cookieParser = require('cookie-parser')
const requestIp = require('request-ip');
const { v4: uuidv4, validate: validateUUID } = require('uuid');
require('dotenv').config()
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');

const OPEN = 'Open';
const CLOSED = 'Closed';
const port = 8081;

const con = mysql.createConnection({
	host: process.env.DB_HOST,
	port: process.env.DB_PORT,
	user: process.env.DB_USER,
	password: process.env.DB_PASS,
	database : 'raffle'
});

const app = express();
app.set('view engine', 'ejs');

app.use(requestIp.mw());
app.use(cookieParser());
app.use(express.urlencoded({extended : false}));

app.get('/', function(req, res) {
	res.render('create.ejs');
});

// get url to raffle
function raffleURL(id) {
	return '/raffle/' + id + '/';
}

// create a new raffle
app.post('/postraffle', async function(req, res) {
	const { name, password } = req.body;
	if (name && password) {
		if (name.length <= 255 && password.length <= 255) {
			// insert to db
			id = uuidv4();
			bcrypt.hash(password, 10, function(err, hash) {
				const sql = "INSERT INTO raffles(id, name, password) VALUES(UUID_TO_BIN(?),?,?)";
				con.query(sql, [id, name, hash], function (err, result) {
					if (err) throw err;
				});

				// create token
				const token =  jwt.sign(
					{ id: id },
					process.env.TOKEN_KEY
				);

				// store as cookie
				res.cookie(id, token, { httpOnly: true });

				// redirect to newly created raffle
				res.redirect(raffleURL(id));
			});
		} else {
			res.send('Name or password too long!');
		}
	} else {
		res.send('Please enter name and password!');
	}
});

// extract raffle and apply function
function applyRaffle(id, fun) {
	// get raffle informations
	const sql = "SELECT * FROM raffles WHERE id = UUID_TO_BIN(?)";
	con.query(sql, [id], function (err, result) {
		if (err) throw err;
	
		let raffleName = id;
		let status = null;
		let raffleResult = null;
		// extract info from result
		if (result.length > 0) {
			raffleName = result[0].name;
			status = result[0].status;
			raffleResult = result[0].result;
		}

		fun({ name: raffleName, status: status, result: raffleResult });
	});
}

function checkToken(id, req) {
	// check if token exists
	if (!req.cookies[id]) {
		return false;
	}

	try {
		// verify token
		return jwt.verify(req.cookies[id], process.env.TOKEN_KEY).id == id
	} catch (err) {
		// invalid token
		return false;
	}
}

// inspect a raffle
app.get('/raffle/:id/', function(req, res) {
	const id = req.params.id;
	if (!validateUUID(id)) {
		res.sendStatus(404);
		return;
	}

	applyRaffle(id, function (raffle) {
		if (raffle.status) {
			// check if pw needed
			const canClose = checkToken(id, req);
			
			res.render('raffle', {
				raffleName: raffle.name,
				status : raffle.status,
				result : raffle.result,
				canClose : canClose
			});
		} else {
			res.sendStatus(404);
		}
	});
});

// join raffle interface
app.get('/raffle/:id/join', function(req, res) {
	const id = req.params.id;
	if (!validateUUID(id)) {
		res.sendStatus(404);
		return;
	}

	const owner = req.clientIp;
	applyRaffle(id, function (raffle) {
		status = raffle.status;
		if (status === OPEN) {
			// check if user already added a ticket
			const sql = "SELECT * FROM tickets WHERE raffleID = UUID_TO_BIN(?) AND owner = ?";
			con.query(sql, [id, owner], function (err, result) {
				if (err) throw err;

				const action = result.length > 0 ? 'Update' : 'Add';
				res.render('join', {
					raffleName: raffle.name,
					action : action
				});
			});
		} else if (status) {
			// cant join this raffle anymore
			res.redirect(raffleURL(id));
		} else {
			// raffle doesnt exists
			res.sendStatus(404);
		}
	});
});

// add ticket to raffle
app.post('/raffle/:id/apply', function(req, res) {
	const id = req.params.id;
	if (!validateUUID(id)) {
		res.sendStatus(404);
		return;
	}
	const owner = req.clientIp;
	const content = req.body.content;

	if (content.length > 255) {
		res.send('Text of ticket too long!');
		return;
	}
	
	applyRaffle(id, function (raffle) {
		// if raffle open
		if (raffle.status === OPEN) {
			// add ticket to raffle. update if user already added a raffle.
			const sql = `INSERT INTO tickets (raffleID, owner, content) VALUES (UUID_TO_BIN(?),?,?)
					     ON DUPLICATE KEY UPDATE content=VALUES(content)`
			con.query(sql, [id, owner, content], function (err, result) {
				if (err) throw err;
			});
		}
	});

	// redirect back to raffle
	res.redirect(raffleURL(id));
});

// close raffle
function closeRaffle(id) {
	applyRaffle(id, function(raffle) {
		// if raffle is open
		if (raffle.status == OPEN) {
			// get random ticket in raffle
			const randomSql = "SELECT * FROM tickets WHERE raffleID = UUID_TO_BIN(?) ORDER BY RAND() LIMIT 1";
			con.query(randomSql, [id], function (err, result) {
				if (err) throw err;

				let content = '';
				if (result.length > 0) {
					content = result[0].content;
				}

				// set raffle to closed and result to content of selected raffle
				const sql = "UPDATE raffles SET status=?,result=? WHERE id=UUID_TO_BIN(?)";
				con.query(sql, [CLOSED, content, id], function (err, result) {
					if (err) throw err;
				});
			});
		}
	});
}

// close raffle request
app.post('/raffle/:id/close', function(req, res) {
	const id = req.params.id;
	if (!validateUUID(id)) {
		res.sendStatus(404);
		return;
	}
	
	if (!checkToken(id, req)) {
		// no token. need pw.
		const pw = req.body.password;
		
		// check if correct pw given
		const sql = "SELECT * FROM raffles WHERE id = UUID_TO_BIN(?)";
		con.query(sql, [id], function (err, result) {
			if (result.length > 0) {
				bcrypt.compare(pw, result[0].password, function(err, result) {
					if (result) {
						// pw match
						closeRaffle(id);
						res.redirect('back');
					} else {
						// wrong pw
						res.send('Invalid password!');
					}
				});
			} else {
				// raffle does not exist
				res.sendStatus(404);
			}
		});
	} else {
		// has token. can close without pw.
		closeRaffle(id);
		res.redirect('back');
	}
});

app.use(function(req, res){
	res.sendStatus(404);
});

app.listen(port, function () {
	console.log(`Example app listening at http://localhost:${port}`);
 })