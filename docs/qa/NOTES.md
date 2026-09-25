# Visual QA — living campus pass

Compared with the first Pages maquette (gray sky, one facade tint, camera presets that missed their landmarks). Stills are 1280×720, headless Chrome, `clean=1`, hour 15.15 (about 15:09). Walk uses the Quad preset in first person.

## Before

`docs/qa/before/` — Aerial, Quad, Church, Stadium, Library, Station.

- Default light was a flat gray. Lawns did not read as a sunny quad.
- Buildings shared one procedural gray, so the church, library, and pavilion were hard to tell apart.
- Quad placed the camera inside a south dorm on the oversized grass polygon.
- Church and library were tight corner shots. Stadium showed the exterior wall of a solid extrusion, not the field.
- No cars on Lancaster and no people on the paths.

## After

`docs/qa/after/` — the same six, plus Pavilion, Lancaster, and Walk.

| Still | What it should show |
| --- | --- |
| `aerial.png` | Blue sky over the core campus, saturated lawns, distinct halls, the stadium bowl toward the east |
| `quad.png` | Church spire from the open lawn south of the church, people on the walks |
| `church.png` | Gothic nave, tower, and cross, with arched windows |
| `stadium.png` | Navy fascia, striped seats, green field, goal posts, corner lights |
| `library.png` | Falvey’s stone block and large bays, whole building in frame |
| `pavilion.png` | Finneran Pavilion’s dark mass and navy/white band |
| `station.png` | Station building and canopy, with ballast in front of the platform |
| `lancaster.png` | Lancaster Avenue with ambient cars; lawn in the foreground |
| `walk.png` | First person on the Main Quad lawn, church ahead, people on the path |

## Checks that passed with these stills

- `npm run verify` — geography, streets (Lancaster, Ithan, footways, rail bridges), height coverage, every preset’s clearance and aim, campus-life counts
- `npm test` — car following gap, pedestrian segments, camera audit
- `npm run build`

Cars: 70 instanced on car-capable roads, about 45 biased onto Lancaster. Pedestrians: 64 on paths, about 40 biased onto the rail-crossing bridges. Counts are from the sim, not a live feed.

## Known limits

- OSM `height` coverage on this extract is thin. Named halls use `src/height-rules.js`. Untagged houses stay on a campus default.
- The stadium bowl is built from the mapped outer ring and inner field, not a single flat extrusion. Seat stripes are a texture, not individual seats.
- Lancaster is one OSM centerline. Cars offset to the right of the direction of travel. Service drives and parking aisles are not driven.
- Bridge decks are a lift of the OSM way where it crosses the rail, plus railings. They are not structural models.
- The station shot includes a lot of lawn around a small building. The canopy, brick, and ballast are the subject; the platform is not a full station interior.
