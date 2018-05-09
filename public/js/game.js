var nick;
var GAME_STATE; // {messages: [], votes: [], words: [], solution: [], players: [], turn: 0}

// nick = prompt("Please enter a nickname below: \n\n" + getGameRules(), 'Onipy');     // require a nickname
while (!nick) {
    // FIXME @jleong: check for names that exist - async false should solve problem
    // $.get('api/clients/names', function(data, status) {
    //     console.log(nick);
    //     console.log(data);
    //     console.log(data.includes(nick));
    //     if (data.includes(nick)) {
    //         nick = prompt(`${nick} is already used! Please enter a new name:`);
    //     }
    // });
    nick = prompt("Please enter a nickname below: \n" + getGameRules(), 'Onipy');      // temp
}

// var tempBoard = [ { word: 'cook', team: 2, revealed: 0 },
//   { word: 'deck', team: 1, revealed: 0 },
//   { word: 'aztec', team: 0, revealed: 0 },
//   { word: 'ninja', team: 2, revealed: 0 },
//   { word: 'ray', team: 0, revealed: 0 },
//   { word: 'engine', team: 1, revealed: 0 },
//   { word: 'teacher', team: 3, revealed: 0 },
//   { word: 'thumb', team: 0, revealed: 0 },
//   { word: 'hospital', team: 2, revealed: 0 },
//   { word: 'strike', team: 0, revealed: 0 },
//   { word: 'eagle', team: 0, revealed: 0 },
//   { word: 'olympus', team: 1, revealed: 0 },
//   { word: 'ring', team: 1, revealed: 0 },
//   { word: 'scientist', team: 1, revealed: 0 },
//   { word: 'pool', team: 2, revealed: 0 },
//   { word: 'pin', team: 1, revealed: 0 },
//   { word: 'antarctica', team: 2, revealed: 0 },
//   { word: 'roulette', team: 2, revealed: 0 },
//   { word: 'witch', team: 2, revealed: 0 },
//   { word: 'skyscraper', team: 1, revealed: 0 },
//   { word: 'lion', team: 0, revealed: 0 },
//   { word: 'dog', team: 0, revealed: 0 },
//   { word: 'web', team: 1, revealed: 0 },
//   { word: 'berlin', team: 1, revealed: 0 },
//   { word: 'cell', team: 2, revealed: 0 } ]

// CLIENT GAME LOGIC (and interactions with server)
$(function () {
    var socket = io();
    GAME_STATE = newGameData();
    socket.emit('newUser', nick);

    // Player sends a chat message/command
    $('#user-input-form').submit(function(e) {
        e.preventDefault();
        const input = $('#user-input').val();
        const type = (input[0] == "/") ? "command" : "chat";
        const msg = {type: type};
        var text;
        if (type == "command") {
            const inputs = input.slice(1, input.length).split(' ');
            const cmdType = inputs[0];
            switch (cmdType) {
                case 'help':
                    const helpMsgs = getHelpMsgs();
                    for (var i = 0; i < helpMsgs.length; i++) {
                        chatMessage(helpMsgs[i], 'system');
                    }
                    return clearChatAndEndForm();
                case 'turn':
                    chatMessage(`It is currently ${GAME_STATE['turn'] == 1 ? 'red': 'blue'} team's turn.`, 'system');
                    return clearChatAndEndForm();
                case 'vote':
                    if (inputs.length != 2) {
                        chatMessage('Usage: "/vote [word]". Type "/help" for more info.', 'error');
                        return clearChatAndEndForm();
                    }
                    text = inputs[1];
                    break;
                case 'hint':
                    if (inputs.length != 3 || (isNaN(inputs[2]))) {
                        chatMessage('Usage: "/hint [word] [number]". Type "/help" for more info.', 'error');
                        return clearChatAndEndForm();
                    }
                    text = inputs[1] + ' ' + inputs[2];
                    break;
            }
            Object.assign(msg, {text: text, cmdType: cmdType});
        } else {  // chat - send user input as is
            Object.assign(msg, {text: input});
        }

        socket.emit('message', msg);
        return clearChatAndEndForm();
    });

    socket.on('newUser', function(id) {
        GAME_STATE['id'] = id;
        console.log('my id: ' + id);
    });

    // Handling server emission/responses
    socket.on('clients', function(clients) {    // event: clients - number of clients has changed
        GAME_STATE['players'] = clients;
        clearPlayers();
        for (var i = 0; i < GAME_STATE['players'].length; i++) {
            var player = GAME_STATE['players'][i];
            if (player['id'] == GAME_STATE['id']) {
                // show myself
                $('#player-me').append(`<p id="${player['id']}" class="player-row ${player['team'] == 1 ? 'red': 'blue'}">
                                            <span class="name">${player['nickname']}</span>
                                            <span class="role">[${player['role']}]</span>
                                            <input id="ready-check" onclick="sendReady(this)" type="checkbox">
                                            <label for="ready-check"> Ready: </label>
                                        </p>`);
            } else { // show other players
                showPlayer(GAME_STATE['players'][i]);
            }
        }
    });

    socket.on('message', function(msg) {        // event: message - server has a new system message or client chat
        chatMessage(msg['text'], msg['type']);
    });

    socket.on('newGame', function(initGameData) {           // event: newGame - server response for all clients are ready -> starting a new game
        // remove ready form checkbox
        // check if spymaster? or just catch server's 'key' emit
        // clean data (start new game)
        newGame();
        GAME_STATE['board'] = initGameData['board'];
        if  (initGameData.includes('key')) {
            GAME_STATE['key'] = initGameData['key'];
        }
        createBoard(initGameData['board']);
    });

    socket.on('startTimer', function(seconds) {
        startNewTimer(seconds);
        if (!GAME_STATE['running'] & GAME_STATE['time'] < 0) {
            socekt.emit('nextPhaseReady');
        }
    });

    socket.on('gameState', function(state) {
        console.log(state);
        // if (state['info']['correct']) {
        updateBoardImmediate($(`#word-${state['info']['word']}`, state['info']['wordTeam'], 1));
        GAME_STATE['turn'] = state['info']['turn'];
        // }
        if (state['type'] == 'end') {
            var winner = (state['info']['winner'] == 1) ? 'Red': 'Blue'
            chatMessage(`${winner} team wins! Thanks for playing!`, 'system');
        }
    });
});


// DISPLAY METHODS
function clearPlayers() {
    $('#players').html('');                 // remove current players
    $('#player-me').html('');       // remove self
    // createBoard(tempBoard);                 // FIXME: REMOVE TO USE IN FLOW PROPERLY
}

function chatMessage(msgText, type) {
    $('#messages').append($(`<li class="${type}">`).text(msgText));
}

function createBoard(board) {
    // intended to be called only once, when entire board data is sent over
    var word;
    var wordEl;
    for (var i = 0; i < board.length; i++) {
        word = board[i];                                                    // word data from board from server
        wordEl = $(`.word-${i}`);                                           // grab the word button on board
        wordEl.val(word['word']);                                           // edit word's value (text)
        wordEl.attr('id', `word-${word['word']}`);                          // update word's id
        updateBoardImmediate(wordEl, word['team'], word['revealed']);       // update word's color
    }
}

function showPlayer(player) {
     $('#players').append(`<li id="${player['id']}" class="player ${player['team'] == 1 ? 'red': 'blue'}">
                                <span class="name">${player['nickname']}</span>
                                <span class="role">[${player['role']}]</span>
                            </li>`);
}

function showScore() {
    // calculate by counting values on board
}

// GAME METHODS - requires usage of GAME_STATE variables
function newGame() {
    GAME_STATE = newGameData();
}

function sendReady(checkbox) {
    console.log({id: GAME_STATE['id'], ready: checkbox.checked});
    $.post('api/clients', {id: GAME_STATE['id'], ready: checkbox.checked}, function(data, status, res) {
        console.log(data);
    });
    console.log('sendReady complete');
    // socket.emit('readyGame', checkbox.checked)
}

function updateBoard(word) {
    // word: {word: string word, team: team own, revealed: if word was touched}
    $(`#word-${word['word']}`).attr("color", `team-${word['team']}-${word['revealed']}`);
}

function updateBoardImmediate(element, team, revealed) {
    // updates word on board with a given jquery element
    element.attr("color", `team-${team}-${revealed}`);
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

function getGameRules() {
    //return getHelpMsgs().join(' ');
    return "How-To-Play:\n" +
            "Codenames is a guessing board game that is designed to be played with 4-8 players. Initially, players split into two different teams, either red or blue, and "  +
            "each team designates a spymaster. In front of everyone is a 5x5 grid board with a random noun placed on each of the tiles. The spymasters are then each given the " +
            "same 5x5 grid 'solution' card that has differently colored tiles which directly correspond to the words on the board: red (9 tiles), blue (8 tiles), beige (7 tiles), " +
            "and black (1 tile), which represent the red agents, blue agents, bystanders, and assassins. The goal of the game is for the spymasters to get their team to guess all " +
            "words that have their team’s respective colors on it. Every turn, the spymaster can give a one-word hint along with a number n. The teammates will then discuss decide " +
            "on which words to pick, up to n + 1 words.\n\n" +
            "Additional Notes:\n" +
            "The beige tiles are duds and choosing it will immediately end your teams turn. Choosing the black tile will instantly lose your team the game." +
            "The hint can be any one word as long as it is not one of the words on the board. The number n represents the number of words on the board the " +
            "hint is related to and also limits your team to picking n + 1 words. The red team will always go first, which means that they need to guess an additional tile.\n"
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
        board: [].
        running: false,
        socket: null,
        id: null,
        turn: 1}        // red: 1, blue: 2
}
