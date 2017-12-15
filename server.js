//
// Tic Tac Toe server using Socket.IO, Express, and Async.
//
var http = require('http');
var path = require('path');

// var async = require('async');
var socketio = require('socket.io');
var express = require('express');

//
// ## SimpleServer `SimpleServer(obj)`
//
// Creates a new instance of SimpleServer with the following options:
//  * `port` - The HTTP port to listen on. If `process.env.PORT` is set, _it overrides this value_.
//
var router = express();
var server = http.createServer(router);
var io = socketio.listen(server);

router.use(express.static(path.resolve(__dirname, 'client')));
var messages = [];
var sockets = [];
var games = [];
var GameID = 1;


io.on('connection', (socket) => {
  // when first connect, send all the messages to the newly connected client
  messages.forEach(function (data) {
    socket.emit('message', data);
  });

  socket.name = "unknown";
  sockets.push(socket);


  //--- Player provides their name ------------------------
  socket.on('identify', (name) => {
    socket.name = String(name || 'Anonymous');
    updateRoster();
  });


  //--- Player has left the arena ------------------------
  socket.on('disconnect', () => {
    sockets.splice(sockets.indexOf(socket), 1);
    updateRoster();
    
    // if in a game, let other player know he's won
  });


  //--- Start game ----------------------------------
  socket.on('newGame', (player, otherPlayer) => {
    if (!player || !otherPlayer) {
      console.error("Missing player in start new game");
      return;
    }

    var socketX = findSocket(player);
    var socketY = findSocket(otherPlayer);

    // create game object
    var playerXStarts = Math.random() < 0.5;
    var grid = [
      ["", "", ""],
      ["", "", ""],
      ["", "", ""]
    ];
    var gameInfo = {
      gameId: GameID,         // unique game ID
      grid: grid,             // 2d game grid, is empty string if available or player name
      xPlayer: player,        // X player's name
      yPlayer: otherPlayer,   // Y player's name
      xTurn: playerXStarts    // who's turn it is, true for X, false for Y
    };
    var game = {
      gameInfo: gameInfo,
      playerX: socketX,
      playerY: socketY
    };
    
    games.push(game);
    GameID++;

    socketX.emit("gameStarted", gameInfo, true);
    socketY.emit("gameStarted", gameInfo, false);

    if (playerXStarts) {
      game.playerX.emit("yourTurn", gameInfo, true);  // second parameter tells client if they are X or not (should it be X or Y instead?)
      game.playerY.emit("yourTurn", gameInfo, false);
    } else {
      game.playerX.emit("yourTurn", gameInfo, false);
      game.playerY.emit("yourTurn", gameInfo, true);
    }
  });


  //--- Player selected a square ------------------------
  socket.on('squareSelected', (gameInfo, isXPlayer, row, col) => {
    // if (!gameInfo || row < 0 || row > 2 || col < 0 || col > 2) {
    //   console.error("squareSelected: missing parameters");
    //   return;
    // }
    if (row < 0 || row > 2 || col < 0 || col > 2) {
      console.error("squareSelected: missing parameters");
      return;
    }
    if (!gameInfo) {
      console.error("squareSelected: missing parameters");
      return;
    }
    // row--;
    // col--;

    // find the game object that has the gameInfo and the player's sockets      
    var game = getGame(gameInfo.gameId);
    if (!game) {
      return;
    }
    
    // if this isn't this player's turn, ignore selection
    var playersTurn = isXPlayer == game.gameInfo.xTurn;
    if (!playersTurn) {
      console.error("not player's turn");
      return;
    }

    // is square already owned?
    if (game.gameInfo.grid[row][col] != "") {
      // already owned by someone
      console.log("square row " + row + " col " + col + " owned by " + game.gameInfo.grid[row][col]);
      return;
    }

    // square is available, set it to this player
    game.gameInfo.grid[row][col] = isXPlayer ? "X" : "Y";

    game.playerX.emit("gameUpdate", game.gameInfo);
    game.playerY.emit("gameUpdate", game.gameInfo);

    var winner = checkForGameWinner(game.gameInfo);
    if (winner) {
      sendWinner(winner, game);

    } else if (gameDraw(game)) {
      sendWinner("draw", game);

    } else {
      // tell next player it's their turn
      if (game.gameInfo.xTurn) {
        game.gameInfo.xTurn = false;
        game.playerX.emit("yourTurn", game.gameInfo, false);
        game.playerY.emit("yourTurn", game.gameInfo, true);
      } else {
        game.gameInfo.xTurn = true;
        game.playerX.emit("yourTurn", game.gameInfo, true);
        game.playerY.emit("yourTurn", game.gameInfo, false);
      }
    }
  });


  //--- Player gives up ----------------------------------
  socket.on('giveUp', (gameInfo) => {
    if (!gameInfo) {
      return;
    }

    // check if there is a winner and update player stats if so
    checkForGameWinner(gameInfo);
    
    // remove game from
    for (var i = 0; i < games.length; i++) {
      if (games[i].gameId == gameInfo.gameId) {
        games.splice(i, 1);
        break;
      }
    }
  });


  //--- Receive a chat message from one of the clients ------------
  socket.on('message', (msg) => {
    var text = String(msg || '');

    if (!text)
      return;

    console.log("==> got message " + text);
    socket.get('name', (err, name) => {
      var data = {
        name: name,
        text: text
      };
      
      console.log("==> got name " + name);

      broadcast('message', data);
      messages.push(data);
    });
  });
});


function findSocket(player) {
  for (var i = 0; i < sockets.length; i++) {
    if (player === sockets[i].name) {
      return (sockets[i]);
    }
  }
  return undefined;
}


function getGame(gameId) {
  for (var i = 0; i < games.length; i++) {
    if (games[i].gameInfo.gameId == gameId) {
      return games[i];
    }
  }
  return undefined;
}


function checkForGameWinner(gameInfo) {
  // find the game object that has the gameInfo and the player's sockets      
  var game = getGame(gameInfo.gameId);
  if (!game) {
    return false;
  }

  // check each column for wins
  for (var col = 0; col < 3; col++) {
    if (gameInfo.grid[0][col] != "" && gameInfo.grid[0][col] == gameInfo.grid[1][col] && gameInfo.grid[0][col] == gameInfo.grid[2][col]) {
      return gameInfo.grid[0][col];
    }
  }

  // check each row for wins
  for (var row = 0; row < 3; row++) {
    if (gameInfo.grid[row][0] && gameInfo.grid[row][0] == gameInfo.grid[row][1] && gameInfo.grid[row][0] == gameInfo.grid[row][2]) {
      return gameInfo.grid[row][0];
    }
  }

  // check both diaganols 
  if (gameInfo.grid[0][0] != "" && gameInfo.grid[0][0] && gameInfo.grid[0][0] == gameInfo.grid[1][1] && gameInfo.grid[0][0] == gameInfo.grid[2][2]) {
    return gameInfo.grid[1][1];
  }

  if (gameInfo.grid[0][2] != "" && gameInfo.grid[0][2] == gameInfo.grid[1][1] && gameInfo.grid[0][2] == gameInfo.grid[2][0]) {
    return gameInfo.grid[1][1];
  }
  
  return false;
}


function sendWinner(player, game) {
  game.playerX.emit('gameOver', game.gameInfo, player)
  game.playerY.emit('gameOver', game.gameInfo, player)
}

//--- Check if the game is a draw when all cells assigned but no winner
function gameDraw(game) {
  for (var col = 0; col < 3; col++) {
    for (var row = 0; row < 3; row++) {
      if (game.gameInfo.grid[row][col] == "") {
        return false;
      }
    }
  }
  return true;
}


function updateRoster() {
  var names = [];
  for (var i = 0; i < sockets.length; i++) {
    names.push(sockets[i].name);
    console.log("updateRoster: " + sockets[i].name);
  }
  io.sockets.emit('roster', names);
}


function broadcast(event, data) {
  sockets.forEach(function (socket) {
    socket.emit(event, data);
  });
}


server.listen(process.env.PORT || 3000, process.env.IP || "0.0.0.0", function(){
  var addr = server.address();
  console.log("TicTacToe server listening at", addr.address + ":" + addr.port);
});
