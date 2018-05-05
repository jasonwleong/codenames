var app = require('express')();
var http = require('http').Server(app);
var io = require('socket.io')(http);

var clients = [];
var messages = [];
var votes = [];
var hint;

app.get('/', function(req, res) {
  res.sendFile(__dirname + '/index.html');
});


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
			role: ""
		});

		// Display previous messages
		for (var i = 0; i < messages.length; i++) {
			socket.emit(String(messages[i].type), messages[i].message);
		}

		// Display connection message
		var message = nickname + ' connected';
		io.emit('connectAndDisconnect', message);
		messages.push({
			message: message,
			type: 'connectAndDisconnect'
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
		io.emit('connectAndDisconnect', message);
		messages.push({
			message: message,
			type: 'connectAndDisconnect'
		});
	});

	// receive chat messages
	socket.on('chat message', function(msg) {
		// refactor later -> add disallowing of messages that are all spaces
		var message = nickname + ": " + msg;
		io.emit('chat message', message);
		messages.push({
			message: message,
			type: 'chat message'
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
					socket.emit('server message', `invalid command: "${msg[0].substring(1)}" requires 1 argument`);
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
				// 	socket.emit('server message', `invalid vote: "${msg[1]}" not found in dictionary`);
				// 	return;
				// }
				break;

			case 'hint':
				// check if client is of role "spymaster" (refactor later -> make clients into dictionary)
				for (var i = 0; i < clients.length; i++) {
					if (clients[i].id == socket.id) {
						if (clients[i].role != "spymaster") {
							socket.emit('server message', `invalid command: you are not the spymaster`);
							return;
						}
						break; // breaks out of for loop, not case statement
					}
				}

				// check # params
				if (msg.length != 2) {
					socket.emit('server message', `invalid command: "${msg[0].substring(1)}" requires 1 argument`);
					return;
				}

				// check if hint exists in dictionary of words
				// if (hint in dictionary) {
					hint = msg[1];
					message += `has hinted the word: "${msg[1]}"`;
				// } else {
				// 	socket.emit('server message', `invalid hint: "${msg[1]}" not found in dictionary`);
				// 	return;
				// }
				// break;


			default:
				socket.emit('server message', `invalid command: "${msg[0].substring(1)}"`); // sent only to client
				return;
		}
		io.emit('command', message);
		messages.push({
			message: message,
			type: 'command'
		});
	});
});

http.listen(3000, function() {
  console.log('listening on *:3000');
});