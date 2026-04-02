# Kylito's Way V8.5 - Zombie Apocalypse

A third-person 3D neighborhood explorer using Google Photorealistic 3D Tiles. Explore real-world locations in a post-apocalyptic zombie survival setting.

## Live Demo
https://stonewallkid.github.io/kylitos-way-v8/

## Features

### Exploration
- **Google 3D Tiles**: Photorealistic 3D world from Google Maps
- **Any Location**: Search any address, city, or landmark
- **GPS Support**: Use your current location

### Movement & Vehicles
- **Walking/Running**: WASD movement with sprint
- **Cars**: Enter/exit vehicles scattered around
- **Jet Fighter**: High-speed travel (~600 MPH)
- **Jetpack**: Fly up with fuel management
- **Wingsuit**: Glide after jetpacking high

### Combat
- **Paintball Mode**: Shoot colored paintballs
- **Zombies**: 15 wandering zombies to hunt
- **Kill Tracking**: Zombies take 3 hits, respawn after death

### Visual
- **Day/Night Mode**: Toggle with N key
- **Minimap**: Real-time map with streets, shows zombies/vehicles/markers

## Controls

### Desktop
| Key | Action |
|-----|--------|
| WASD | Move |
| Arrows | Look around |
| / | Shoot (in paintball mode) |
| SHIFT | Sprint / Fly (jetpack) |
| SPACE | Jump |
| E | Enter/Exit Vehicle |
| J | Toggle Jetpack |
| G | Deploy Wingsuit (in air) |
| N | Toggle Night Mode |
| P | Toggle Paintball Mode |
| M | Drop Marker |
| C | Clear Markers |
| H | Hide/Show Controls |

### Jet Controls
| Key | Action |
|-----|--------|
| W/S | Throttle up/down |
| A/D | Turn left/right |
| Arrow Up/Down | Pitch nose up/down |
| E | Exit jet |

### Mobile
- Left side: Virtual joystick for movement
- Right side: Touch to look around
- Menu button (top right): Access all features

## Tech Stack
- **Three.js**: 3D rendering
- **3d-tiles-renderer**: Google 3D Tiles integration
- **Vite**: Build tool
- **GitHub Pages**: Hosting

## Development

```bash
# Install dependencies
npm install

# Run development server
npm run dev

# Build for production
npm run build

# Deploy to GitHub Pages
npx gh-pages -d dist
```

## API Key
Uses Google Maps Platform API for:
- Photorealistic 3D Tiles
- Geocoding
- Static Maps (minimap)

## Project Structure
```
v8-google/
├── index.html      # Main HTML
├── src/
│   ├── main.js     # Game logic
│   └── style.css   # Styles
├── dist/           # Production build
└── package.json
```

## Branches
- `main`: V8.5 Zombie Apocalypse (current)
- `v9-cartoon`: Experimental OSM-based version

## Credits
- Google Maps Platform for 3D Tiles
- Three.js community
- Built with Claude Code
