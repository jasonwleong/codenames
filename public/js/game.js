// while(!nick) {                              // require a nickname
    // var nick = prompt('Enter a nickname:', 'Onipy');
    var nick = "hi";
// }
// clean up? rename or make error messages red?
var clientOnlyMessages = ['error', 'server', 'players', 'help'];

$(function () {
    var socket = io();
    socket.emit('newUser', nick);           // set nickname in server
    $('form').submit(function(e) {
        e.preventDefault();
        const input = $('#user-input').val();
        const type = (input[0] == "/") ? "command" : "chat";
        const msg = {type: type};
        if (type == "command") {
            const spaceIndex = input.indexOf(' ');
            const cmdType = input.slice(1, spaceIndex);
            const text = input.slice(spaceIndex, input.length);
            if (clientOnlyMessages.includes(cmdType)) {
                chatMessage((cmdType == 'help') ? getHelpMsg() : text);
            } else {
                Object.assign(msg, {text: text, cmdType: cmdType});
            }
        } else {  // chat - send user input as is
            Object.assign(msg, {text: input});
        }
        socket.emit('message', msg); 
        $('#user-input').val('');           // clear message value
        return false;                       // check if this is needed
    });
    // \/ FROM SERVER \/
    // TODO @jleong: clean up once server is updated
    // get client-side messages from server

    // socket.on('client', function(msg) {
    //     $('#messages').append($('<li style="font-style:italic;color:purple;">').text(msg));
    // });
    // // get connect/disconnect messages
    // socket.on('server', function(msg) {
    //     $('#messages').append($('<li style="font-style:italic;color:red;">').text(msg));
    // });
    // // get chat messages
    // socket.on('chat', function(msg) {
        
    // });
    // // get command messages
    // socket.on('command', function(msg) {
    //     $('#messages').append($('<li style="font-style:italic;color:green;">').text(msg));
    // });

    // Handling server responses
    socket.on('message', function(msg) {
        chatMessage(msg['text'], msg['type']);
    })

});

function chatMessage(msgText, type) {
    var cName = ''; 
    if (!(type === undefined)) {
        cName = (type === "error") ? "error" : "client";
    }
    $('#messages').append($(`<li class="${cName}">`).text(msgText));
}

function getHelpMsg() {
    // this may or may not actually show in 2 lines in chat
    return "/vote [word] : Players(excluding the Spymaster) may use /vote to vote for the word that they want to guess\n" +
            "/hint [word] : Spymaster may use the /hint command to send their hint to their team\n" +
            "/players : Use /players to view the currently connected players\n" +
            "/help : Instantly wins the game for you and your team";
}

