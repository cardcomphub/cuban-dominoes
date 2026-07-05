class DominoGame {
    constructor() {
        // NEW: Track team scores across rounds
        // Team 1 = Players 0 & 2 | Team 2 = Players 1 & 3
        this.scores = { team1: 0, team2: 0 };
        this.matchWinner = null;

        this.startNewRound();
    }

    // NEW: Method to reset the table without losing the total scores
    startNewRound() {
        this.pool = [];
        this.players = [[], [], [], []];
        this.board = [];
        this.ends = { head: null, tail: null };
        this.currentTurn = 0;
        this.consecutivePasses = 0;

        this.isRoundOver = false;
        this.roundMessage = "";

        this.generateTiles();
        this.shufflePool();
        this.deal();
    }

    generateTiles() {
        for (let i = 0; i <= 9; i++) {
            for (let j = i; j <= 9; j++) {
                this.pool.push([i, j]);
            }
        }
    }

    shufflePool() {
        for (let i = this.pool.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [this.pool[i], this.pool[j]] = [this.pool[j], this.pool[i]];
        }
    }

    deal() {
        for (let p = 0; p < 4; p++) {
            for (let t = 0; t < 10; t++) {
                this.players[p].push(this.pool.pop());
            }
        }
    }

    // NEW: Helper to count the total pips (dots) in a player's hand
    calculatePips(playerIndex) {
        return this.players[playerIndex].reduce((sum, tile) => sum + tile[0] + tile[1], 0);
    }

    // NEW: Centralized logic for ending a round and tallying points
    endRound(winnerIndex, reason) {
        this.isRoundOver = true;

        // Determine teams based on the winning player index
        const winningTeam = (winnerIndex === 0 || winnerIndex === 2) ? 1 : 2;
        const losingTeam = (winningTeam === 1) ? 2 : 1;

        // Sum the remaining pips of the TWO players on the losing team
        let pointsAdded = 0;
        if (losingTeam === 1) {
            pointsAdded = this.calculatePips(0) + this.calculatePips(2);
            this.scores.team1 += pointsAdded;
        } else {
            pointsAdded = this.calculatePips(1) + this.calculatePips(3);
            this.scores.team2 += pointsAdded;
        }

        this.roundMessage = `${reason} Player ${winnerIndex} (Team ${winningTeam}) wins the round!\nTeam ${losingTeam} gets ${pointsAdded} points added to their score.`;

        // Check if the overall match is over (Losing team hits 200)
        if (this.scores.team1 >= 200) {
            this.matchWinner = "TEAM 2 WINS THE MATCH!";
        } else if (this.scores.team2 >= 200) {
            this.matchWinner = "TEAM 1 WINS THE MATCH!";
        }
    }

    hasPlayableTile(playerIndex) {
        if (this.board.length === 0) return true;
        const hand = this.players[playerIndex];
        return hand.some(tile =>
            tile[0] === this.ends.head || tile[1] === this.ends.head ||
            tile[0] === this.ends.tail || tile[1] === this.ends.tail
        );
    }

    passTurn(playerIndex) {
        if (this.isRoundOver) return false;
        if (playerIndex !== this.currentTurn) return false;
        if (this.hasPlayableTile(playerIndex)) return false;

        this.consecutivePasses++;

        // NEW: Trancado (Locked Game) logic
        if (this.consecutivePasses === 4) {
            let lowestPips = Infinity;
            let winnerIndex = 0;

            // Find out who holds the lightest hand
            for (let i = 0; i < 4; i++) {
                let pips = this.calculatePips(i);
                if (pips < lowestPips) {
                    lowestPips = pips;
                    winnerIndex = i;
                }
            }
            this.endRound(winnerIndex, "TRANCADO!");
            return true;
        }

        this.nextTurn();
        return true;
    }

    playTile(playerIndex, tileIndex, targetEnd = 'tail') {
        if (this.isRoundOver || playerIndex !== this.currentTurn) return false;

        const hand = this.players[playerIndex];
        const tile = hand[tileIndex];

        if (this.board.length === 0) {
            this.board.push(tile);
            this.ends.head = tile[0];
            this.ends.tail = tile[1];
            hand.splice(tileIndex, 1);
            this.handleSuccessfulPlay(playerIndex, hand);
            return true;
        }

        let [a, b] = tile;
        let matched = false;

        if (targetEnd === 'head') {
            if (a === this.ends.head) {
                this.board.unshift([b, a]);
                this.ends.head = b;
                matched = true;
            } else if (b === this.ends.head) {
                this.board.unshift([a, b]);
                this.ends.head = a;
                matched = true;
            }
        } else if (targetEnd === 'tail') {
            if (a === this.ends.tail) {
                this.board.push([a, b]);
                this.ends.tail = b;
                matched = true;
            } else if (b === this.ends.tail) {
                this.board.push([b, a]);
                this.ends.tail = a;
                matched = true;
            }
        }

        if (matched) {
            hand.splice(tileIndex, 1);
            this.handleSuccessfulPlay(playerIndex, hand);
            return true;
        }
        return false;
    }

    handleSuccessfulPlay(playerIndex, hand) {
        this.consecutivePasses = 0;

        // NEW: Normal win condition
        if (hand.length === 0) {
            this.endRound(playerIndex, "DOMINÓ!");
        } else {
            this.nextTurn();
        }
    }

    nextTurn() {
        this.currentTurn = (this.currentTurn + 1) % 4;
    }
}

module.exports = DominoGame;