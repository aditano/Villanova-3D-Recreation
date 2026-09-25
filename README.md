# Villanova 3D Recreation

Procedural Three.js maquette of Villanova University’s main campus in Villanova, Pennsylvania. Extruded OpenStreetMap footprints, the campus path network, lawns, and a soft terrain surface — the same family of model as [Pittsburgh 3D Recreation](https://github.com/aditano/Pittsburgh-3D-Recreation), at campus scale.

Inspired by [Daniel Farinax’s San Francisco Three.js city loop](https://x.com/daniel_farinax/status/2088353519225237799).

This is **not** photogrammetry, **not** a scan, and **not** an official Villanova University drawing. Heights without an OSM `height` or `building:levels` tag are campus defaults. The Main Quad marker sits on an unnamed lawn south of the church because OSM does not name that quad.

## Features

- **OSM buildings** for the main campus, west campus, and the law school, extruded in local metres
- **Roads and paths**, including Lancaster Avenue, Ithan Avenue, and the campus footways
- **Lawns, pitches, and a few ponds**, plus the Paoli/Thorndale rail corridor drawn as ballast (no vehicles, no GTFS)
- **Villanova Stadium** as a simple bowl around the mapped field
- **Landmark labels** and camera presets: Aerial · Quad · Church · Stadium · Library · Station · Rotate
- **Time of day** from a late-afternoon default through night, with window glow
- **Walk mode**: WASD / arrows, Shift to run, drag to look, Esc to leave. Touch devices get a pad. Walking follows the terrain and stops at building footprints. Interiors, the stadium stands, and bridge decks are not modeled as walkable spaces

## Run locally

```bash
npm install
npm run dev
```

Open the URL Vite prints (default `http://localhost:5173`).

## Build

```bash
npm run build
npm run preview
```

GitHub Pages serves the production build at [https://aditano.github.io/Villanova-3D-Recreation/](https://aditano.github.io/Villanova-3D-Recreation/). The Vite `base` is `/Villanova-3D-Recreation/` for that build and `/` while developing.

## Data

Campus geometry lives in `public/data/villanova.json`.

- **Frame:** local metres, **+X east, +Y up, +Z south**. The origin is the OSM center of St. Thomas of Villanova Church.
- **Extent:** roughly Lancaster Avenue on the south, Ithan Avenue and west campus, north toward Dundale, and east through Garey Hall and the Charles Widger School of Law. Rosemont College, just east of the law school, is outside the extract.
- **Buildings:** `building:levels` or `height` when OSM has them (a small minority). Otherwise a campus default — about 3.5 m a storey, with a few named halls given a typical height so the library and quad buildings still read. The church’s tagged height is treated as the tip of a central spire; the nave is a lower extrusion of the real footprint.
- **Terrain:** an 8 m grid sampled from AWS Terrarium tiles (Mapzen RGB encoding of a USGS 3DEP composite), stored relative to ground level at the church. It is a soft surface for the maquette, not a survey.
- **Neighbors in frame:** Agnes Irwin School, Stoneleigh, and nearby houses fall inside the box and are drawn as ordinary OSM footprints. They are not Villanova buildings.

Refresh the extract (network; Overpass, then elevation tiles):

```bash
npm run data:refresh
npm run verify
```

`npm run data` reuses `scripts/osm-cache` when it is present.

Sources: [OpenStreetMap contributors](https://www.openstreetmap.org/copyright), © OpenStreetMap, [ODbL](https://opendatacommons.org/licenses/odbl/). Elevation tiles: [AWS terrain tiles](https://registry.opendata.aws/terrain-tiles/) / USGS 3DEP. Each landmark in the JSON keeps its OSM id.

## What this is not

- Not a transit model. The rail line is scenery so the SEPTA Villanova station has a platform context.
- Not a living-city simulation. There is no traffic, weather cycle, or interior walkthrough.
- No scraped aerial meshes and no copyrighted campus map used as a texture. Facades are a procedural window grid tinted like stone, brick, and concrete.
