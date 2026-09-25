# Visual pass

Compared with the maquette that was live before this branch. Before stills are the previous renderer (flat extrusions, thin road ribbons, one lawn color). Pavilion, Lancaster, and Walk did not exist as presets, so those before frames are the aerial fallback.

## What changed

- **Roads.** Each OSM centerline is a cross-section: asphalt, curbs, sidewalks, shoulders on the expressway, edge lines, and a double-yellow or dashed center where the class calls for it. Intersections get asphalt discs so junctions are not grass. Paths stay gravel. The rail corridor is ballast, ties, rails, and catenary poles. Ambient cars sit on the asphalt, offset into a lane or the curb.
- **Buildings.** Footprints are walled with a plinth, shaft, cornice, and parapet, or a hip/gable when the ring is close to a rectangle (dorms, houses, gothic halls). One texture repeat is one bay and one floor, and the sill, mullion, and glass pane are real boxes on that grid. St. Thomas of Villanova is a buttressed nave, a gabled roof, and a central spire to the tagged tip. Falvey steps back over a south portico. The law school is a glass bar with a roof overhang. Finneran Pavilion is ribbed metal with a barrel roof. Villanova Stadium is a seating bowl, marked field, goals, and four light towers on the mapped inner field, not a window-textured extrusion of the outer ring.
- **Ground.** The DEM is still what walk mode stands on. The visible lawn is an ordinary mesh with a green albedo, a repeating grass texture, and vertex colors for mottling, path dirt, and contact darkening. A few centimetres of height variation are applied on the CPU and flattened on pavement. There is no custom grass shader: an earlier one failed to draw and left the clear color, which read as a blue void.
- **Cameras.** The church preset stands due south of St. Thomas, close enough that the nave and spire fill the frame. The open-lawn anchor used for the quad sits on the same line as Tolentine Hall, so a camera placed there looks through the church at Tolentine. `scripts/audit-cameras.mjs` projects both buildings and fails if Tolentine is nearer the screen center than St. Thomas, if the spire is cropped, or if the church does not fill the frame. It also replays that rejected bearing and requires the replay to fail. Lancaster looks along the avenue. Walk starts just north of that stretch, eye height 1.68 m on the DEM. The stadium camera looks down into the bowl.
- **Light.** Default hour is 15:09. The shadow map follows the camera target instead of a ±900 m box. Sky is a blue zenith over a pale horizon, with fog thin enough that distant lawns stay green. There is no SSAO and no god-ray pass; contact shadow is the cornices, curbs, and the ground mask.

## Stills

| View | Before | After |
| --- | --- | --- |
| Aerial | ![before aerial](before/aerial.png) | ![after aerial](after/aerial.png) |
| Quad | ![before quad](before/quad.png) | ![after quad](after/quad.png) |
| Church | ![before church](before/church.png) | ![after church](after/church.png) |
| Stadium | ![before stadium](before/stadium.png) | ![after stadium](after/stadium.png) |
| Library | ![before library](before/library.png) | ![after library](after/library.png) |
| Pavilion | ![before pavilion](before/pavilion.png) | ![after pavilion](after/pavilion.png) |
| Station | ![before station](before/station.png) | ![after station](after/station.png) |
| Lancaster | ![before lancaster](before/lancaster.png) | ![after lancaster](after/lancaster.png) |
| Walk | ![before walk](before/walk.png) | ![after walk](after/walk.png) |

## Still short of a game-engine campus

This is still a web model of OSM rings, not a surveyed mesh.

- Secondary halls share a few families. An L-shaped footprint keeps a flat roof so a gable does not float off the wings. They read as buildings with bays and a cornice, not as unique masonry.
- There is no screen-space AO, no volumetric light, and no photogrammetry. Depth comes from modeled reveals, curbs, and a shadow map.
- The church nave is 16.5 m and the modeled spire is 34 m so the steeple clears the roof. The OSM height tag is about 30 m and is shorter than the real steeple. Window tracery is a repeated bay, not carved stone.
- Grass displacement is small on purpose so it does not fight the curbs. Close up it is mottled ground, not individual blades.
- Cars are ambient. They are not a live traffic feed.
