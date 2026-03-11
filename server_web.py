import asyncio
import websockets
import json
import random
from collections import deque
import os
import time

# --- 1. CONFIGURATION ET ÉTAT DU JEU ---
HOST = '0.0.0.0' # 0.0.0.0 pour accepter les connexions externes
PORT = int(os.environ.get("PORT", 5555))
TICK_RATE = 0.250 # 250 ms
N = 20 # Taille de la grille

PALETTE_COULEURS = [
    (0, 0, 255), (0, 255, 0), (255, 255, 0), 
    (0, 255, 255), (255, 0, 255), (255, 165, 0)
]

grid = [[0 for _ in range(N)] for _ in range(N)]
players = {}
clients_connectes = {} # Fait le lien entre le WebSocket et l'ID du joueur
prochain_id = 1

# --- 2. FONCTIONS LOGIQUES (Le Cerveau) ---

def trouver_spawn_vide():
    """Cherche un endroit 5x5 vide sur la carte pour respawn en sécurité"""
    while True:
        rx = random.randint(2, N - 3)
        ry = random.randint(2, N - 3)
        
        zone_vide = True
        for y in range(ry - 2, ry + 3):
            for x in range(rx - 2, rx + 3):
                if grid[y][x] != 0:
                    zone_vide = False
                    break
            if not zone_vide: break
            
        if zone_vide:
            return rx, ry

def tuer_joueur(p):
    """Efface le joueur de la carte et le fait respawn"""
    for y in range(N):
        for x in range(N):
            if abs(grid[y][x]) == p["id"]:
                grid[y][x] = 0
                
    p["tail"].clear()
    p["dx"], p["dy"] = 0, 0
    p["action_queue"].clear()
    
    nx, ny = trouver_spawn_vide()
    p["x"], p["y"] = nx, ny
    for i in range(3):
        for j in range(3):
            grid[ny + i - 1][nx + j - 1] = p["id"]

def creer_nouveau_joueur():
    global prochain_id
    id_joueur = prochain_id
    
    couleur = PALETTE_COULEURS[(id_joueur - 1) % len(PALETTE_COULEURS)]
    nx, ny = trouver_spawn_vide()
    
    nouveau_joueur = {
        "id": id_joueur, "color": couleur,
        "x": nx, "y": ny,
        "dx": 0, "dy": 0,
        "tail": [], "score": 0, "action_queue": [],
        "last_action": time.time(),
    }
    
    for i in range(3):
        for j in range(3):
            grid[ny + i - 1][nx + j - 1] = id_joueur
            
    players[id_joueur] = nouveau_joueur
    prochain_id += 1
    
    return nouveau_joueur

def flood_fill(player):
    """L'algorithme du Déluge"""
    if not player["tail"]: return
    
    tail_tuples = [tuple(t) for t in player["tail"]]
    tail_set = set(tail_tuples)

    def is_wall(x, y):
        return grid[y][x] == player["id"] or (x, y) in tail_set

    q = deque()
    visited = set()

    for x in range(N):
        for y in (0, N - 1):
            if not is_wall(x, y):
                q.append((x, y)); visited.add((x, y))
    for y in range(1, N - 1):
        for x in (0, N - 1):
            if not is_wall(x, y):
                q.append((x, y)); visited.add((x, y))

    while q:
        cx, cy = q.popleft()
        for nx, ny in [(cx+1, cy), (cx-1, cy), (cx, cy+1), (cx, cy-1)]:
            if 0 <= nx < N and 0 <= ny < N:
                if not is_wall(nx, ny) and (nx, ny) not in visited:
                    visited.add((nx, ny))
                    q.append((nx, ny))

    for y in range(N):
        for x in range(N):
            if (x, y) not in visited and not is_wall(x, y):
                grid[y][x] = player["id"]

    for tx, ty in tail_tuples:
        grid[ty][tx] = player["id"]
        
    player["tail"].clear()

    # --- LE CHASSEUR DE KAMIKAZES ---
    joueurs_a_tuer = []
    for pid, p_autre in players.items():
        if pid != player["id"]:
            tete_engloutie = (grid[p_autre["y"]][p_autre["x"]] == player["id"])
            plus_de_base = True
            for ligne in grid:
                if p_autre["id"] in ligne:
                    plus_de_base = False
                    break
                    
            if tete_engloutie or plus_de_base:
                joueurs_a_tuer.append(p_autre)
                
    for victime in joueurs_a_tuer:
        print(f"[KILL DE ZONE] Joueur {player['id']} a anéanti Joueur {victime['id']} !")
        tuer_joueur(victime)

# --- 3. GESTION RÉSEAU ASYNCHRONE (Le moteur Web) ---

async def boucle_du_jeu():
    """Tourne en boucle pour calculer la logique du jeu (Le Tick)"""
    while True:
        await asyncio.sleep(TICK_RATE)
        
        for pid, p in players.items():
            # 1. Traitement de la file d'attente
            while p["action_queue"]:
                act = p["action_queue"].pop(0)
                if (act["dx"] != 0 and act["dx"] == -p["dx"]) or \
                   (act["dy"] != 0 and act["dy"] == -p["dy"]):
                    continue
                p["dx"] = act["dx"]
                p["dy"] = act["dy"]
                break
                
            # 2. Déplacement et Logique
            if p["dx"] != 0 or p["dy"] != 0:
                if grid[p["y"]][p["x"]] != p["id"]:
                    grid[p["y"]][p["x"]] = -p["id"]
                    p["tail"].append([p["x"], p["y"]]) 
                    
                if grid[p["y"]][p["x"]] == p["id"] and p["tail"]:
                    flood_fill(p)
                    
                futur_x = p["x"] + p["dx"]
                futur_y = p["y"] + p["dy"]
                
                # Collisions : Mur
                if futur_x < 0 or futur_x >= N or futur_y < 0 or futur_y >= N:
                    tuer_joueur(p)
                    continue
                    
                valeur_case = grid[futur_y][futur_x]
                
                # Collisions : Traînée
                if valeur_case < 0:
                    id_proprio = abs(valeur_case)
                    if id_proprio == p["id"]:
                        tuer_joueur(p)
                        continue 
                    else:
                        if id_proprio in players:
                            print(f"[KILL] Joueur {p['id']} a tué Joueur {id_proprio} !")
                            tuer_joueur(players[id_proprio])
                            
                p["x"] = futur_x
                p["y"] = futur_y

        # 3. Envoi de l'état à tous les navigateurs connectés
        if clients_connectes:
            etat_du_jeu = json.dumps({"type": "update", "grid": grid, "players": players})
            # Diffuse le message à tous les websockets
            websockets.broadcast(clients_connectes.keys(), etat_du_jeu)

async def gerer_client(websocket):
    """Gère un client de sa connexion jusqu'à sa déconnexion"""
    nouveau_joueur = creer_nouveau_joueur()
    pid = nouveau_joueur["id"]
    clients_connectes[websocket] = pid
    
    print(f"[+] Nouveau joueur connecté : ID {pid}")
    await websocket.send(json.dumps({"type": "init", "data": nouveau_joueur}))
    
    try:
        async for message in websocket:
            action = json.loads(message)
            if len(players[pid]["action_queue"]) < 2:
                players[pid]["action_queue"].append(action)
                
    except websockets.exceptions.ConnectionClosed:
        pass
        
    finally:
        # Nettoyage à la déconnexion
        print(f"[-] Joueur {pid} déconnecté.")
        del clients_connectes[websocket]
        
        if pid in players:
            for y in range(N):
                for x in range(N):
                    if abs(grid[y][x]) == pid:
                        grid[y][x] = 0
            del players[pid]

async def main():
    print(f"[*] Serveur WebSocket lancé sur ws://{HOST}:{PORT}")
    # On lance la boucle du jeu en tâche de fond
    asyncio.create_task(boucle_du_jeu())
    # On ouvre les portes du serveur
    async with websockets.serve(gerer_client, HOST, PORT):
        await asyncio.Future()

if __name__ == "__main__":
    asyncio.run(main())