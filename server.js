var express = require('express');
var app = express();
var http = require('http').Server(app);
var io = require('socket.io')(http);
var path = require('path');
var fs = require('fs');

// Variables
var clients = [];	// array of objects -> { id: socketid, nickname: nickname, role: 'minion'|'spymaster', team: 1|2 }
var messages = [];	// array of objects -> { type: 'system'|'chat'|'error', text: (String)message }
var votes = [];		// array of objects -> { id: socketid, nickname: nickname, word: (String)word }
var words = {};		// dictionary -> key = (String)word, value = { team: 1|2, revealed: (boolean)val }
var hint = {};		// current hint -> {word: 'blah', num: x}
var turn;			// current turn in game: 1|2 -> team 1 is red, team 2 is blue
var phase;			// hinting | guessing
var numTimers;		// when timers go out on the front end, message is emitted to server. this is a count of # of timers received
var numChecks;		// same with timers, but with the ready checks before a game starts instead
var timer;			// global variable for time set by timer


// 'gamestate' emits to clients contain:
// 	{
// 		type: hint	    | vote                           | end
// 		info: hinted word | {word:(String),correct:(bool)} | int of team who won
// 	}


// array of all nouns
var allwords = fs.readFileSync(path.join(__dirname, 'public', 'libs', 'words.txt'), 'utf8').toString().split('\n');
var dictionary = fs.readFileSync(path.join(__dirname, 'public', 'libs', 'dictionary.txt'), 'utf8').toString().split('\n');

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
		createNewGame(socket);
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
		// if (clients.length < 4) {
		// 	endGame();
		// }
	});

	// ask jason about this later
	socket.on('readyGame', function(clientReady) {
		(clientReady['ready'] == true) ? numChecks++ : numChecks--;
		console.log(numChecks);
		if (numChecks == clients.length) {
			createNewGame(socket);
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
							if (words[inputs[1]].revealed) {
								socket.emit('message', {
									type: 'error',
									text: `invalid vote: "${inputs[1]}" has already been revealed`
								});
							}

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
						if (inputs[1] in dictionary) { // check if word is actually a word
							if (!(inputs[1] in words)) { // check if word is on the board
								var keys = Object.keys(words);
								for (var i = 0; i < keys; i++) { // check if word is within another word on the board
									if (inputs[1] in keys[i]) {
										socket.emit('message', {
											type: 'error',
											text: `invalid hint: your hint "${inputs[1]}" may not be part of a word on the board`
										});
									}
								}
								hint = {word: inputs[1], num: Number(inputs[2])};
								Object.assign(response, {
									type: 'system',
									text: `${nickname} has hinted the word "${hint['word']}"`
								});
								io.emit('gameState', {
									type: 'hint',
									info: inputs[1]
								})
							} else {
								socket.emit('message', {
									type: 'error',
									text: `invalid hint: you cannot hint "${inputs[1]}" if exists on the board`
								});
							}
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

function createNewGame(socket) {
	// assign random unique words to words{} from allwords[]
	var temparray = shuffle([...Array(allwords.length).keys()]).splice(0,25); // converts temparray to list (length 25) of random numbers up to allwords.length


	for (var i = 0; i < temparray.length; i++) { // converts numbers in temparray to words in allwords to be stored in words
		var team;
		switch (true) {
			case (i < 9): team = 1; break;	// team 1 has 9 cards (team 1 goes first)
			case (i < 17): team = 2; break; // team 2 has 8 cards (team 2 goes second)
			case (i == 17): team = 3; break;// only 1 assassin card
			default: team = 0;				// 7 neutral cards
		}
		words[allwords[temparray[i]]] = {team: team, revealed: false};
	}
	console.log(words);

	// other initial setup
	turn = 1;
	phase = 'hinting';

	// assignSpymasters(); // implementation for getting ready checks not done, so this will be put on hold or it will throw an error

	// make an unshuffled board[] -> {word: (String), team: 0|1|2|3}
	// if spymaster, team is revealed for each word
	// if not spymaster, all words are neutral
	var isSM = isSpymaster(socket);
	var keys = Object.keys(words);
	var board = [];
	for (var i = 0; i < keys.length; i++) {
		if (isSM) { 	// spymaster, give words + key
			board[i] = {
				word: keys[i],
				team: words[keys[i]]['team']
			};
		} else { 		// not spymaster, give words + neutrals
			board[i] = {
				word: keys[i],
				team: 0
			};
		}
	}
	board = shuffle(board);
	console.log(board);

	// send gamestate to players
	io.emit('newGame', {
		turn: turn,
		phase: phase,
		board: board
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

function assignSpymasters() {
    var clientids1 = [];
    var clientids2 = [];
    for (var i = 0; i < clients.length; i++) {
        if (clients[i].team == 1) {
            clientids1.push(clients[i].id);
        }
        else {
            clientids2.push(clients[i].id);
        }    
    }
    var spymaster1 = clientids1[Math.floor(Math.random() * clientids1.length)];
    var spymaster2 = clientids2[Math.floor(Math.random() * clientids2.length)];

    clients[spymaster1].role = 'spymaster';
    clients[spymaster2].role = 'spymaster';
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
	validateVote(Object.keys(temp).reduce(function(a, b) { return temp[a] > temp[b] ? a : b }));
}

function validateVote(vote) { // gets word and checks if it is right or wrong

	// if assassin, lose
	// if right, check if the team has won
	// if wrong, send back object -> {word: (String), correct: (bool)}

	if (words[vote]['team'] == 3) { // vote was the assassin, 
		if (turn == 1) {
			io.emit('gameState', {
				type: 'end',
				info: 2
			});
		} else {
			io.emit('gameState', {
				type: 'end',
				info: 1
			});
		}

	}

	if (words[vote]['team'] == turn) { // team's vote is correct

		if (checkWinCondition()) { // checked if team won
			io.emit('gameState', {
				type: 'end',
				info: turn
			});

		} else { // team guessed correctly but has not won yet
			io.emit('gameState', {
				type: 'vote',
				info: {
					word: vote,
					correct: true
				}
			});
			hint['num']--;
			words[vote]['revealed'] = true;
		}
	}
}

function checkWinCondition() { // checks if team with current turn has won
	var numRevealed = 0;
	var keys = Object.keys(words);
	for (var i = 0; i < keys.length; i++) {
		if (words[keys[i]]['team'] == turn && words[keys[i]]['revealed']) {
			numRevealed++;
		}
	}
	if (turn == 1 && numRevealed == 9) {
		return true;
	} else if (turn == 2 && numRevealed == 8) {
		return true;
	} else {
		return false;
	}
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

function shuffle(array) {
	var currentIndex = array.length, temporaryValue, randomIndex;

	// While there remain elements to shuffle...
	while (0 !== currentIndex) {

		// Pick a remaining element...
		randomIndex = Math.floor(Math.random() * currentIndex);
		currentIndex -= 1;

		// And swap it with the current element.
		temporaryValue = array[currentIndex];
		array[currentIndex] = array[randomIndex];
		array[randomIndex] = temporaryValue;
  	}
  	return array;
}


// Runner
http.listen(3000, "0.0.0.0", function() {
  	console.log('listening on *:3000');
});