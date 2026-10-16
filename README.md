# Observatory Tycoon 🔭

A classroom multiplayer strategy game for middle and high school students, playable in about an hour.
Teams build an observatory (site, mirror size, instruments), compete for a shared pool of grants, and earn
science points across several observing "semesters". Weather, sky position (RA/Dec vs. latitude), seeing,
humidity and queue order all matter.

## Run it

```bash
node server.js            # Node 18+, no dependencies
# or
docker build -t observatory-tycoon . && docker run -p 8080:8080 observatory-tycoon
```

- **Teacher:** open `http://<host>:8080/host.html` on the projector and create a game.
- **Students:** open `http://<host>:8080`, enter the 4-letter code and their first name, then start or join a team.

## How a game flows

| Phase | Length | What happens |
|---|---|---|
| Lobby | until the teacher clicks Start | Kids join and form teams of 1–4 |
| Planning | 2× planning time in semester 1, then the planning time | Build or upgrade, apply for grants, order the queue |
| Grants awarded | 9 s | Snake-draft allocation, with trailing teams picking first |
| Observing | 8 nights × 3 s | Weather is rolled per site; each telescope works on the top grant tonight's weather allows |
| Report | 15 s | Results, plus a discussion prompt on the projector |
| Final | — | Award ceremony; every team gets at least one award |

**Team roles** are assigned by join order. Solo players do everything. With 2 players, one is Director + Scheduler and the other is Engineer. With 3+, each player gets one role. The teacher can turn role locks off.

**Teacher controls:** pause, +30 s, skip phase, events (💥 supernova, ⛈️ storm, 🎁 funding boost, ✂️ budget cut), role locks, end game, remove player.

## Fairness mechanics
- Grants are allocated in passes where the lowest-science team picks first, so speed and wealth don't win.
- Community grants are unlimited. Any team that wins nothing is booked for a Public Star Party.
- Running costs grow with observatory size.
- Unfinished grants earn partial science.
- There are 12 award categories, and any team without a win gets a "Rising Star" spotlight.

## Code layout
- `server.js`: HTTP server, static files, JSON API, Server-Sent Events
- `game/data.js`: sites, mirrors, instruments, targets and grant templates (tune balance here)
- `game/engine.js`: room state, phases, allocation, weather and night simulation, awards
- `public/`: `index.html` (join), `play.*` (student), `host.*` (projector), `common.js`, `style.css`
- `test/simulate.js`: bot playthroughs (`node test/simulate.js 8 100`)

## Deploying (Cloud Run)
Game state lives in memory, so run **a single instance** and allow long requests for the SSE stream:
```bash
gcloud run deploy observatory-tycoon --source . --max-instances=1 --timeout=3600 --session-affinity
```
