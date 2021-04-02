const mysql = require('mysql');
const express = require('express');
const session = require('express-session');
const requestIp = require('request-ip');
const { v4: uuidv4, validate: validateUUID } = require('uuid');

const OPEN = 'Open';
const CLOSED = 'Closed';
const port = 8081;

const con = mysql.createConnection({
	host     : 'localhost',
	port 	 : '3306',
	user     : 'root',
	password : 'pw',
	database : 'raffle'
});

const app = express();
app.set('view engine', 'ejs');

app.use(requestIp.mw());
app.use(session({
	secret: 'secret',
	resave: true,
	saveUninitialized: true
}));
app.use(express.urlencoded({extended : false}));

app.get('/', function(req, res) {
	res.render('create.ejs');
});

// get url to raffle
function raffleURL(id) {
	return '/raffle/' + id + '/';
}

// create a new raffle
app.post('/postraffle', function(req, res) {
	var name = req.body.name;
	var password = req.body.password;
	if (name && password) {
		if (name.length <= 255 && password.length <= 255) {
			// insert to db
			id = uuidv4();
			var sql = "INSERT INTO raffles(id, name, password) VALUES(UUID_TO_BIN(?),?,?)";
			con.query(sql, [id, name, password], function (err, result) {
				if (err) throw err;
			});

			// store raffle for this session
			if (!req.session.raffles) {
				req.session.raffles = [];
			}
			req.session.raffles.push(id);

			// redirect to newly created raffle
			res.redirect(raffleURL(id));
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
	var sql = "SELECT * FROM raffles WHERE id = UUID_TO_BIN(?)";
	con.query(sql, [id], function (err, result) {
		if (err) throw err;
	
		var raffleName = id;
		var status = null;
		var raffleResult = null;
		// extract info from result
		if (result.length > 0) {
			raffleName = result[0].name;
			status = result[0].status;
			raffleResult = result[0].result;
		}

		fun({ name: raffleName, status: status, result: raffleResult });
	});
}

// inspect a raffle
app.get('/raffle/:id/', function(req, res) {
	var id = req.params.id;
	if (!validateUUID(id)) {
		res.sendStatus(404);
		return;
	}

	applyRaffle(id, function (raffle) {
		if (raffle.status) {
			// check if pw needed
			var rsf = req.session.raffles;
			var canClose = rsf && rsf.includes(id);
			
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
	var id = req.params.id;
	if (!validateUUID(id)) {
		res.sendStatus(404);
		return;
	}

	var owner = req.clientIp;
	applyRaffle(id, function (raffle) {
		status = raffle.status;
		if (status === OPEN) {
			// check if user already added a ticket
			var sql = "SELECT * FROM tickets WHERE raffleID = UUID_TO_BIN(?) AND owner = ?";
			con.query(sql, [id, owner], function (err, result) {
				if (err) throw err;

				var action = result.length > 0 ? 'Update' : 'Add';
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
	var id = req.params.id;
	if (!validateUUID(id)) {
		res.sendStatus(404);
		return;
	}
	var owner = req.clientIp;
	var content = req.body.content;

	if (content.length > 255) {
		res.send('Text of ticket too long!');
		return;
	}
	
	applyRaffle(id, function (raffle) {
		// if raffle open
		if (raffle.status === OPEN) {
			// add ticket to raffle. update if user already added a raffle.
			var sql = `INSERT INTO tickets (raffleID, owner, content) VALUES (UUID_TO_BIN(?),?,?)
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
			var randomSql = "SELECT * FROM tickets WHERE raffleID = UUID_TO_BIN(?) ORDER BY RAND() LIMIT 1";
			con.query(randomSql, [id], function (err, result) {
				if (err) throw err;

				var content = '';
				if (result.length > 0) {
					content = result[0].content;
				}

				// set raffle to closed and result to content of selected raffle
				var sql = "UPDATE raffles SET status=?,result=? WHERE id=UUID_TO_BIN(?)";
				con.query(sql, [CLOSED, content, id], function (err, result) {
					if (err) throw err;
				});
			});
		}
	});
}

// close raffle request
app.post('/raffle/:id/close', function(req, res) {
	var id = req.params.id;
	if (!validateUUID(id)) {
		res.sendStatus(404);
		return;
	}
	
	var rsf = req.session.raffles
	if (!(rsf && rsf.includes(id))) {
		// raffle not created in this session. need pw.
		var pw = req.body.password;
		// check if correct pw given
		var sql = "SELECT * FROM raffles WHERE id = UUID_TO_BIN(?) AND password = ?";
		con.query(sql, [id, pw], function (err, result) {
			if (result.length > 0) {
				// pw match
				closeRaffle(id);
				res.redirect('back');
			} else {
				res.send('Invalid password!');
			}
		});
	} else {
		// raffle created in this session. can close without pw.
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