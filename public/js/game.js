// while(!nick) {                              // require a nickname
    // var nick = prompt('Enter a nickname:', 'Onipy');
    var nick = "hi";
// }
// clean up? rename or make error messages red?
var systemMessages = ['system', 'server'];

$(function () {
    var socket = io();
    socket.emit('newUser', nick);           // set nickname in server
    document.getElementById('#')
    $('#user-input-form').submit(function(e) {
        e.preventDefault();
        const input = $('#user-input').val();
        const type = (input[0] == "/") ? "command" : "chat";
        const msg = {type: type};
        // TODO: FIX COMMAND PARSING
        if (type == "command") {
            const inputs = input.slice(1, input.length).split(' ');
            const cmdType = inputs[0];
            if (cmdType == 'help') {
                const helpMsgs = getHelpMsgs();
                for (var i = 0; i < helpMsgs.length; i++) {
                    chatMessage(helpMsgs[i], 'system');
                }
                return clearChatAndEndForm();
            }
            else {
                if (inputs.length > 2) {
                    chatMessage('/vote and /hint commands take one [word] paramater. Type "/help" for more info.', 'error');
                    return clearChatAndEndForm();
                }
                const word = inputs[1];
                Object.assign(msg, {text: word, cmdType: cmdType});
            }
        } else {  // chat - send user input as is
            Object.assign(msg, {text: input});
        }

        socket.emit('message', msg); 
        return clearChatAndEndForm()
    });

    // Handling server emission/responses
    socket.on('newPlayer', function(player) {
        // check if game is running
        console.log(player);
        const playerRow = `<li class="player ${player['team']}">
                                <span class="name">${player['nickname']}</span> 
                                <input class="ready-check" type="checkbox">
                            </li>`
        $('#players').append(playerRow);
    })
    socket.on('message', function(msg) {
        chatMessage(msg['text'], msg['type']);
    });

});

function chatMessage(msgText, type) {
    $('#messages').append($(`<li class="${type}">`).text(msgText));
}

function clearChatAndEndForm() {
    $('#user-input').val('');           // clear message value
    return false;                       // check if this is needed
}

function getHelpMsgs() {
    // this may or may not actually show in 2 lines in chat
    return ["/vote [word] : Players(excluding the Spymaster) may use /vote to vote for the word that they want to guess\n",
            "/hint [word] : Spymaster may use the /hint command to send their hint to their team\n",
            "/help : Instantly wins the game for you and your team\n"];
}

