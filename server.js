const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);

const io = new Server(server, {
    cors: { origin: "*" },
    connectionStateRecovery: {}
});

app.use(express.static(path.join(__dirname, 'public')));

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// --- SPIEL LOGIK ---
const COLORS = ['red', 'blue', 'green', 'yellow'];
const VALUES = ['0', '1', '2', '3', '4', '5', '6', '7', '8', '9', 'Jump Scare', 'Ritual', 'Blutpakt'];

class GameRoom {
    constructor(roomId) {
        this.roomId = roomId;
        this.players = []; 
        this.deck = [];
        this.discardPile = [];
        this.currentPlayerIndex = 0;
        this.direction = 1;
        this.activeColor = '';
        this.gameActive = false;
        this.statusMessage = "Warte auf Spieler...";
        this.turnTimer = null; 
    }

    buildDeck() {
        this.deck = [];
        COLORS.forEach(c => {
            VALUES.forEach((v, i) => {
                this.deck.push({color: c, value: v, id: Math.random().toString(36)});
                if (i !== 0) this.deck.push({color: c, value: v, id: Math.random().toString(36)});
            });
        });
        for(let i=0; i<4; i++) {
            this.deck.push({color: 'black', value: 'Wahl', id: Math.random().toString(36)});
            this.deck.push({color: 'black', value: 'Dunkler Pakt', id: Math.random().toString(36)});
        }
        this.shuffle(this.deck);
    }

    shuffle(array) {
        for (let i = array.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [array[i], array[j]] = [array[j], array[i]];
        }
    }

    drawCards(count) {
        const drawn = [];
        for(let i=0; i<count; i++) {
            if (this.deck.length === 0) {
                if (this.discardPile.length <= 1) break;
                const top = this.discardPile.pop();
                this.deck = [...this.discardPile];
                this.shuffle(this.deck);
                this.discardPile = [top];
            }
            if (this.deck.length > 0) drawn.push(this.deck.pop());
        }
        return drawn;
    }

    startGame() {
        if (this.players.length < 2) return false;
        this.buildDeck();
        this.players.forEach(p => p.hand = this.drawCards(7));
        
        let first = this.drawCards(1)[0];
        while(first && first.color === 'black') {
            this.deck.push(first);
            this.shuffle(this.deck);
            first = this.drawCards(1)[0];
        }
        this.discardPile = [first];
        this.activeColor = first.color;
        this.currentPlayerIndex = 0;
        this.gameActive = true;
        this.statusMessage = "Die Nacht beginnt...";
        
        this.startTurnTimer(); 
        return true;
    }

    startTurnTimer() {
        if (this.turnTimer) clearTimeout(this.turnTimer);
        
        // 60 Sekunden Limit pro Zug
        this.turnTimer = setTimeout(() => {
            if (this.gameActive) {
                const pName = this.players[this.currentPlayerIndex].name;
                this.statusMessage = `${pName} hat geschlafen! (Zeit abgelaufen)`;
                
                this.players[this.currentPlayerIndex].hand.push(...this.drawCards(1));
                
                this.nextPlayer();
                this.broadcastState();
            }
        }, 60000); 
    }

    nextPlayer(skip = false) {
        let n = this.currentPlayerIndex + this.direction;
        if (n >= this.players.length) n = 0;
        if (n < 0) n = this.players.length - 1;
        
        if (skip) {
            n += this.direction;
            if (n >= this.players.length) n = 0;
            if (n < 0) n = this.players.length - 1;
        }
        this.currentPlayerIndex = n;
        this.startTurnTimer(); 
    }

    isValidMove(card) {
        const top = this.discardPile[this.discardPile.length - 1];
        if (card.color === 'black') return true;
        if (card.color === this.activeColor) return true;
        if (card.value === top.value) return true;
        return false;
    }

    playCard(playerId, cardIndex, chosenColor = null) {
        if (!this.gameActive) return;
        
        const pIndex = this.players.findIndex(p => p.id === playerId);
        if (pIndex !== this.currentPlayerIndex) return;

        const player = this.players[pIndex];
        const card = player.hand[cardIndex];
        
        if (!this.isValidMove(card)) return;

        player.hand.splice(cardIndex, 1);
        this.discardPile.push(card);
        
        if (card.color === 'black') {
            this.activeColor = chosenColor || 'red'; 
        } else {
            this.activeColor = card.color;
        }

        if (this.turnTimer) clearTimeout(this.turnTimer);

        let skipNext = false;
        
        if (player.hand.length === 0) {
            this.gameActive = false;
            this.statusMessage = `${player.name} wurde ERLÖST!`;
            this.broadcastState();
            return; 
        }

        if (card.value === 'Jump Scare') { 
            skipNext = true;
            this.statusMessage = `${player.name} erschreckt den Nächsten!`;
        } else if (card.value === 'Ritual') { 
            this.direction *= -1;
            if (this.players.length === 2) skipNext = true; 
            this.statusMessage = "Die Richtung ändert sich...";
        } else if (card.value === 'Blutpakt') { 
            skipNext = true;
            let nextIdx = this.currentPlayerIndex + this.direction;
            if (nextIdx >= this.players.length) nextIdx = 0;
            if (nextIdx < 0) nextIdx = this.players.length - 1;
            const victim = this.players[nextIdx];
            victim.hand.push(...this.drawCards(2));
            this.statusMessage = `${victim.name} opfert Blut (+2)`;
        } else if (card.value === 'Dunkler Pakt') { 
            skipNext = true;
             let nextIdx = this.currentPlayerIndex + this.direction;
            if (nextIdx >= this.players.length) nextIdx = 0;
            if (nextIdx < 0) nextIdx = this.players.length - 1;
            const victim = this.players[nextIdx];
            victim.hand.push(...this.drawCards(4));
            this.statusMessage = `${victim.name} geht einen dunklen Pakt ein (+4)`;
        } else {
             this.statusMessage = `${player.name} spielt eine Karte.`;
        }

        this.nextPlayer(skipNext);
        this.broadcastState();
    }

    playerDraw(playerId) {
         if (!this.gameActive) return;
         
        const pIndex = this.players.findIndex(p => p.id === playerId);
        if (pIndex !== this.currentPlayerIndex) return;
        
        const player = this.players[pIndex];
        const newCards = this.drawCards(1);
        player.hand.push(...newCards);
        
        const hasValidMove = player.hand.some(c => this.isValidMove(c));

        if (hasValidMove) {
            this.statusMessage = `${player.name} hat gezogen...`;
            this.broadcastState();
        } else {
            this.statusMessage = `${player.name} kann nicht legen.`;
            this.broadcastState();
            
            setTimeout(() => {
                this.nextPlayer();
                this.broadcastState();
            }, 1500);
        }
    }
    
    broadcastState() {
        this.players.forEach(p => {
            const opponents = this.players.filter(pl => pl.id !== p.id).map(pl => ({
                name: pl.name,
                cardCount: pl.hand.length,
                isTurn: this.players[this.currentPlayerIndex].id === pl.id
            }));
            
            io.to(p.socketId).emit('gameState', {
                hand: p.hand,
                opponents: opponents,
                topCard: this.discardPile[this.discardPile.length - 1],
                activeColor: this.activeColor,
                isMyTurn: this.players[this.currentPlayerIndex].id === p.id,
                currentPlayerName: this.players[this.currentPlayerIndex].name,
                status: this.statusMessage,
                gameActive: this.gameActive
            });
        });
    }

    broadcastLobby() {
        io.to(this.roomId).emit('lobbyUpdate', { 
            players: this.players.map(p => p.name),
            hostId: this.players.length > 0 ? this.players[0].socketId : null,
            hostName: this.players.length > 0 ? this.players[0].name : "Niemand",
            canStart: this.players.length >= 2
        });
    }
}

const rooms = {};

io.on('connection', (socket) => {
    console.log('Verbindung:', socket.id);

    socket.on('joinGame', ({ name, roomId }) => {
        roomId = roomId.toString();

        if (!rooms[roomId]) {
            rooms[roomId] = new GameRoom(roomId);
        }
        const room = rooms[roomId];
        const existingPlayer = room.players.find(p => p.socketId === socket.id);
        
        if (!existingPlayer && room.players.length < 5 && !room.gameActive) {
            room.players.push({
                id: socket.id,
                name: name || `Schatten ${room.players.length + 1}`,
                hand: [],
                socketId: socket.id
            });
            socket.join(roomId);
            room.broadcastLobby();
        } else if (existingPlayer) {
             room.broadcastLobby();
        } else {
             socket.emit('error', 'Raum voll oder Spiel läuft bereits.');
        }
    });

    socket.on('startGame', ({ roomId }) => {
        roomId = roomId.toString();
        const room = rooms[roomId];
        if (room && room.players.length > 0 && room.players[0].socketId === socket.id) {
            if(room.startGame()) {
                room.broadcastState();
            }
        }
    });

    socket.on('playCard', ({ roomId, cardIndex, color }) => {
        roomId = roomId.toString();
        const room = rooms[roomId];
        if (room) {
            room.playCard(socket.id, cardIndex, color);
            // Keine Strafe mehr prüfen
        }
    });

    socket.on('drawCard', ({ roomId }) => {
        roomId = roomId.toString();
        const room = rooms[roomId];
        if (room) {
            room.playerDraw(socket.id);
        }
    });

    socket.on('disconnect', () => {
        for (const rId in rooms) {
            const room = rooms[rId];
            const idx = room.players.findIndex(p => p.socketId === socket.id);
            if (idx !== -1) {
                if (room.gameActive && idx === room.currentPlayerIndex) {
                    if (room.turnTimer) clearTimeout(room.turnTimer);
                }

                room.players.splice(idx, 1);
                
                if(room.players.length === 0) {
                    delete rooms[rId];
                } else {
                    if(!room.gameActive) {
                        room.broadcastLobby();
                    } else {
                        io.to(rId).emit('playerLeft', 'Ein Schatten ist verschwunden. Spiel beendet.');
                        delete rooms[rId];
                    }
                }
            }
        }
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Server gestartet auf Port ${PORT}`);
});


