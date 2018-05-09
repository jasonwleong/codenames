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
var turn = 0;			// current turn in game: 1|2 -> team 1 is red, team 2 is blue
var phase;				// hinting | guessing
var timer;				// global variable for time set by timer
var numTimers = 0;		// when timers go out on the front end, message is emitted to server. this is a count of # of timers received
var numChecks = 0;		// same with timers, but with the ready checks before a game starts instead
var gameInit = true;
var guessCorrect = false;
var swapTeams = false;

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
	if (!gameInit) {
		res.status(400).send('A game is currently running. Please try again later.');
	}
	client = req.body;
	(client.ready === "true") ? numChecks++ : numChecks--;
	if ((numChecks == clients.length) & (numChecks >= 4)) {
		createNewGame();
	}
	res.send('Server has started a new game with createNewGame()');
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
app.get('api/dictionary', function(req, res) {
	res.send(dictionary);
})

// CONNECTION
// very helpful: https://stackoverflow.com/questions/35680565/sending-message-to-specific-client-in-socket-io/35681189
io.on('connection', function(socket) {

	var nickname;

	if (turn != 0) {		// reject any new connections while a game is in progress
		socket.conn.close();
	}

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
		socket.emit('userID', socket.id);
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
		if ((turn != 0) & (clients.length < 4)) {
			io.emit('message', {type: 'system', text: 'There are less than four players connected, ending game'})
			endGame();
		}
	});

	socket.on('message', function(msg) {
		// msg = {text: "", type: vote|hint}
		const response = {};
		switch (msg['type']) {
			case 'command':
				if (gameInit) {
					socket.emit('message', {
						type: 'error',
						text: `You may not send commands while the game is starting.`
					});
					return;
				}
				if (turn != clientsDict[socket.id]['team']) { // it is not your team's turn, you may not send commands
					socket.emit('message', {
						type: 'error',
						text: `You may not send commands when it is not your team's turn.`
					});
					return;
				}
				var inputs = msg['text'].split(' ');
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
                        // give error if it is currently the hinting phase
                        if (phase == 'hinting') {
							socket.emit('message', {
								type: 'error',
								text: 'You may not guess during the hinting phase.'
							});
							return;
                        }
						// check if vote exists in game board
						if (inputs[0].toLowerCase() in words) {
							if (words[inputs[0].toLowerCase()].revealed == 1) {
								socket.emit('message', {
									type: 'error',
									text: `invalid vote: "${inputs[0].toLowerCase()}" has already been revealed`
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
								word: inputs[0].toLowerCase()
							});

							// adjust message
							Object.assign(response, {
								type: 'system',
								text: `${nickname} has voted for "${inputs[0].toLowerCase()}"`
							});
						} else {
							socket.emit('message', {
								type: 'error',
								text: `invalid vote: "${inputs[0].toLowerCase()}" does not exist on the board`
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
                        // give error if it is currently the guessing phase
                        if (phase == 'guessing') {
							socket.emit('message', {
								type: 'error',
								text: 'You may not hint during the guessing phase.'
							});
							return;
                        }
						//check if hint exists in dictionary of words
						if (dictionary.indexOf(inputs[0].toLowerCase()) >= 0) { // check if word is actually a word
							if (!(inputs[0].toLowerCase() in words)) { // check if word is on the board
								var keys = Object.keys(words);
								for (var i = 0; i < keys; i++) { // check if word is within another word on the board
									if (inputs[0].toLowerCase() in keys[i]) {
										socket.emit('message', {
											type: 'error',
											text: `invalid hint: your hint "${inputs[0].toLowerCase()}" may not be part of a word on the board`
										});
										return;
									}
								}
								hint = {word: inputs[0].toLowerCase(), num: Number(inputs[1])};
								Object.assign(response, {
									type: 'system',
									text: `${nickname} has hinted the word "${hint['word']}" for ${inputs[1]} tile(s).`
								});
								io.emit('gameState', {
									type: 'hint',
									info: inputs[0]
								})
							} else {
								socket.emit('message', {
									type: 'error',
									text: `invalid hint: you cannot hint "${inputs[0].toLowerCase()}" if exists on the board`
								});
								return;
							}
						} else {
							socket.emit('message', {
								type: 'error',
								text: `invalid hint: "${inputs[0].toLowerCase()}" not found in dictionary`
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

	socket.on('nextPhaseReady', function() { // timer expired
		nextPhaseReady();
	});
});

function createNewGame() {
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

	// assign spymasters and send this data to all clients
	assignSpymasters();
	io.emit('clients', clients);

	var keys = Object.keys(words);				// array of the words
	var board = [];								// board to be processed twice (for agent, then spymasters)
	for (var i = 0; i < keys.length; i++) { 	// populate board[] with words and neutral team associations
		board.push({
			word: keys[i],
			team: 4,							// 4 is now default (unrevealed)
			revealed: 0
		});
	}
	board = shuffle(board);											// shuffle board
	var key = JSON.parse(JSON.stringify(board));
	for (var i = 0; i < board.length; i++) {						// create key if spymaster, team is revealed for each word
		Object.assign(key[i], {team: words[key[i]['word']]['team']})
	}
	for (var i = 0; i < clients.length; i++) {						// iterate through all clients
		var newGameData = {
			turn: turn,
			board: board
		};
		Object.assign(newGameData, {role: clients[i]['role'],		// provide every client with their role and id
									id: clients[i]['id']});
		if (isSpymaster(clients[i]['id'])) {						// provide key if the client is a spymaster
			Object.assign(newGameData, {key: key});
		}
		var socket = getSocketByID(clients[i]['id']);
		socket.emit('newGame', newGameData);						// emit personalized data to each client
	}
	io.emit('startTimer', 10);				// FIXME: revert to 60
	io.emit('message', {
		type: 'system',
		text: 'Game is starting in 10 seconds'
	});
	console.log('game initialization finished');
}

function nextPhaseReady() {
	numTimers++;
	if (numTimers == clients.length) { // make sure everyone's timer has ended
		console.log('all timers received, next phase triggered')
		if (gameInit) { // initial game state, game starts in hinting phase with team 1
			turn = 1;
			phase = 'hinting';
			io.emit('message', {
				type: 'system',
				text: `Hinting phase started. ${(turn == 1) ? 'Red' : 'Blue'} Spymaster has 60 seconds to hint a word.`
			});
			io.emit('startTimer', 20);
			gameInit = false;
		} else {
			if (guessCorrect) { // agents guessed correctly and get to go again
				guessCorrect = false;
				phase = 'guessing';
				io.emit('message', {
					type: 'system',
					text: `The current hint is: ${hint['word']} for ${hint['num']} tile(s). ${(turn == 1) ? 'Red' : 'Blue'} Agents have 60 seconds to guess more words.`
				});
				io.emit('startTimer', 20);
				votes = [];
			} else {
				if (swapTeams) {
					swapTeams = false;
					turn = (turn == 1) ? 2 : 1;
					phase = 'hinting';
					io.emit('message', {
						type: 'system',
						text: `Hinting phase started. ${(turn == 1) ? 'Red' : 'Blue'} Spymaster has 60 seconds to hint a word.`
					});
					io.emit('startTimer', 20);
					votes = [];
					hints = {};
				} else {
					switch (phase) {
						case 'hinting': 				// hinting just ended
							if (Object.keys(hint).length === 0) { // no hint, switch teams
								io.emit('message', {
									type: 'system',
									text: `No hint has been received from ${(turn == 1) ? 'Red' : 'Blue'} team. Switching turns to ${(!(turn == 1)) ? 'Red' : 'Blue'} Team.`
								});
								swapTeams = true;
								io.emit('startTimer', 0);
								break;
							}
							phase = 'guessing'; 		// next phase: guessing
							io.emit('gameState', {
								type: 'hint',
								info: hint['word']
							});
							io.emit('message', {
								type: 'system',
								text: `The current hint is: ${hint['word']} for ${hint['num']} tile(s). ${(turn == 1) ? 'Red' : 'Blue'} Agents have 60 seconds to guess words.`
							});
							votes = [];					// guessing phase next, reset votes
							io.emit('startTimer', 20);
							break;

						case 'guessing':
							if (Object.keys(votes).length === 0) { // no hint, switch teams
								io.emit('message', {
									type: 'system',
									text: `No hint has been received from ${(turn == 1) ? 'Red' : 'Blue'} team. Switching turns to ${(!(turn == 1)) ? 'Red' : 'Blue'} Team.`
								});
								swapTeams = true;
								io.emit('startTimer', 0);
								break;
							}
							phase = 'hinting';
							getVoteMajority();
							if (guessCorrect) {
								io.emit('startTimer', 0);
								break;
							}
							io.emit('message', {
								type: 'system',
								text: `Hinting phase started. ${(turn == 1) ? 'Red' : 'Blue'} Spymaster has 60 seconds to hint a word.`
							});
							io.emit('startTimer', 20);
							hint = {};					// hinting phase next, reset hint
							break;
					}
				}
			}
		}
		numTimers = 0;
	}
}

function endGame() {
	messages = [];
	votes = [];
	words = {};
	hint = {};
	var turn = 0;
	var phase;
	var numTimers;
	var numChecks;
	var timer;
	gameInit = true;
	guessCorrect = false;
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
		var word = votes[i]['word'];
		typeof temp[word] === 'undefined' ? temp[word] = 1 : temp[word]++;
	}
	var vote = Object.keys(temp).reduce(function(a, b) { return temp[a] > temp[b] ? a : b });
	io.emit('message', {
		type: 'system',
		text: `The highest voted word is "${vote}"`
	});
	validateVote(vote);
}

function validateVote(vote) { // gets word and checks if it is right or wrong

	// if assassin, lose
	// if right, check if the team has won
	// if wrong, send back object -> {word: (String), correct: (bool)}

	if (words[vote]['team'] == 3) { // vote was the assassin,
		if (turn == 1) {
			io.emit('gameState', {
				type: 'end',
				info: {
					word: vote,
					winner: 2,
					wordTeam: 3,
					turn: turn
				}
			});
		} else {
			io.emit('gameState', {
				type: 'end',
				info: {
					word: vote,
					winner: 1,
					wordTeam: 3,
					turn: turn
				}
			});
		}
		io.emit('message', {
			type: 'system',
			text: `"${vote}" was the assassin! Team ${(turn == 1) ? 'Blue' : 'Red'} wins!`
		});
	}

	if (words[vote]['team'] == turn) { // team's vote is correct
		if (checkWinCondition()) { // checked if team won
			io.emit('gameState', {
				type: 'end',
				info: {
					word: vote,
					winner: turn,
					turn: turn,
					wordTeam: words[vote]['team']
				}
			});
			io.emit('message', {
				type: 'system',
				text: `"${vote}" was correct. Team ${(turn == 1) ? 'Red' : 'Blue'} wins!`
			});
		} else { // team guessed correctly but has not won yet
			hint['num']--;

			if (hint['num'] == 0) { 	// the team is out of guesses
				turn = (turn == 1) ? 2 : 1;
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
				io.emit('message', {
					type: 'system',
					text: `"${vote}" was correct. Team ${(turn == 1) ? 'Blue' : 'Red'} is out of guesses. Switching teams...`
				});
			} else { 					// the team still has more guesses
				guessCorrect = true;
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
				io.emit('message', {
					type: 'system',
					text: `"${vote}" was correct. Team ${(turn == 1) ? 'Red' : 'Blue'} still has ${hint['num']} guesses left. Restarting timer...`
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
		});
		io.emit('message', {
			type: 'system',
			text: `"${vote}" was incorrect. Switching teams...`
		});
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
