# Villanova 3D Recreation

Procedural Three.js model of Villanova University’s main campus in Villanova, Pennsylvania. Extruded OpenStreetMap footprints, authored heights for the named halls, campus paths, Lancaster Avenue traffic, and people on the walks. Same family of model as [Pittsburgh 3D Recreation](https://github.com/aditano/Pittsburgh-3D-Recreation), at campus scale.

Inspired by [Daniel Farinax’s San Francisco Three.js city loop](https://x.com/daniel_farinax/status/2088353519225237799).

This is **not** photogrammetry, **not** a scan, and **not** an official Villanova University drawing. Cars and pedestrians are an ambient sim. They are not live positions, not a GTFS feed, and not a traffic study.

## Features

- **OSM buildings** for the main campus, west campus, and the law school, in local metres
- **Heights** from OSM `height` / `building:levels` when those tags exist, otherwise a named-hall table in `src/height-rules.js` (Falvey, Connelly, the Pavilion, Mendel, Tolentine, Bartley, Garey, Widger, Alumni, the church nave and spire, dorms, and the rest)
- **Facades** painted per family — gothic limestone, stone, brick, buff center, glass, arena charcoal with a navy band, station brick — with a readable window grid
- **Villanova Stadium** as a bowl: navy fascia, navy-and-white seat deck, turf, goal posts, and corner lights
- **St. Thomas of Villanova Church** with a gabled nave, tower, spire, and cross on the real footprint
- **Roads and paths**, including Lancaster Avenue, Ithan Avenue, campus footways, and the footbridges over the Paoli/Thorndale line at Villanova Station
- **Ambient cars** on car-capable OSM roads (Lancaster and the other arterials), with lane offset, one-way defaults, and a short following gap
- **Pedestrians** on campus paths, including the station bridges
- **Lawns and pitches** in a saturated green, under a bright afternoon sky. The time slider still runs to night, with window glow
- **Camera presets** aimed at landmark centroids: Aerial · Quad · Church · Stadium · Library · Pavilion · Station · Lancaster · Rotate. Each move is a short smooth tween
- **Walk mode**: WASD / arrows, Shift to run, drag to look, Esc to leave. Touch devices get a pad. Walking follows the terrain and stops at building footprints

Default light is about 15:09, a sunny afternoon.

## Run locally

```bash
npm install
npm run dev
```

Open the URL Vite prints (default `http://localhost:5173`).

Preset stills (headless Chrome):

```bash
node scripts/shoot.mjs http://127.0.0.1:5173/ /tmp/vu-shots aerial quad church stadium library pavilion station lancaster walk
```

## Build

```bash
npm run build
npm run preview
```

GitHub Pages serves the production build at [https://aditano.github.io/Villanova-3D-Recreation/](https://aditano.github.io/Villanova-3D-Recreation/). The Vite `base` is `/Villanova-3D-Recreation/` for that build and `/` while developing.

## Checks

```bash
npm run verify   # extract, geography, streets, coverage, cameras, campus life
npm test         # campus life + cameras
npm run build
```

`npm run verify` is what the Pages workflow runs before the build. The audits read the committed extract. They do not call Overpass.

Notes and before/after stills from this pass: [`docs/qa/NOTES.md`](docs/qa/NOTES.md).

## Data

Campus geometry lives in `public/data/villanova.json`.

- **Frame:** local metres, **+X east, +Y up, +Z south**. The origin is the OSM center of St. Thomas of Villanova Church.
- **Extent:** roughly Lancaster Avenue on the south, Ithan Avenue and west campus, north toward Dundale, and east through Garey Hall and the Charles Widger School of Law. Rosemont College, just east of the law school, is outside the extract.
- **Terrain:** an 8 m grid sampled from AWS Terrarium tiles (Mapzen RGB encoding of a USGS 3DEP composite), stored relative to ground level at the church. It is a soft surface for the model, not a survey.
- **Bridges:** ways that cross the rail are lifted at runtime so the station footbridges and the Ithan rail bridge clear the ballast. A future `npm run data:refresh` also keeps `oneway`, `lanes`, and `bridge` tags.
- **Neighbors in frame:** Agnes Irwin School, Stoneleigh, and nearby houses fall inside the box and are drawn as ordinary OSM footprints. They are not Villanova buildings.

Refresh the extract (network; Overpass, then elevation tiles):

```bash
npm run data:refresh
npm run verify
```

`npm run data` reuses `scripts/osm-cache` when it is present.

Sources: [OpenStreetMap contributors](https://www.openstreetmap.org/copyright), © OpenStreetMap, [ODbL](https://opendatacommons.org/licenses/odbl/). Elevation tiles: [AWS terrain tiles](https://registry.opendata.aws/terrain-tiles/) / USGS 3DEP. Each landmark in the JSON keeps its OSM id.

## What this is not

- Not a transit model. There is no SEPTA or Amtrak vehicle sim. The rail line is ballast and platform context for Villanova Station.
- Not live traffic. Cars and people are instanced and seeded on the mapped roads and paths.
- Not photogrammetry. No scraped aerial meshes and no copyrighted campus map used as a texture.
