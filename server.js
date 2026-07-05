const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const { createClient } = require('@supabase/supabase-js');
const DominoGame = require('./DominoGame');

const app = express();
const server = http.createServer(app);

// --- SUPABASE BACKEND SETUP ---
// The server uses environment variables to keep the master key out of GitHub
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

// Only initialize if keys are present (prevents crashes if running locally without them)
const supabase = (supabaseUrl && supabaseServiceKey)
    ? createClient(supabaseUrl, supabaseServiceKey)
    : null;

// Enable CORS so the mobile app can connect
const io = new Server(server, { cors: { origin: "*" } });

app.use(express.static('www'));
app.get('/', (req, res) => {
    res.sendFile(__dirname + '/www/index.html');
});

const activeRooms = {};

function generateRoomCode() {
    return Math.random().toString(36).substring(2, 7).toUpperCase();
}

function broadcastRoomState(roomCode) {
    const room = activeRooms[roomCode];
    if (!room) return;

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
                roomCode: roomCode,
                playersReady: room.players.length
            });
        }
    });
}

// --- DATABASE SAVING LOGIC ---
async function saveMatchData(roomCode, room) {
    if (!supabase) {
        console.log("⚠️ Database keys missing. Skipping match save.");
        return;
    }

    try {
        // In Cuban Dominoes, if Team 1 has >= 200 points, they lost. So Team 2 wins.
        const winnerTeam = room.game.scores.team1 >= 200 ? 2 : 1;

        // 1. Log the Match
        const { data: matchData, error: matchError } = await supabase
            .from('matches')
            .insert([{
                room_code: roomCode,
                team1_score: room.game.scores.team1,
                team2_score: room.game.scores.team2,
                winner_team: winnerTeam
            }])
            .select()
            .single();

        if (matchError) throw matchError;

        // 2. Log the Players mapped to this match
        const playersToInsert = room.players.map((player, index) => {
            return {
                match_id: matchData.id,
                profile_id: player.userId || null, // Associates the DB row with their Supabase Auth ID
                team_number: (index === 0 || index === 2) ? 1 : 2,
                player_index: index
            };
        });

        const { error: playersError } = await supabase
            .from('match_players')
            .insert(playersToInsert);

        if (playersError) throw playersError;

        console.log(`✅ Match ${roomCode} saved successfully to PostgreSQL!`);
    } catch (err) {
        console.error("❌ Error saving match:", err);
    }
}

io.on('connection', (socket) => {
    console.log(`🟢 New connection: ${socket.id}`);

    // --- AUTHENTICATION HANDLER ---
    // When the frontend confirms a Google login, tag this socket with their UUID
    socket.on('player_authenticated', (data) => {
        socket.userId = data.userId;
        console.log(`👤 Socket ${socket.id} authenticated as user ${data.userId}`);
    });

    // --- LOBBY SYSTEM ---
    socket.on('create_room', () => {
        const roomCode = generateRoomCode();

        activeRooms[roomCode] = {
            game: new DominoGame(),
            players: [{ id: socket.id, userId: socket.userId }], // Store their UUID!
            matchSaved: false
        };

        socket.roomCode = roomCode;
        socket.join(roomCode);
        socket.emit('room_joined', { roomCode, playerIndex: 0 });
        broadcastRoomState(roomCode);
    });

    socket.on('join_room', (roomCode) => {
        roomCode = roomCode.toUpperCase();
        const room = activeRooms[roomCode];

        if (!room) return socket.emit('error_msg', 'Room not found!');
        if (room.players.length >= 4) return socket.emit('error_msg', 'Game is full!');

        const playerIndex = room.players.length;

        // Store their UUID when they sit at the table
        room.players.push({ id: socket.id, userId: socket.userId });

        socket.roomCode = roomCode;
        socket.join(roomCode);

        socket.emit('room_joined', { roomCode, playerIndex });
        broadcastRoomState(roomCode);
    });

    // --- GAMEPLAY EVENTS ---
    socket.on('play_tile', (data) => {
        const roomCode = socket.roomCode;
        if (!roomCode || !activeRooms[roomCode]) return;

        const room = activeRooms[roomCode];
        const { playerIndex, tileIndex, target } = data;

        let success = room.game.playTile(playerIndex, tileIndex, target);
        if (success) {
            broadcastRoomState(roomCode);

            // CHECK FOR MATCH END
            if (room.game.matchWinner && !room.matchSaved) {
                room.matchSaved = true; // Prevents saving the same match twice
                saveMatchData(roomCode, room);
            }
        } else {
            socket.emit('error_msg', 'That tile does not match the board!');
        }
    });

    socket.on('pass_turn', (data) => {
        const roomCode = socket.roomCode;
        if (!roomCode || !activeRooms[roomCode]) return;

        let success = activeRooms[roomCode].game.passTurn(data.playerIndex);
        if (success) {
            broadcastRoomState(roomCode);
        } else {
            socket.emit('error_msg', 'Illegal move! You have a playable tile.');
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

    socket.on('disconnect', () => {
        console.log(`🔴 Player disconnected: ${socket.id}`);
        const roomCode = socket.roomCode;

        if (roomCode && activeRooms[roomCode]) {
            const room = activeRooms[roomCode];
            room.players = room.players.filter(p => p.id !== socket.id);

            if (room.players.length === 0) {
                delete activeRooms[roomCode];
            } else {
                io.to(roomCode).emit('error_msg', 'A player disconnected. The game may be paused.');
            }
        }
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, '0.0.0.0', () => {
    console.log(`🚀 Live Server running on port ${PORT}`);
});