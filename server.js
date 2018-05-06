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
		io.emit('server', message);
		messages.push({
			message: message,
			type: 'server'
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
		io.emit('server', message);
		messages.push({
			message: message,
			type: 'server'
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
				
					case 'hint':
					default:
						socket.emit('client', `invalid command: "${msg[0].substring(1)}"`); // sent only to client
						return;
				}
			case 'chat':

			default:
				return;
		}
		// do this regardless
		messages.push(msg);
		socket.emit('message', response);
	});

	// TODO @pat: clean up stuff below

	// receive chats
	socket.on('chat', function(msg) {
		// refactor later -> add disallowing of messages that are all spaces
		var message = nickname + ": " + msg;
		io.emit('chat', message);
		messages.push({
			message: message,
			type: 'chat'
		});
	});

	// receive command messages
	socket.on('command', function(msg) {	// msg => "/vote Dinosaur"
		msg = msg.split(' ');				// msg => ["/vote", "Dinosaur"]
		var message = nickname + " ";
		switch(msg[0].substring(1)) {		// switch statement for "vote"

			case 'vote':
				// check # params
				if (msg.length != 2) {
					socket.emit('client', `invalid command: "${msg[0].substring(1)}" requires 1 argument`);
					return;
				}

				// check if vote exists in dictionary of words
				// if (vote in dictionary) {
					message += `has voted for "${msg[1]}"`;
					votes.push({
						id: socket.id,
						nickname: nickname,
						word: msg[1]
					});
				// } else {
				// 	socket.emit('client', `invalid vote: "${msg[1]}" not found in dictionary`);
				// 	return;
				// }
				break;

			case 'hint':
				// check if client is of role "spymaster" (refactor later -> make clients into dictionary)
				for (var i = 0; i < clients.length; i++) {
					if (clients[i].id == socket.id) {
						if (clients[i].role != "spymaster") {
							socket.emit('client', `invalid command: you are not the spymaster`);
							return;
						}
						break; // breaks out of for loop, not case statement
					}
				}

				// check # params
				if (msg.length != 2) {
					socket.emit('client', `invalid command: "${msg[0].substring(1)}" requires 1 argument`);
					return;
				}

				// check if hint exists in dictionary of words
				// if (hint in dictionary) {
					hint = msg[1];
					message += `has hinted the word: "${msg[1]}"`;
				// } else {
				// 	socket.emit('client', `invalid hint: "${msg[1]}" not found in dictionary`);
				// 	return;
				// }
				// break;

			case 'players':
				if (msg.length > 1) {
					socket.emit('client', `invalid command: "${msg[0].substring(1)}" requires 0 arguments`);
					return;
				}
				for (var i = 0; i < clients.length; i++) { // ie. "[Red] Onipy (Spymaster)"
					socket.emit('client', `[${clients["team"]}] ${clients["nickname"]} (${clients["role"]})`);
				}
				return;

			case 'help':
				if (msg.length > 1) {
					socket.emit('client', `invalid command: "${msg[0].substring(1)}" requires 0 arguments`);
					return;
				}
				socket.emit('client', "/vote [word] : Players(excluding the Spymaster) may use /vote to vote for the word that they want to guess");
				socket.emit('client', "/hint [word] : Spymaster may use the /hint command to send their hint to their team");
				socket.emit('client', "/players : Use /players to view the currently connected players");
				socket.emit('client', "/help : Instantly wins the game for you and your team");
				return;


			default:
				socket.emit('client', `invalid command: "${msg[0].substring(1)}"`); // sent only to client
				return;
		}
		io.emit('command', message);
		messages.push({
			message: message,
			type: 'command'
		});
	});
});

// Runner
http.listen(3000, "0.0.0.0", function() {
  	console.log('listening on *:3000');
});