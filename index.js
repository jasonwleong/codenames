var app = require('express')();
var http = require('http').Server(app);
var io = require('socket.io')(http);

var clients = [];
var messages = [];
var votes = [];

app.get('/', function(req, res) {
  res.sendFile(__dirname + '/index.html');
});

io.on('connection', function(socket) {

	var nickname;

	// receive connections
	socket.on('newUser', function(nick) {

		// Get user's nickname and add him to clients array
		nickname = nick;
		console.log(`Connection: ${socket.id} \t as ${nickname}`);
		clients.push({
			id:socket.id,
			nickname:nickname,
			role:""
		});

		// Display previous messages
		for (var i = 0; i < messages.length; i++) {
			socket.emit(String(messages[i].type), messages[i].message);
		}

		// Display connection message
		var message = nickname + ' connected';
		io.emit('connectAndDisconnect', message);
		messages.push({
			message:message,
			type:'connectAndDisconnect'
		});
		console.log(clients);
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
			message:message,
			type:'connectAndDisconnect'
		});
		console.log(clients);
	});

	// receive chat messages
	socket.on('chat message', function(msg) {
		// refactor later -> add disallowing of messages that are all spaces
		var message = nickname + ": " + msg;
		io.emit('chat message', message);
		messages.push({
			message:message,
			type:'chat message'
		});
	});

	// receive command messages
	socket.on('command', function(msg) {	// msg = "/vote Dinosaur"
		msg = msg.split(' ');				// msg = ["/vote", "Dinosaur"]
		var message = nickname + " ";
		switch(msg[0].substring(1)) {		// switch sttement for "vote"
			case 'vote':
				message += 'has voted for "' + msg[1] + '"';
				break;
			case 'hint':
				message += 'has hinted the word: "' + msg[1] + '"';
				break;
			default:
				socket.emit('server message', 'invalid command: "' + msg[0].substring(1) + '"'; // sent only to client
				return;
		}
		io.emit('command', message);
		messages.push({
			message:message,
			type:'command'
		});
	});
});

http.listen(3000, function() {
  console.log('listening on *:3000');
});