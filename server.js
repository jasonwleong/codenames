var express = require('express')
var app = express();
var http = require('http').Server(app);
var io = require('socket.io')(http);
var path = require('path')
// var fs = require('fs');

// Variables
var clients = [];
var messages = [];
var votes = [];
var hint;	// current hint
var turn;	// current turn in game

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
		clients.push({
			id: socket.id,
			nickname: nickname,
			role: "",
			team: ""
		});

		// Display previous messages
		for (var i = 0; i < messages.length; i++) {
			socket.emit(String(messages[i].type), messages[i].message);
		}

		// Display connection message
		var message = nickname + ' connected';
		io.emit('message', {
			type: 'server',
			text: message
		});
		messages.push({
			message: message,
			type: 'message'
		});
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
		var message = nickname + ' disconnected';
		io.emit('message', {
			type: 'server',
			text: message
		});
		messages.push({
			message: message,
			type: 'message'
		});
	});

	// TODO @pat: keep
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
						for (var i = 0; i < clients.length; i++) {
							if (clients[i].id == socket.id) {
								if (clients[i].role == 'spymaster') {
									socket.emit('message', {
										type: 'error',
										text: 'The Spymaster may not vote.'
									});
									return;
								}
								break; // id found, not spymaster, break out of for loop
							}
						}

						// check if vote exists in game board
						// if (vote in dictionary) {
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
								type: 'server',
								text: `${nickname} has voted for "${inputs[1]}"`
							});
						// } else {
						// 	socket.emit('message', {
						// 		type: 'error',
						// 		text: `invalid vote: "${inputs[1]}" does not exist on the board`
						// 	});
						// 	return;
						// }
						break;

						
					case 'hint':

						// if user is not spymaster, send error
						for (var i = 0; i < clients.length; i++) {
							if (clients[i].id == socket.id) {
								if (clients[i].role != 'spymaster') {
									socket.emit('message', {
										type: 'error',
										text: 'Only the Spymaster is allowed to send a hint.'
									});
									return;
								}
								break; // id found, not spymaster, break out of for loop
							}
						}
						// check if hint exists in dictionary of words
						// if (hint in dictionary) {
							hint = inputs[1];
							Object.assign(response, {
								type: 'server',
								text: `${nickname} has hinted the word "${hint}"`
							});
						// } else {
						// 	socket.emit('message', `invalid hint: "${inputs[1]}" not found in dictionary`);
						// 	return;
						// }
						break;

					default:
						socket.emit('message', {
							type: 'error',
							text: `invalid command: "${msg[0]}"`; // sent only to client
						});
						return;
				}
			case 'chat':
				Object.assing(response, {
					type: 'chat',
					text: `${nickname}: ${msg['text']}`
				});

			default:
				return;
		}
		// do this regardless
		messages.push(msg);
		io.emit('message', response);
	});
});

// Runner
http.listen(3000, "0.0.0.0", function() {
  	console.log('listening on *:3000');
});