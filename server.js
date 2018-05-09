var express = require('express');
var app = express();
var http = require('http').Server(app);
var io = require('socket.io')(http);
var path = require('path');
var fs = require('fs');
var bodyParser = require('body-parser');



// text files containing words
var allWordsText = fs.readFileSync(path.join(__dirname, 'public', 'libs', 'words.txt'), 'utf8').toString()
var dictionaryText = fs.readFileSync(path.join(__dirname, 'public', 'libs', 'dictionary.txt'), 'utf8').toString()

// Variables
var clients = [];		// array of objects -> { id: socketid, nickname: nickname, role: 'agent'|'spymaster', team: 1|2 }
var clientsDict = {};	// dictionary -> key = socket.id, value = client object
var messages = [];		// array of objects -> { type: 'system'|'chat'|'error', text: (String)message }
var votes = [];			// array of objects -> { id: socketid, nickname: nickname, word: (String)word }
var words = {};			// dictionary -> key = (String)word, value = { team: 1|2, revealed: 0|1 }
var hint = {};			// current hint -> {word: 'blah', num: x}
var turn;				// current turn in game: 1|2 -> team 1 is red, team 2 is blue
var phase;				// hinting | guessing
var timer;				// global variable for time set by timer
var numTimers = 0;		// when timers go out on the front end, message is emitted to server. this is a count of # of timers received
var numChecks = 0;		// same with timers, but with the ready checks before a game starts instead

var allWords = allWordsText.includes('\r') ? allWordsText.split('\r\n') : allWordsText.split('\n');
var dictionary = dictionaryText.includes('\r') ? dictionaryText.split('\r\n') : dictionaryText.split('\n');

// 'gamestate' emits to clients contain:
// 	{
// 		type: hint	      | vote                           | end
// 		info: hinted word | {word:(String),correct:(bool)} | int of team who won
// 	}


// ROUTES (SETUP)
app.use(express.static(path.join(__dirname, 'public/')));
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: false }));

app.get('/', function(req, res) {
  	res.sendFile(path.join(__dirname, 'public', 'views', 'game.html'));
});

// API 											TODO jleong: move to api.js?
app.get('/api/clients', function(req, res) {
	res.send({clients: clients});
});
app.get('/api/clients/names', function(req, res) {
	res.send([clients.map(c => c['nickname'])]);
});
app.post('/api/clients', function(req, res) {
	client = req.body;
	(client.ready === "true") ? numChecks++ : numChecks--;
	console.log("numChecks: " + numChecks);
	console.log(clients);
	if ((numChecks == clients.length) & (numChecks > 4)){
		console.log('createNewGame()');
		createNewGame(getSocketByID(client.id));
	}
	res.send('server ack client post sendReady()');
});
app.get('/api/messages', function(req, res) {
	res.send(messages);
});
app.get('/api/messages/?type=:type', function(req, res) {
	// types = client, server, chat, command
	res.send(messages.filter(function(msg) {return msg['type'] == req.params.type}));
})
app.get('/api/votes', function(req, res) {
	res.send(votes);
});

// CONNECTION
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
			role: "agent",	// to be updated
			team: (clients.length % 2 == 0) ? 1 : 2 // to be updated
		}
		clients.push(newPlayer);
		clientsDict[socket.id] = newPlayer;

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
		socket.emit('newUser', socket.id);
		io.emit('clients', clients);
		messages.push(msg);
	});

	// receive disconnections
	socket.on('disconnect', function() {

		console.log(`Disconnected: ${socket.id} \t (${nickname})`);

		// remove disconnected socket from clients (refactor later -> maybe make clients a dictionary?)
		for (var i = 0; i < clients.length; i++) {
			if (clients[i].id == socket.id) {
				clients.splice(i, 1);
				break;
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

	socket.on('nextPhaseReady', function() { // timer expired
		numTimers++;
		if (numTimers == clients.length) { // make sure everyone's timer has ended
			switch (phase) {
				case 'hinting':
					io.emit('gameState', {
						type: 'hint',
						info: hint['word']
					});
					io.emit('startTimer', 60);
					phase = 'guessing';
					break;

				case 'guessing':
					getVoteMajority();
					io.emit('startTimer', 60);
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
						if (isSpymaster(socket.id)) {
							socket.emit('message', {
								type: 'error',
								text: 'The Spymaster may not vote.'
							});
							return;
						}
						// check if vote exists in game board
						if (inputs[0] in words) {
							if (words[inputs[0]].revealed == 1) {
								socket.emit('message', {
									type: 'error',
									text: `invalid vote: "${inputs[0]}" has already been revealed`
								});
								return;
							}

							// remove vote belonging to client if it exists, add new vote
							votes = votes.filter(function(vote) {
								return vote.id != socket.id;
							});
							votes.push({
								id: socket.id,
								nickname: nickname,
								word: inputs[0]
							});

							// adjust message
							Object.assign(response, {
								type: 'system',
								text: `${nickname} has voted for "${inputs[0]}"`
							});
						} else {
							socket.emit('message', {
								type: 'error',
								text: `invalid vote: "${inputs[0]}" does not exist on the board`
							});
							return;
						}
						break;

					case 'hint':

						// if user is not spymaster, send error
						if (!isSpymaster(socket.id)) {
							socket.emit('message', {
								type: 'error',
								text: 'Only the Spymaster is allowed to send a hint.'
							});
							return;
						}
						//check if hint exists in dictionary of words
						if (dictionary.indexOf(inputs[0]) >= 0) { // check if word is actually a word
							if (!(inputs[0] in words)) { // check if word is on the board
								var keys = Object.keys(words);
								for (var i = 0; i < keys; i++) { // check if word is within another word on the board
									if (inputs[0] in keys[i]) {
										socket.emit('message', {
											type: 'error',
											text: `invalid hint: your hint "${inputs[0]}" may not be part of a word on the board`
										});
										return;
									}
								}
								hint = {word: inputs[0], num: Number(inputs[1])};
								Object.assign(response, {
									type: 'system',
									text: `${nickname} has hinted the word "${hint['word']}"`
								});
								io.emit('gameState', {
									type: 'hint',
									info: inputs[0]
								})
							} else {
								socket.emit('message', {
									type: 'error',
									text: `invalid hint: you cannot hint "${inputs[0]}" if exists on the board`
								});
								return;
							}
						} else {
							socket.emit('message', {
								type: 'error',
								text: `invalid hint: "${inputs[0]}" not found in dictionary`
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
				break;
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
	console.log('starting new game...');
	// assign random unique words to words{} from allWords[]
	var temparray = shuffle([...Array(allWords.length).keys()]).splice(0,25); // converts temparray to list (length 25) of random numbers up to allWords.length


	for (var i = 0; i < temparray.length; i++) { // converts numbers in temparray to words in allWords to be stored in words
		var team;
		switch (true) {
			case (i < 9): team = 1; break;	// team 1 has 9 cards (team 1 goes first)
			case (i < 17): team = 2; break; // team 2 has 8 cards (team 2 goes second)
			case (i == 17): team = 3; break;// only 1 assassin card
			default: team = 0;				// 7 neutral cards
		}
		words[allWords[temparray[i]]] = {team: team, revealed: 0};
	}

	// other initial setup
	turn = 1;
	phase = 'hinting';

	// assignSpymasters(); // implementation for getting ready checks not done, so this will be put on hold or it will throw an error

	// if spymaster, team is revealed for each word
	// if not spymaster, all words are neutral
	console.log('initializing board...');
	var keys = Object.keys(words);				// array of the words
	var board = [];								// board to be processed twice (for agent, then spymasters)
	for (var i = 0; i < keys.length; i++) { 	// populate board[] with words and neutral team associations
		board.push({
			word: keys[i],
			team: 0,
			revealed: 0
		});
	}
	board = shuffle(board);						// shuffle board
	for (var i = 0; i < clients.length; i++) {	// send neutral board to agents
		socket.broadcast.to(clients[i]['id']).emit('newGame', {
			turn: turn,
			phase: phase,
			board: board,
			team: clients[i]['team'],
			role: clients[i]['role']
		});
	}
	for (var i = 0; i < board.length; i++) {	// assign answers to board[]
		Object.assign(board[i], {team: words[board[i]['word']]['team']})
	}

	for (var i = 0; i < clients.length; i++) {	// send board with answers to spymasters
		if (isSpymaster(clients[i]['id'])) {
			socket.broadcast.to(clients[i]['id']).emit('key', board);
		}
	}
	console.log('game initialization finished')
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
    var team1 = [];
    var team2 = [];
    for (var i = 0; i < clients.length; i++) {
        if (clients[i].team == 1) {
            team1.push(clients[i]);
        }
        else {
            team2.push(clients[i]);
        }
    }
    team1[Math.floor(Math.random() * team1.length)]['role'] = 'spymaster';
    team2[Math.floor(Math.random() * team2.length)]['role'] = 'spymaster';
}

function isSpymaster(socketid) {
	for (var i = 0; i < clients.length; i++) {
		if (clients[i].id == socketid) {
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
			hint['num']--;

			if (hint['num'] == 0) { // the team is out of guesses
				turn = (turn == 1) ? 2 : 1;
				phase = 'hinting';
				io.emit('gameState', {
					type: 'vote',
					info: {
						word: vote,
						correct: true,
						switch: true,
						turn: turn,
						wordTeam: words[vote]['team']
					}
				});
			} else { // the team still has more guesses
				io.emit('gameState', {
					type: 'vote',
					info: {
						word: vote,
						correct: true,
						switch: false,
						turn: turn,
						wordTeam: words[vote]['team']
					}
				});
			}
			words[vote]['revealed'] = 1;
		}
	} else { // team's vote is incorrect
		turn = (turn == 1) ? 2 : 1;
		io.emit('gameState', {
			type: 'vote',
			info: {
				word: vote,
				correct: false,
				switch: true,
				turn: turn,
				wordTeam: words[vote]['team']
			}
		})
		phase = 'hinting';
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

function getSocketByID(socketid) {
	return io.sockets.connected[socketid];
}

// RUNNER
http.listen(3000, "0.0.0.0", function() {
  	console.log('listening on *:3000');
});
