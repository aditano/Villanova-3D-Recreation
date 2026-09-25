# Villanova 3D Recreation

Procedural Three.js model of Villanova University’s main campus in Villanova, Pennsylvania. OpenStreetMap footprints are rebuilt as halls with cornices, pitched roofs, and window reveals; Lancaster Avenue and the campus drives are paved cross-sections; the lawn is a shaded, mottled ground. Same family of project as [Pittsburgh 3D Recreation](https://github.com/aditano/Pittsburgh-3D-Recreation), at campus scale.

Inspired by [Daniel Farinax’s San Francisco Three.js city loop](https://x.com/daniel_farinax/status/2088353519225237799).

This is **not** photogrammetry, **not** a scan, and **not** an official Villanova University drawing. Heights without an OSM `height` or `building:levels` tag are campus defaults. The Main Quad marker sits on an unnamed lawn south of the church because OSM does not name that quad.

## Features

- **Halls with massing**, not flat extrusions: stone, brick, limestone, and glass families, cornices, sills, and pitched roofs where the footprint is a simple block. St. Thomas of Villanova Church has a buttressed nave, gabled roof, and central spire. Falvey steps back above a portico. The law school reads as a glass bar. Finneran Pavilion has a barrel roof. Villanova Stadium is a seating bowl around the mapped field.
- **Roads**: asphalt, curbs, sidewalks, and lane markings. Lancaster Avenue (trunk), campus drives, and intersections are paved. Cars and people are ambient scenery on those surfaces, not live traffic.
- **Lawns** with a green albedo, multi-scale mottling, dirt along paths, contact darkening at walls, short grass cards near the core, and a low displacement that flattens under pavement so walk mode still follows the DEM. Trees line Lancaster, the quad, and major paths.
- **Rail corridor** as ballast, ties, rails, and catenary poles, plus the station platform. No trains and no GTFS.
- **Landmark labels** and camera presets: Aerial · Quad · Church · Stadium · Library · Pavilion · Station · Lancaster · Rotate
- **Afternoon sun** by default (about 15:09), a fill light, soft shadows, a pale horizon with light clouds, and a night path with window glow
- **Walk mode**: WASD / arrows, Shift to run, drag to look, Esc to leave. Touch devices get a pad. `?view=walk` starts on Lancaster Avenue looking toward the church. Walking follows the terrain and stops at building footprints. Interiors, the stadium stands, and bridge decks are not modeled as walkable spaces

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
- **Buildings:** `building:levels` or `height` when OSM has them (a small minority). Otherwise a campus default — about 3.5 m a storey, with a few named halls given a typical height. The church’s tagged height is the spire tip; the nave and roof are lower. The pavilion’s tagged eave stays, and the barrel roof rises above it.
- **Terrain:** an 8 m grid sampled from AWS Terrarium tiles (Mapzen RGB encoding of a USGS 3DEP composite), stored relative to ground level at the church. The visible lawn subdivides that grid and shades it. It is not a survey.
- **Neighbors in frame:** Agnes Irwin School, Stoneleigh, and nearby houses fall inside the box and are drawn as ordinary OSM footprints. They are not Villanova buildings.

Refresh the extract (network; Overpass, then elevation tiles):

```bash
npm run data:refresh
npm run verify
```

`npm run data` reuses `scripts/osm-cache` when it is present.

Sources: [OpenStreetMap contributors](https://www.openstreetmap.org/copyright), © OpenStreetMap, [ODbL](https://opendatacommons.org/licenses/odbl/). Elevation tiles: [AWS terrain tiles](https://registry.opendata.aws/terrain-tiles/) / USGS 3DEP. Each landmark in the JSON keeps its OSM id.

Facades, asphalt, roofs, grass, and the field are procedural canvases written for this project (albedo, normal, roughness). Openings are geometry, not a painted window grid. No purchased texture packs.

## What this is not

- Not a transit model. The rail line is scenery so the SEPTA Villanova station has a platform context.
- Not live traffic. Cars and people are placed along the mapped centerlines.
- Not an interior walkthrough. The stadium stands and bridge decks are not walkable.
- Not photogrammetry and not a global-illumination render. There is no screen-space ambient occlusion pass; contact shadowing is baked into the ground mask and into cornices, curbs, and reveals. See `docs/qa/VISUAL.md` for what the stills show and what is still short of a game-engine campus.
