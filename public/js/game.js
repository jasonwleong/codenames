// while(!nick) {                              // require a nickname
    // var nick = prompt('Enter a nickname:', 'Onipy');
    var nick = "hello";
// }

$(function () {
    var socket = io();
    socket.emit('newUser', nick);           // set nickname in server
    $('form').submit(function(e) {
        e.preventDefault();
        var type = ($('#user-input').val()[0] == "/") ? "command" : "chat";
        socket.emit('message', {text: $('#user-input').val(), type: type});
        $('#user-input').val('');           // clear message value
        return false;                       // check if this is needed
    });
    // \/ FROM SERVER \/
    // TODO @jleong: clean up once server is updated
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
