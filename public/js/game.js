// while(!nick) {                              // require a nickname
    // var nick = prompt('Enter a nickname:', 'Onipy'); 
nick = "test-user";
// }

$(function () {
    var socket = io();
    socket.emit('newUser', nick);           // set nickname in server
    $('form').submit(function(e) {
        e.preventDefault();
        if ($('#user-input').val()[0] == "/") {      // Message is a command
            
            socket.emit('command', $('#user-input').val());
        }
        else {                              // Message is a chat message
            socket.emit('chat', $('#user-input').val());
        }
        $('#user-input').val('');                    // reset message value
        return false;
    });
    // \/ FROM SERVER \/
    // get client-side messages from server
    socket.on('client', function(msg) {
        $('#messages').append($('<li style="font-style:italic;color:purple;">').text(msg));
    });
    // get connect/disconnect messages
    socket.on('server', function(msg) {
        $('#messages').append($('<li style="font-style:italic;color:red;">').text(msg));
    });
    // get chat messages
    socket.on('chat', function(msg) {
        $('#messages').append($('<li>').text(msg));
    });
    // get command messages
    socket.on('command', function(msg) {
        $('#messages').append($('<li style="font-style:italic;color:green;">').text(msg));
    });
});
