var express = require('express')
var app = express();
var http = require('http').Server(app);
var io = require('socket.io')(http);
var path = require('path')
var fs = require('fs');

// Variables
var clients = [];	// array of objects -> { id: socketid, nickname: nickname, role: 'minion'|'spymaster', team: 1|2 }
var messages = [];	// array of objects -> { type: 'system'|'chat'|'error', text: (String)message }
var votes = [];		// array of objects -> { id: socketid, nickname: nickname, word: (String)word }
var words = {};		// dictionary -> key = (String)word, value = { team:'A'|'B', revealed: (boolean)val }
var hint = {};		// current hint -> {word: 'blah', num: x}
var turn;			// current turn in game: 1 | 2
var phase;			// hinting | guessing
var numTimers;		// when timers go out on the front end, message is emitted to server. this is a count of # of timers received
var numChecks;		// same with timers, but with the ready checks before a game starts instead
var timer;			// global variable for time set by timer

// array of all nouns
var allwords = fs.readFileSync(path.join(__dirname, 'public', 'libs', 'words.txt')).toString().split('\n');

// Routes
app.use(express.static(path.join(__dirname, 'public/')));
app.get('/', function(req, res) {
  	res.sendFile(path.join(__dirname, 'public', 'views', 'game.html'));
});
app.get('/api/clients', function(req, res) {
	res.status(200).json({clients: clients});
});
app.get('/api/messages', function(req, res) {
	res.status(200).json(messages);
});
app.get('/api/messages/?type=:type', function(req, res) {
	// types = client, server, chat, command
	res.status(200).json(messages.filter(function(msg) {return msg['type'] == req.params.type}));
})
app.get('/api/votes', function(req, res) {
	res.status(200).json(votes);
});

// Connection 
// very helpful: https://stackoverflow.com/questions/35680565/sending-message-to-specific-client-in-socket-io/35681189
io.on('connection', function(socket) {

	var nickname;

	// receive connections
	socket.on('newUser', function(nick) {
		// Get user's nickname and add him to clients array
		nickname = nick;
		console.log(`Connection: ${socket.id} \t as ${nickname}`);
		var newPlayer = {
			id: socket.id,
			nickname: nickname,
			role: "minion",	// to be updated
			team: "red"	// to be updated
		}
		clients.push(newPlayer);	

		// Display previous messages
		for (var i = 0; i < messages.length; i++) {
			socket.emit('message', messages[i]);
		}

		// Display connection message
		var msg = {type: 'system', text: nickname + ' has connected'}
		io.emit('message', msg);
		// for (var i = 0; i < clients.length; i++) {
		// 	if (clients[i]['id'] != socket.id)
		// 		socket.broadcast.to(clients[i]['id']).emit('newPlayer', newPlayer);
		// }
		socket.emit('id', socket.id);
		io.emit('clients', clients);
		messages.push(msg);
		startNewTimer(10);
	});

	// receive disconnections
	socket.on('disconnect', function() {

		console.log(`Disconnected: ${socket.id} \t (${nickname})`);

		// remove disconnected socket from clients (refactor later -> maybe make clients a dictionary?)
		for (var i = 0; i < clients.length; i++) {
			if (clients[i].id == socket.id) {
				clients.splice(i, 1);
			}
		}

		// Display disconnection message
		var msg = {type: 'system', text: nickname + ' disconnected'}
		io.emit('message', msg);
		io.emit('clients', clients);
		messages.push(msg);

		// check if <4 players - if so force game quit (emit endGame?)
		if (clients.length < 4) {
			endGame();
		}
	});

	socket.on('readyGame', function(clientReady) {
		(clientReady['ready'] == true) ? numChecks++ : numChecks--;
		console.log(numChecks);
		if (numChecks == clients.length) {
			createNewGame();
		}
	});

	socket.on('nextPhaseReady', function() { // timer expired
		numTimers++;
		if (numTimers == clients.length) { // make sure everyone's timer has ended
			switch(true) {
				case (phase == 'hinting'):
					io.emit('')
					phase = 'guessing';
					break;

				case (phase == 'guessing'):
					phase = 'hinting';
					break;
			}
			numTimers = 0;
		}
	});


	socket.on('message', function(msg) {
		// msg = {text: "", type: vote|hint}
		const response = {};
		switch (msg['type']) {

			case 'command':
				var inputs = msg['text'].split(' ');
				// check spymaster
				switch (msg['cmdType']) {

					case 'vote':

						// if user is spymaster, send error
						if (isSpymaster(socket)) {
							socket.emit('message', {
								type: 'error',
								text: 'The Spymaster may not vote.'
							});
						}
						console.log(inputs[1]);
						// check if vote exists in game board
						if (inputs[1] in words) {
							// remove vote belonging to client if it exists, add new vote
							votes = votes.filter(function(vote) {
								return vote.id != socket.id;
							});
							votes.push({
								id: socket.id,
								nickname: nickname,
								word: inputs[1]
							});

							// adjust message
							Object.assign(response, {
								type: 'system',
								text: `${nickname} has voted for "${inputs[1]}"`
							});
						} else {
							socket.emit('message', {
								type: 'error',
								text: `invalid vote: "${inputs[1]}" does not exist on the board`
							});
							return;
						}
						break;

						
					case 'hint':

						// if user is not spymaster, send error
						if (!isSpymaster(socket)) {
							socket.emit('message', {
								type: 'error',
								text: 'Only the Spymaster is allowed to send a hint.'
							});
						}

						//check if hint exists in dictionary of words
						if (inputs[1] in dictionary) {
							hint = {word: inputs[1], num: inputs[2]};
							Object.assign(response, {
								type: 'system',
								text: `${nickname} has hinted the word "${hint['word']}"`
							});
							io.emit('gameState', {
								type: 'hint',
								info: hint['word']
							})
						} else {
							socket.emit('message', {
								type: 'error',
								text: `invalid hint: "${inputs[1]}" not found in dictionary`
							});
							return;
						}
						break;

					default:
						socket.emit('message', {
							type: 'error',
							text: `invalid command: "${msg[0]}"` // sent only to client
						});
						return;
				}
			case 'chat':
				Object.assign(response, {
					type: 'chat',
					text: `${nickname}: ${msg['text']}`
				});
				break;

			default:
				return;
		}
		// do this regardless
		messages.push(response);
		io.emit('message', response);
	});
});

function createNewGame() {
	// assign random unique words to words{} from allwords[]
	var temparray = []
	while (temparray.length < 25) { // converts temparray to list (length 25) of random numbers up to allwords.length
		var rand = Math.floor(Math.random() * allwords.length) + 1;
		if (temparray.indexOf(rand) > -1) continue;
		temparray[temparray.length] = rand;
	}

	for (var i = 0; i < temparray.length; i++) { // converts numbers in temparray to words in allwords to be stored in words
		var team;
		switch (true) {
			case (i < 9): team = 1; break;	// team 1 has 9 cards (team 1 goes first)
			case (i < 17): team = 2; break; // team 2 has 8 cards (team 2 goes second)
			case (i == 17): team = 3; break;// only 1 assassin card
			default: team = 0;				// 7 white cards
		}
		words[allwords[temparray[i]]] = {team: team, revealed: false};
	}

	// other initial setup
	turn = 1;
	phase = 'hinting';

	// send game state to players
	io.emit('newGame', {
		turn: turn,
		phase: phase
	});
}

function endGame() {
	messages = [];
	votes = [];
	words = {};
	hint = {};
	var turn;
	var phase;
	var numTimers;
	var numChecks;
	var timer;
	if (clients.length < 4) {
		io.emit('message', {type: 'system', text: 'There are less than four players connected, ending game'})
	}
}

function isSpymaster(socket) {
	for (var i = 0; i < clients.length; i++) {
		if (clients[i].id == socket.id) {
			if (clients[i].role == 'spymaster') {
				return true;
			}
			return false; // id found, not spymaster, break out of for loop
		}
	}
}

function getVoteMajority() {
	var temp = {}
	for (var i = 0; i < votes.length; i++) {
		var word = votes[1]['word'];
		typeof temp[word] === 'undefined' ? temp[word] = 1 : temp[word]++;
	}
	return Object.keys(temp).reduce(function(a, b) { return temp[a] > temp[b] ? a : b });
}

function startNewTimer(time) {          // time in seconds
    clearInterval(timer);
    timer = setInterval(function() {
        if (time == 0) {
        	clearInterval(timer);
        	// timer is out, do something (like call a function or some shit)
        } else {
	        time--;
	        timer = time;
			console.log(`timer value: ${timer}`);
    	}
    }, 1000);
    return timer;
}

// Runner
http.listen(3000, "0.0.0.0", function() {
  	console.log('listening on *:3000');
});