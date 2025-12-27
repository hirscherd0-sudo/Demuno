const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
    cors: { origin: "*" }
});

app.use(express.static(path.join(__dirname, '/')));

app.get('/', (req, res) => {
    res.sendFile(__join(__dirname, 'index.html'));
});

// --- SPIEL LOGIK ---
const COLORS = ['red', 'blue', 'green', 'yellow'];
const VALUES = ['0', '1', '2', '3', '4', '5', '6', '7', '8', '9', 'Jump Scare', 'Ritual', 'Blutpakt'];

class GameRoom {
    constructor(roomId) {
        this.roomId = roomId;
        this.players = []; // Array of objects {id, name, hand, socketId}
        this.deck = [];
        this.discardPile = [];
        this.currentPlayerIndex = 0;
        this.direction = 1;
        this.activeColor = '';
        this.gameActive = false;
        this.statusMessage = "Warte auf Spieler...";
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
        return true;
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
    }

    playCard(playerId, cardIndex, chosenColor = null) {
        if (!this.gameActive) return;
        const pIndex = this.players.findIndex(p => p.id === playerId);
        if (pIndex !== this.currentPlayerIndex) return;

        const player = this.players[pIndex];
        const card = player.hand[cardIndex];
        const top = this.discardPile[this.discardPile.length - 1];

        // Validierung
        let valid = false;
        if (card.color === 'black') valid = true;
        else if (card.color === this.activeColor) valid = true;
        else if (card.value === top.value) valid = true;

        if (!valid) return;

        // Karte spielen
        player.hand.splice(cardIndex, 1);
        this.discardPile.push(card);
        
        // Farben Logik
        if (card.color === 'black') {
            this.activeColor = chosenColor || 'red'; // Fallback
        } else {
            this.activeColor = card.color;
        }

        // Action Karten Logik
        let skipNext = false;
        
        if (player.hand.length === 0) {
            this.gameActive = false;
            this.statusMessage = `${player.name} wurde ERLÖST!`;
            this.broadcastState();
            return; // Spiel Ende
        }

        if (card.value === 'Jump Scare') { // Skip
            skipNext = true;
            this.statusMessage = `${player.name} erschreckt den Nächsten!`;
        } else if (card.value === 'Ritual') { // Reverse
            this.direction *= -1;
            if (this.players.length === 2) skipNext = true; // Bei 2 Spielern wirkt Reverse wie Skip
            this.statusMessage = "Die Richtung ändert sich...";
        } else if (card.value === 'Blutpakt') { // +2
            skipNext = true;
            // Finde das Opfer (um Namen anzuzeigen)
            let nextIdx = this.currentPlayerIndex + this.direction;
            if (nextIdx >= this.players.length) nextIdx = 0;
            if (nextIdx < 0) nextIdx = this.players.length - 1;
            const victim = this.players[nextIdx];
            
            victim.hand.push(...this.drawCards(2));
            this.statusMessage = `${victim.name} opfert Blut (+2)`;
        } else if (card.value === 'Dunkler Pakt') { // +4
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
        
        this.players[pIndex].hand.push(...this.drawCards(1));
        this.statusMessage = `${this.players[pIndex].name} zieht aus dem Schatten...`;
        this.nextPlayer();
        this.broadcastState();
    }
    
    // Check if player forgot "Voice" (Uno)
    checkVoice(playerId, calledVoice) {
         const pIndex = this.players.findIndex(p => p.id === playerId);
         const player = this.players[pIndex];
         if(player.hand.length === 1 && !calledVoice) {
             player.hand.push(...this.drawCards(2));
             this.statusMessage = `${player.name} vergaß zu rufen! (+2)`;
             this.broadcastState();
         }
    }

    broadcastState() {
        // Wir senden an jeden Spieler eine angepasste Ansicht (er sieht nur seine Karten)
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
}

const rooms = {};

io.on('connection', (socket) => {
    console.log('Ein Schatten nähert sich:', socket.id);

    socket.on('joinGame', ({ name, roomId }) => {
        if (!rooms[roomId]) {
            rooms[roomId] = new GameRoom(roomId);
        }
        
        const room = rooms[roomId];
        // Check if player already exists (reconnect) or new
        const existingPlayer = room.players.find(p => p.socketId === socket.id);
        
        if (!existingPlayer && room.players.length < 5 && !room.gameActive) {
            room.players.push({
                id: socket.id,
                name: name || `Schatten ${room.players.length + 1}`,
                hand: [],
                socketId: socket.id
            });
            socket.join(roomId);
            
            // Broadcast lobby info
             io.to(roomId).emit('lobbyUpdate', { 
                players: room.players.map(p => p.name),
                isHost: room.players[0].socketId === socket.id
            });
        } else {
             socket.emit('error', 'Raum voll oder Spiel läuft bereits.');
        }
    });

    socket.on('startGame', ({ roomId }) => {
        const room = rooms[roomId];
        if (room && room.players[0].socketId === socket.id) {
            if(room.startGame()) {
                room.broadcastState();
            }
        }
    });

    socket.on('playCard', ({ roomId, cardIndex, color, voice }) => {
        const room = rooms[roomId];
        if (room) {
            // Check voice first
            if(voice) {
                 // Player claims they called voice
            } else {
                // Logic to punish is inside next turn calculation usually, 
                // but for simplicity we check strictly on play
                const player = room.players.find(p => p.socketId === socket.id);
                if(player.hand.length === 2) { // Will have 1 after play
                     // We handle "Forgot Voice" inside the PlayCard logic if needed, 
                     // or we trust the client sends 'voice: true'
                }
            }
            
            room.playCard(socket.id, cardIndex, color);
            // Check penalty after play if they have 1 card left and didn't flag voice
            const player = room.players.find(p => p.socketId === socket.id);
            if(player && player.hand.length === 1 && !voice) {
                player.hand.push(...room.drawCards(2));
                room.statusMessage = `${player.name} vergaß zu rufen! Strafe (+2)`;
                room.broadcastState();
            }
        }
    });

    socket.on('drawCard', ({ roomId }) => {
        const room = rooms[roomId];
        if (room) {
            room.playerDraw(socket.id);
        }
    });

    socket.on('disconnect', () => {
        // Cleanup logic would go here. For now, simple removal breaks game flow 
        // so we might just mark them as disconnected in a full production app.
        // For this demo, if a player leaves, the room dies.
        for (const rId in rooms) {
            const room = rooms[rId];
            const idx = room.players.findIndex(p => p.socketId === socket.id);
            if (idx !== -1) {
                room.players.splice(idx, 1);
                io.to(rId).emit('playerLeft', 'Ein Schatten ist verschwunden. Spiel beendet.');
                delete rooms[rId];
            }
        }
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Das Portal ist geöffnet auf Port ${PORT}`);
});

