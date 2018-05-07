// while(!nick) {                              // require a nickname
    // var nick = prompt('Enter a nickname:', 'Onipy');
    var nick = "hi";
// }
// clean up? rename or make error messages red?
var systemMessages = ['system', 'server'];

var GAME_STATE; // {messages: [], votes: [], words: [], solution: [], players: [], turn: 0}

// CLIENT GAME LOGIC (and interactions with server)
$(function () {
    var socket = io();
    GAME_STATE = newGameData();
    socket.emit('newUser', nick);
    $('#user-input-form').submit(function(e) {
        e.preventDefault();
        const input = $('#user-input').val();
        const type = (input[0] == "/") ? "command" : "chat";
        const msg = {type: type};
        var text;
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
                switch (cmdType) {
                    case 'vote':
                        if (inputs.length != 2) {
                            chatMessage('Usage: "/vote [word]". Type "/help" for more info.', 'error');
                            return clearChatAndEndForm();
                        }
                        text = inputs[1];
                    case 'hint':
                        if (inputs.length != 3 || (isNaN(inputs[2]))) {
                            chatMessage('Usage: "/vote [word] [number]". Type "/help" for more info.', 'error');
                            return clearChatAndEndForm();
                        }
                        text = inputs[1] + ' ' + inputs[2];
                }
                Object.assign(msg, {text: text, cmdType: cmdType});
            }
        } else {  // chat - send user input as is
            Object.assign(msg, {text: input});
        }

        socket.emit('message', msg); 
        return clearChatAndEndForm()
    });

    socket.on('id', function(id) {
        GAME_STATE['id'] = id;
        console.log(id);
    });

    // Handling server emission/responses
    socket.on('clients', function(clients) {
        // check if game is running
        // const tempNumPlayers = GAME_STATE['players'].length
        // if (GAME_STATE['players'][player['id']] === undefined) {    // player isn't noted on client
        //     GAME_STATE['players'][player['id']] = player;
        // }
        // if (tempNumPlayers !== GAME_STATE['players'].length) {
        //     showPlayer(player);
        // }
        GAME_STATE['players'] = clients;
        $('#players').html('');                 // remove current list of players
        for (var i = 0; i < GAME_STATE['players'].length; i++) {
            var player = GAME_STATE['players'][i];
            if (player['id'] == GAME_STATE['id']) {
                // show myself
                $('#player-ready-form').append(`<span class="name">${player['nickname']}</span> 
                                            <span class="role">${player['role']}</span>
                                            <input class="ready-check" type="checkbox">`);
            } else {
                // show other players
                showPlayer(player[i]);
            }
        }
    });

    socket.on('message', function(msg) {
        chatMessage(msg['text'], msg['type']);
    });

    socket.on('newGame', function() {
        newGame();
    });
});


// DISPLAY METHODS
function chatMessage(msgText, type) {
    $('#messages').append($(`<li class="${type}">`).text(msgText));
}

function showPlayer(player) {
     $('#players').append(`<li class="player ${player['team']}">
                                <span class="name">${player['nickname']}</span> 
                                <span class="role">${player['role']}</span>
                            </li>`);
}

// GAME METHODS - requires usage of GAME_STATE variables
function newGame() {
    GAME_STATE = newGameData();
}

function updateBoard() {
    var board = $('word-board');
}

function startNewTimer(time) {          // time in seconds
    clearInterval(GAME_STATE['timer']);
    GAME_STATE['timer'] = setInterval(function() {
        GAME_STATE['running'] = true;
        document.getElementById("time").innerHTML = "Time: " + time + "s";
        if (time < 0) {
            stopTimerAndWait();
        }
        time--;
        GAME_STATE['time'] = time;
    }, 1000);
    return GAME_STATE['timer'];
}

function stopTimerAndWait(time) {
    clearInterval(GAME_STATE['timer']);
    GAME_STATE['time'] = 0;
    GAME_STATE['running'] = false;
    document.getElementById("time").innerHTML = "waiting...";
}

function voteWord(socket, word) {
    // use on click
    socket.emit('message', {type: 'command', cmdType: 'vote', text: word}); 
}

// HELPER METHODS
function clearChatAndEndForm() {
    $('#user-input').val('');           // clear message value
    return false;                       // check if this is needed
}

function getHelpMsgs() {
    // this may or may not actually show in 2 lines in chat
    return ["/vote [word] : Players(excluding the Spymaster) may use /vote to vote for the word that they want to guess\n",
            "/hint [word] [number] : Spymaster may use the /hint command to send their hint to their team\n",
            "/turn : Displays a message telling which team's turn/phase it currently is.\n",
            "/help : Instantly wins the game for you and your team\n"];
}

function newGameData() {
    // creates a new "game state" with empty values
    return { messages: [],
        votes: [],
        words: {},      // state of the board
        players: [],    // server's "clients"
        running: false,
        socket: null,
        phase: null,
        id: null,
        turn: 1}
}

function showGameRules() {
    alert(getHelpMsgs().join(' '));
}
