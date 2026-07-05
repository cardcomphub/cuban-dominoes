const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const DominoGame = require('./DominoGame');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.get('/', (req, res) => {
    res.sendFile(__dirname + '/index.html');
});

let game = new DominoGame();
let connectedPlayers = [];

function broadcastState() {
    connectedPlayers.forEach((socketId, index) => {
        io.to(socketId).emit('game_update', {
            playerIndex: index,
            hand: game.players[index],
            currentTurn: game.currentTurn,
            board: game.board,
            // NEW: Send score and round data to the clients
            scores: game.scores,
            isRoundOver: game.isRoundOver,
            roundMessage: game.roundMessage,
            matchWinner: game.matchWinner
        });
    });
}

io.on('connection', (socket) => {
    console.log(`🟢 New player connected! ID: ${socket.id}`);

    if (connectedPlayers.length < 4) {
        connectedPlayers.push(socket.id);
        broadcastState();
    } else {
        socket.emit('spectator', { message: 'Game is full! You are spectating.' });
    }

    socket.on('play_tile', (data) => {
        const { playerIndex, tileIndex, target } = data;
        let success = game.playTile(playerIndex, tileIndex, target);
        if (success) {
            broadcastState();
        } else {
            socket.emit('error_msg', 'That tile does not match the board!');
        }
    });

    socket.on('pass_turn', (data) => {
        const { playerIndex } = data;
        let success = game.passTurn(playerIndex);
        if (success) {
            broadcastState();
        } else {
            socket.emit('error_msg', 'Illegal move! You have a playable tile and cannot pass.');
        }
    });

    // NEW: Listen for a player asking to deal the next hand
    socket.on('next_round', () => {
        if (game.isRoundOver && !game.matchWinner) {
            game.startNewRound();
            broadcastState();
        }
    });

    socket.on('disconnect', () => {
        console.log(`🔴 Player disconnected: ${socket.id}`);
        connectedPlayers = connectedPlayers.filter(id => id !== socket.id);
    });
});

// 4. Start Broadcasting
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`🚀 Live Server running on port ${PORT}`);
});