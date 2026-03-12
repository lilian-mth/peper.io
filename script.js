
const canvas = document.getElementById("gameCanvas");
const ctx = canvas.getContext("2d");

const N = 50;
const CELL_SIZE = 50;
const GAP = 2;

// Connexion au serveur Python !
// Change 127.0.0.1 par ton IP Radmin/VPN quand tes potes voudront jouer
const ws = new WebSocket("wss://server-paper-io-lilian.onrender.com");

let mon_id = null;
let players = {};
let grid = [];

let lastUpdateTime = performance.now();
const TICK_RATE_MS = 120; // Doit correspondre à ton TICK_RATE serveur (0.120)

// --- RÉCEPTION DES MESSAGES DU SERVEUR ---
ws.onmessage = function(event) {
    const message = JSON.parse(event.data);
    
    if (message.type === "init") {
        mon_id = message.data.id;
        console.log("Connecté en tant que Joueur " + mon_id);
    } 
    else if (message.type === "update") {
        grid = message.grid;
        lastUpdateTime = performance.now(); // On remet le chrono à zéro !
        
        let newPlayers = message.players;
        for (let pid in newPlayers) {
            if (players[pid]) {
                // Technique Pygame : l'ancienne position devient "prev_x" et "prev_y"
                newPlayers[pid].prev_x = players[pid].x;
                newPlayers[pid].prev_y = players[pid].y;
            } else {
                // Si c'est un nouveau joueur, il n'a pas d'ancienne position
                newPlayers[pid].prev_x = newPlayers[pid].x;
                newPlayers[pid].prev_y = newPlayers[pid].y;
            }
        }
        players = newPlayers;

        actualiserClassement();
    }
};

ws.onclose = function() {
    alert("Connexion au serveur perdue !");
};

function gameLoop() {
    requestAnimationFrame(gameLoop); // Demande au navigateur de rappeler cette fonction à la prochaine frame
    dessinerJeu();
}
gameLoop(); // On lance la boucle au démarrage

// --- ENVOI DES TOUCHES ---
document.addEventListener("keydown", function(event) {
    // Empêcher la page de scroller quand on joue avec les flèches
    if(["ArrowUp","ArrowDown","ArrowLeft","ArrowRight"].indexOf(event.code) > -1) {
        event.preventDefault();
    }

    let action = null;
    if (event.key === "ArrowUp") action = {dx: 0, dy: -1};
    if (event.key === "ArrowDown") action = {dx: 0, dy: 1};
    if (event.key === "ArrowLeft") action = {dx: -1, dy: 0};
    if (event.key === "ArrowRight") action = {dx: 1, dy: 0};

    // Si on a appuyé sur une flèche et que le WebSocket est ouvert
    if (action && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify(action));
    }
});

function actualiserClassement() {
    let tableauJoueurs = Object.values(players);
    tableauJoueurs.sort((a, b) => b.score - a.score);

    const listDiv = document.getElementById("leaderboard-list");
    listDiv.innerHTML = ""; // On vide l'ancien classement

    for (let i = 0; i < tableauJoueurs.length; i++) {
        let p = tableauJoueurs[i];
        let row = document.createElement("div");
        row.className = "player-row";
        
        // Si c'est nous, on ajoute la classe CSS spéciale "is-me"
        if (p.id === mon_id) {
            row.classList.add("is-me");
        }
        
        // On met la couleur du joueur
        row.style.color = `rgb(${p.color[0]}, ${p.color[1]}, ${p.color[2]})`;
        
        // On écrit le nom et le score (Plus de "(Toi)")
        row.innerHTML = `<span>${i + 1}. Joueur ${p.id}</span> <span>${p.score}%</span>`;
        
        listDiv.appendChild(row);
    }
}

function dessinerJeu() {
    // --- 1. SÉCURITÉ ANTI-CRASH (NOUVEAU) ---
    // --- 1. SÉCURITÉ ANTI-CRASH ---
    if (!grid || grid.length === 0 || grid.length !== N) {
        ctx.fillStyle = "#323232";
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.fillStyle = "white";
        ctx.font = "30px Arial";
        ctx.textAlign = "center";
        ctx.fillText("Mise à jour du serveur Render en cours...", canvas.width / 2, canvas.height / 2);
        return;
    }

    // --- 2. LA TECHNIQUE PYGAME (Interpolation Temporelle) ---
    let maintenant = performance.now();
    let elapsed = maintenant - lastUpdateTime;
    // On calcule le pourcentage de temps écoulé (de 0.0 à 1.0)
    let ratio = Math.min(elapsed / TICK_RATE_MS, 1.0);

    for (let pid in players) {
        let p = players[pid];
        // Ta formule exacte retranscrite en JavaScript :
        p.visualX = (p.prev_x + (p.x - p.prev_x) * ratio) * CELL_SIZE;
        p.visualY = (p.prev_y + (p.y - p.prev_y) * ratio) * CELL_SIZE;
    }

    // 3. Effacer l'écran (Gris foncé)
    ctx.fillStyle = "#323232";
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    ctx.save(); 

    // --- CALCUL DE LA CAMÉRA ---
    if (mon_id && players[mon_id]) {
        let moi = players[mon_id];
        
        let centreJoueurX = moi.visualX + (CELL_SIZE / 2);
        let centreJoueurY = moi.visualY + (CELL_SIZE / 2);
        
        let offsetX = (canvas.width / 2) - centreJoueurX;
        let offsetY = (canvas.height / 2) - centreJoueurY;
        
        ctx.translate(offsetX, offsetY);
    }

    // 4. Fond de la Map
    ctx.fillStyle = "#FFFFFF";
    ctx.fillRect(0, 0, N * CELL_SIZE, N * CELL_SIZE);

    // 5. Dessiner la Grille (Territoires et Traînées)
    for (let y = 0; y < N; y++) {
        for (let x = 0; x < N; x++) {
            let v = grid[y][x];
            if (v !== 0) {
                let pid_case = Math.abs(v);
                if (players[pid_case]) {
                    let rgb = players[pid_case].color; 
                    
                    if (v < 0) {
                        let r = Math.min(255, rgb[0] + 100);
                        let g = Math.min(255, rgb[1] + 100);
                        let b = Math.min(255, rgb[2] + 100);
                        ctx.fillStyle = `rgb(${r}, ${g}, ${b})`;
                    } else {
                        let r = Math.max(0, rgb[0] - 40);
                        let g = Math.max(0, rgb[1] - 40);
                        let b = Math.max(0, rgb[2] - 40);
                        ctx.fillStyle = `rgb(${r}, ${g}, ${b})`;
                    }
                    ctx.fillRect(x * CELL_SIZE, y * CELL_SIZE, CELL_SIZE - GAP, CELL_SIZE - GAP);
                }
            }
        }
    }

    // 6. Dessiner les têtes des joueurs
    for (let pid in players) {
        let p = players[pid];
        let rgb = p.color;
        
        ctx.fillStyle = `rgb(${rgb[0]}, ${rgb[1]}, ${rgb[2]})`;
        ctx.fillRect(p.visualX, p.visualY, CELL_SIZE - GAP, CELL_SIZE - GAP);
        
        ctx.strokeStyle = "white";
        ctx.lineWidth = 2;
        ctx.strokeRect(p.visualX, p.visualY, CELL_SIZE - GAP, CELL_SIZE - GAP);
    }

    ctx.restore();

}
// --- GESTION DU TACTILE (SWIPES) ---
let touchStartX = 0;
let touchStartY = 0;

// On note où le doigt se pose
document.addEventListener('touchstart', function(e) {
    touchStartX = e.changedTouches[0].screenX;
    touchStartY = e.changedTouches[0].screenY;
}, false);

// On regarde où le doigt part et on calcule la direction
document.addEventListener('touchend', function(e) {
    let touchEndX = e.changedTouches[0].screenX;
    let touchEndY = e.changedTouches[0].screenY;
    
    let diffX = touchEndX - touchStartX;
    let diffY = touchEndY - touchStartY;

    let action = null;
    // On vérifie si le mouvement est assez grand pour être un vrai swipe (min 30px)
    if (Math.abs(diffX) > Math.abs(diffY)) {
        if (Math.abs(diffX) > 30) {
            action = (diffX > 0) ? {dx: 1, dy: 0} : {dx: -1, dy: 0}; // Droite ou Gauche
        }
    } else {
        if (Math.abs(diffY) > 30) {
            action = (diffY > 0) ? {dx: 0, dy: 1} : {dx: 0, dy: -1}; // Bas ou Haut
        }
    }

    if (action && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify(action));
    }
}, false);
    