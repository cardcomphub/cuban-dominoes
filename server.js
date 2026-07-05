const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const DominoGame = require('./DominoGame');

const app = express();
const server = http.createServer(app);

// Enable CORS so the mobile app can connect to the server
const io = new Server(server, {
    cors: { origin: "*" }
});

// Serve the 'www' folder we created for Capacitor
app.use(express.static('www'));
app.get('/', (req, res) => {
    res.sendFile(__dirname + '/www/index.html');
});

// MULTI-ROOM STATE MANAGEMENT
// Maps a 5-letter room code to a specific game instance and player list
const activeRooms = {};

function generateRoomCode() {
    // Generates a random 5-character string (e.g., "A7K9P")
    return Math.random().toString(36).substring(2, 7).toUpperCase();
}

function broadcastRoomState(roomCode) {
    const room = activeRooms[roomCode];
    if (!room) return;

    // Send a customized payload to each player currently in THIS specific room
    room.players.forEach((player, index) => {
        if (player) {
            io.to(player.id).emit('game_update', {
                playerIndex: index,
                hand: room.game.players[index],
                currentTurn: room.game.currentTurn,
                board: room.game.board,
                scores: room.game.scores,
                isRoundOver: room.game.isRoundOver,
                roundMessage: room.game.roundMessage,
                matchWinner: room.game.matchWinner,
                roomCode: roomCode, // Sends the code to the frontend UI
                playersReady: room.players.length // Tracks how full the lobby is
            });
        }
    });
}

io.on('connection', (socket) => {
    console.log(`🟢 New connection established: ${socket.id}`);

    // --- LOBBY SYSTEM ---

    // 1. Create a brand new private room
    socket.on('create_room', () => {
        const roomCode = generateRoomCode();

        // Initialize a brand new game instance for this room
        activeRooms[roomCode] = {
            game: new DominoGame(),
            players: [{ id: socket.id }] // The creator is Player 0
        };

        socket.roomCode = roomCode; // Tag the socket so we remember where they are
        socket.join(roomCode); // Add them to the isolated Socket.io channel

        console.log(`🏠 Room created: ${roomCode} by ${socket.id}`);

        socket.emit('room_joined', { roomCode, playerIndex: 0 });
        broadcastRoomState(roomCode);
    });

    // 2. Join an existing room via 5-letter code
    socket.on('join_room', (roomCode) => {
        roomCode = roomCode.toUpperCase();
        const room = activeRooms[roomCode];

        if (!room) {
            socket.emit('error_msg', 'Room not found! Check the code and try again.');
            return;
        }

        if (room.players.length >= 4) {
            socket.emit('error_msg', 'Game is full! Maximum 4 players allowed.');
            return;
        }

        const playerIndex = room.players.length;
        room.players.push({ id: socket.id });

        socket.roomCode = roomCode;
        socket.join(roomCode);

        console.log(`👋 ${socket.id} joined room ${roomCode} as Player ${playerIndex}`);

        socket.emit('room_joined', { roomCode, playerIndex });
        broadcastRoomState(roomCode);
    });

    // --- GAMEPLAY EVENTS ---
    // Notice how these now check `socket.roomCode` before doing anything!

    socket.on('play_tile', (data) => {
        const roomCode = socket.roomCode;
        if (!roomCode || !activeRooms[roomCode]) return;

        const room = activeRooms[roomCode];
        const { playerIndex, tileIndex, target } = data;

        let success = room.game.playTile(playerIndex, tileIndex, target);
        if (success) {
            broadcastRoomState(roomCode);
        } else {
            socket.emit('error_msg', 'That tile does not match the board!');
        }
    });

    socket.on('pass_turn', (data) => {
        const roomCode = socket.roomCode;
        if (!roomCode || !activeRooms[roomCode]) return;

        const room = activeRooms[roomCode];
        const { playerIndex } = data;

        let success = room.game.passTurn(playerIndex);
        if (success) {
            broadcastRoomState(roomCode);
        } else {
            socket.emit('error_msg', 'Illegal move! You have a playable tile and cannot pass.');
        }
    });

    socket.on('next_round', () => {
        const roomCode = socket.roomCode;
        if (!roomCode || !activeRooms[roomCode]) return;

        const room = activeRooms[roomCode];
        if (room.game.isRoundOver && !room.game.matchWinner) {
            room.game.startNewRound();
            broadcastRoomState(roomCode);
        }
    });

    // --- DISCONNECT HANDLING ---
    socket.on('disconnect', () => {
        console.log(`🔴 Player disconnected: ${socket.id}`);
        const roomCode = socket.roomCode;

        if (roomCode && activeRooms[roomCode]) {
            const room = activeRooms[roomCode];

            // Filter the player out of the room array
            room.players = room.players.filter(p => p.id !== socket.id);

            // Clean up memory: if the room is totally empty, delete the game!
            if (room.players.length === 0) {
                delete activeRooms[roomCode];
                console.log(`🗑️ Room ${roomCode} destroyed (empty).`);
            } else {
                io.to(roomCode).emit('error_msg', 'A player disconnected. The game may be paused.');
            }
        }
    });
});

// Start the server
const PORT = process.env.PORT || 3000;
server.listen(PORT, '0.0.0.0', () => {
    console.log(`🚀 Live Server running on port ${PORT}`);
});