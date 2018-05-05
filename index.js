var app = require('express')();
var http = require('http').Server(app);
var io = require('socket.io')(http);

var clients = [];
var messages = [];

app.get('/', function(req, res) {
  res.sendFile(__dirname + '/index.html');
});

io.on('connection', function(socket) {

	var nickname;

	socket.on('newUser', function(nick) {

		// Get user's nickname and add him to clients array
		nickname = nick;
		console.log(`Connection: ${socket.id} \t as ${nickname}`);
		// clients.push({
		// 	id:socket.id,
		// 	nickname:nickname
		// });

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
	});

	socket.on('disconnect', function() {

		console.log(`Disconnected: ${socket.id} \t (${nickname})`);

		// Display disconnection message
		var message = nickname + ' disconnected';
		io.emit('connectAndDisconnect', message);
		messages.push({
			message:message,
			type:'connectAndDisconnect'
		});
	});

	socket.on('chat message', function(msg) {
		if (msg != "") {
			var message = nickname + ": " + msg;
			io.emit('chat message', message);
		messages.push({
			message:message,
			type:'chat message'
		});
		}
	});
});

http.listen(3000, function() {
  console.log('listening on *:3000');
});