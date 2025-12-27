const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
    cors: { origin: "*" }
});

// KORREKTUR: Wir sagen dem Server, dass statische Dateien im Ordner 'public' liegen
app.use(express.static(path.join(__dirname, 'public')));

console.log("Server gestartet. Suche Dateien im Ordner:", path.join(__dirname, 'public'));

// Explizite Route für die Startseite
app.get('/', (req, res) => {
    // KORREKTUR: Pfad zeigt jetzt auf public/index.html
    const indexPath = path.join(__dirname, 'public', 'index.html');
    
    res.sendFile(indexPath, (err) => {
        if (err) {
            console.error("KRITISCHER FEHLER: index.html nicht gefunden!", err);
            res.status(500).send(`
                <h1>Fehler 500</h1>
                <p>Die Datei <b>index.html</b> wurde nicht gefunden.</p>
                <p>Der Server sucht hier: ${indexPath}</p>
                <p>Bitte stelle sicher, dass ein Ordner namens 'public' existiert und die Datei dort liegt.</p>
            `);
        }
    });
});

// --- SPIEL LOGIK (Unverändert) ---
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
        
        if (card.color === 'black') {
            this.activeColor = chosenColor || 'red'; 
        } else {
            this.activeColor = card.color;
        }

        // Action Karten Logik
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
        
        this.players[pIndex].hand.push(...this.drawCards(1));
        this.statusMessage = `${this.players[pIndex].name} zieht aus dem Schatten...`;
        this.nextPlayer();
        this.broadcastState();
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
}

const rooms = {};

io.on('connection', (socket) => {
    socket.on('joinGame', ({ name, roomId }) => {
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
            room.playCard(socket.id, cardIndex, color);
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
    console.log(`Server gestartet auf Port ${PORT}`);
});


