var nick;
var GAME_STATE; // {messages: [], votes: [], words: [], solution: [], players: [], turn: 0}

nick = prompt("Please enter a nickname below: \n\n" + getGameRules(), 'Onipy');     // require a nickname
// var nick = new Promise(function(resolve, reject) {
//   resolve('Success!');
// });
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

// CLIENT GAME LOGIC (and interactions with server)
$(function () {
    var socket = io();
    GAME_STATE = newGameData();
    socket.emit('newUser', nick);
    setTimeout(function() {
        chatMessage('Click the "Ready?" checkbox to queue for a game to start!', 'system');
    }, 1000);
    setTimeout(function() {
        chatMessage('You can always check the rules by clicking the "Game Rules" button or try typing "/help" for more information.', 'system');
    }, 3000);
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
                default:
                    chatMessage(`/${cmdType} is not a valid command! Read "/help" to see a list of possible commands.`, 'error');
                    return clearChatAndEndForm();
            }
            Object.assign(msg, {text: text, cmdType: cmdType});
        } else {  // chat - send user input as is
            Object.assign(msg, {text: input});
        }

        socket.emit('message', msg);
        return clearChatAndEndForm();
    });
    $('.word').click(function() {
        socket.emit('message', {type: 'command', cmdType: 'vote', text: $(this).val()});
    });

    socket.on('userID', function(id) {
        GAME_STATE['id'] = id;
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
                                        </p>`);
                showPlayerReady();
            } else { // show other players
                showPlayer(GAME_STATE['players'][i]);
            }
        }
    });

    socket.on('votes', function(votes) {
        GAME_STATE['votes'] = votes;
        clearVotes();
        for (var i = 0; i < votes.length; i ++) {
            showVote(votes[i]);
        }
    });

    socket.on('message', function(msg) {        // event: message - server has a new system message or client chat
        chatMessage(msg['text'], msg['type']);
    });

    socket.on('newGame', function(initGameData) {           // event: newGame - server response for all clients are ready -> starting a new game
        GAME_STATE = newGameData();                         // new data for client
        GAME_STATE['id'] = initGameData['id']               // set client's id (socket)
        GAME_STATE['role'] = initGameData['role'];          // set client's role
        GAME_STATE['board'] = initGameData['board'];        // set client's board (same for everyone)
        if  (initGameData.hasOwnProperty('key')) {
            GAME_STATE['key'] = initGameData['key'];
            createBoard(initGameData['key']);
        } else {
            createBoard(initGameData['board']);
        }
        clearPlayerReady();
    });

    socket.on('startTimer', function(seconds) {
        clearVotes();
        startNewTimer(socket, seconds);
    });

    socket.on('gameState', function(state) {
        updateBoard({word: state['info']['word'], team: state['info']['wordTeam'], revealed: 1});
        GAME_STATE['scores'][state['info']['wordTeam']]++;
        GAME_STATE['turn'] = state['info']['turn'];
        if (state['type'] == 'end') {
            stopTimerAndWait();
            var winner = (state['info']['winner'] == 1) ? 'Red': 'Blue'
            chatMessage(`${winner} team wins! Thanks for playing!`, 'system');
            setTimeout(function() {
                chatMessage('If you would like to player another game, you can click the "Ready?" checkbox to join an active lobby waiting for a game to start.', 'system');
                showPlayerReady();
            }, 1000)
        }
        showScores();
    });

    // regular document ready functions
    // $('#search-form').submit(function(e) {
    //     e.preventDefault();
    //     $('search-results').html('')        // clean up results
    //     var search = $("#search-input").val();
    //     $.get('/api/dictionary/?' + search.val(), function (req, status, res) {
    //         for (var i = 0; i < res.length; i++) {
    //             showDictionaryEntry(res[i]);
    //         }
    //     });
    // }
});

// DISPLAY METHODS
function clearPlayers() {
    $('#players').html('');             // remove current players
    $('#player-me').html('');           // remove self
}

function clearPlayerReady() {
    $('.ready-check').remove();         // remove ready checkbox and label
}

function clearVotes() {
    $("#votes").html('');               // remove votes section
}

function chatMessage(msgText, type) {
    // creates and appends a new message to the chatbox. CSS will  handle the different stylings of each message based on
    // the message 'type', which is used as a class in the list element tag.
    $('#messages').append($(`<li class="${type}">`).text(msgText));
    var chat = document.getElementById('chat-history');
    chat.scrollTop = chat.scrollHeight;
}

function createBoard(board) {
    // intended to be called only once, when initial board data is sent over
    var word;
    var wordEl;
    for (var i = 0; i < board.length; i++) {
        word = board[i];                                                    // word data from board from server
        wordEl = $(`.word-${i}`);                                           // grab the word button on board
        wordEl.val(word['word']);                                           // edit word's value (text)
        wordEl.attr('id', `word-${word['word']}`);                          // update word's id
        updateBoardImmediate(wordEl, word['team'], word['revealed']);       // update word's color (should only affect spymasters)
    }
}

// function showDictionaryEntry(word) {
//     $('search-results').append(`<p id=dict-${word}>${word}<p>`)
// }

function showPlayer(player) {
     $('#players').append(`<p id="${player['id']}" class="player-row ${player['team'] == 1 ? 'red': 'blue'}">
                                <span class="name">${player['nickname']}</span>
                                <span class="role">[${player['role']}]</span>
                            </p>`);
}

function showPlayerReady() {
    $('#player-me span.role').append(`<input id="ready-check" class="ready-check" onclick="sendReady(this)" type="checkbox">
                                      <label for="ready-check" class="ready-check">Ready?</label>`);
}

function showScores() {
    $('#red-score').html(`${GAME_STATE['scores'][1]} / 9`);
    $('#blue-score').html(`${GAME_STATE['scores'][2]} / 8`);
}

function showVote(vote) {
    $('#votes').append(`<p id="${vote['nickname']}-vote" class="vote-row ${vote['turn'] == 1 ? 'red': 'blue'}">
                            <span class="vote-player">${vote['nickname']}:</span>
                            <span class="vote-word">${vote['word']}</span>
                        </p>`);
}

// GAME METHODS - usually requires usage/read of GAME_STATE data
function disconnect(refresh) {
    var dc = confirm('Are you sure you want to leave? If there less than four players remain in an ongoing game, the game will end for everyone!');
    refresh ? location.reload() : open(location, '_self').close();
}

function updateBoard(word) {
    // word: {word: string word, team: team own, revealed: if word was touched}
    if (GAME_STATE['role'] == 'spymaster') {
        $(`#word-${word['word']}`).attr("color", `team-${word['team']}-${word['revealed']}`);
    } else {
        $(`#word-${word['word']}`).attr("color", `team-${word['team']}-0`);
    }
}

function updateBoardImmediate(element, team, revealed) {
    // updates word on board with a given jquery element
    element.attr("color", `team-${team}-${revealed}`);
}

function sendReady(checkbox) {
    $.post('api/clients', {id: GAME_STATE['id'], ready: checkbox.checked}, function(data, status, res) {
        if (status == 400) {
            chatMessage(res, 'error')
        }
    });
}

function startNewTimer(socket, time) {          // socket to ping server to continue game logic, time in seconds
    clearInterval(GAME_STATE['timer']);
    GAME_STATE['timer'] = setInterval(function() {
        GAME_STATE['running'] = true;
        document.getElementById("time").innerHTML = "Time: " + time + "s";
        if (time < 0) {
            stopTimerAndWait();
            socket.emit('nextPhaseReady');
        }
        time--;
        GAME_STATE['time'] = time;
    }, 1000);
    return GAME_STATE['timer'];
}

function stopTimerAndWait() {
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
    return ["/help : Displays this message. Click 'Game Rules' for more information.\n",
            "/turn : Displays a message telling which team's turn/phase it currently is.\n",
            "/vote [word] : Agents (not Spymasters) may use /vote to vote for the word that they want to guess.\n",
            "/hint [word] [number] : Spymaster may use the /hint command to send their hint to their team.\n"];
}

function newGameData() {
    // creates a new "game state" with empty values
    return { messages: [],
        votes: [],
        words: {},      // state of the board
        players: [],    // server's "clients"
        board: [],
        scores: {0: 0, 1: 0, 2: 0, 3: 0},
        running: false,
        socket: null,
        id: null,
        turn: 1}        // red: 1, blue: 2
}

// UX FEATURES

// disable zoom from https://stackoverflow.com/questions/27116221/prevent-zoom-cross-browser
$(document).keydown(function(event) {
if (event.ctrlKey==true && (event.which == '61' || event.which == '107' || event.which == '173' || event.which == '109'  || event.which == '187'  || event.which == '189'  ) ) {
        event.preventDefault();
     }
    // 107 Num Key  +
    // 109 Num Key  -
    // 173 Min Key  hyphen/underscor Hey
    // 61 Plus key  +/= key
});

$(window).bind('mousewheel DOMMouseScroll', function (event) {
       if (event.ctrlKey == true) {
       event.preventDefault();
       }
});
