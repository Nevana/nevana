# Kraterkrieg 💣

Rundenbasierte Artillery im Browser: Teams aus Maulwürfen bekämpfen sich auf zerstörbarem Gelände,
gegen KI-Gegner oder online mit Freunden per Invite-Code.

## Starten

```bash
cd kraterkrieg
npm install
npm start          # → http://localhost:3000  (Port über PORT=xxxx änderbar)
```

Ohne Server (z. B. `public/` als statische Seite gehostet) läuft das Spiel im **Offline-Modus**:
gegen KI-Gegner und lokale Mitspieler am selben Gerät. Für Online-Einladungen braucht es den Node-Server.

## Lobby

- **Neue Lobby erstellen** → du bist Host und bekommst einen **Invite-Code** sowie einen Einladungslink.
- Freunde öffnen den Link (oder geben den Code ein) und landen in deiner Lobby.
- Der Host kann **KI-Gegner** (Leicht / Mittel / Schwer) und **lokale Spieler** (Hotseat) hinzufügen,
  Spieler entfernen und die Einstellungen ändern: Maulwürfe pro Team, Lebenspunkte, Zugzeit, Karte
  (Hügel, Inseln, Höhlen), Minen, Kisten und Sudden Death.
- Bis zu 6 Teams. Teamname und Farbe (Klick auf den Punkt) kann jeder für sein Team ändern.
- Verlässt ein Online-Spieler das laufende Spiel, übernimmt die KI sein Team.

Damit Freunde von außen beitreten können, muss der Server für sie erreichbar sein, zum Beispiel im
selben WLAN über `http://<deine-IP>:3000`, über einen Tunnel (z. B. ngrok, cloudflared) oder auf einem
Node-Hoster wie Render, Railway oder Fly.io.

## Steuerung

| Taste | Aktion |
|---|---|
| ← → | Laufen / umdrehen |
| ↑ ↓ | Zielen |
| Leertaste | halten = Kraft aufladen, loslassen = Feuer |
| Enter / Backspace | Sprung / Rückwärtssalto |
| 1–5 | Zündzeit (Granaten) |
| Klick | Ziel wählen (Luftangriff, Teleporter, Lenkrakete) |
| Q / E | Waffe wechseln |
| Maus ziehen / Mausrad | Kamera / Zoom |
| H / M | Hilfe / Ton |

## Waffen

Bazooka (Wind!), Lenkrakete, Granate, Splitterbombe, Schrotflinte (2 Schüsse), Schläger,
Dynamit, Mine, Luftangriff, Teleporter, Aussetzen. Dazu fallen Kisten mit Leben oder Extrawaffen vom Himmel.

## Technik

- `public/js/engine.js`: Physik, Waffen, Zugablauf (läuft nur beim Host, 60 Ticks/s im Web-Worker-Takt).
- `public/js/ai.js`: Die KI simuliert hunderte Schüsse mit der echten Physik (inkl. Wind) und wählt den
  besten. Die Schwierigkeit steuert Zielgenauigkeit und Waffenauswahl.
- `public/js/terrain.js`: Prozedurales Gelände als Bitmaske, für Gäste RLE-komprimiert übertragen.
- `public/js/render.js`: Canvas-Grafik, Partikel, HUD. `audio.js`: synthetisierte Sounds per WebAudio.
- `server.js`: statischer Webserver + WebSocket-Relay. Der Host-Browser ist autoritativ: Gäste senden
  Eingaben und erhalten 20 Snapshots/s, die sie flüssig interpolieren.
