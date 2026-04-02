# Changelog

## V8.5 - Zombie Apocalypse (Current)

### Added
- **Jet Fighter**: High-speed aircraft (~600 MPH) for covering 20 miles in ~2 minutes
  - W/S for throttle, A/D for turning, arrows for pitch
  - Camera pulls back at high speeds
  - Engine glow effect
- **Wingsuit**: Deploy with G while in air after jetpacking
  - Glides forward while falling slowly
  - Hold SHIFT to glide faster
  - Auto-retracts on landing
- **Night Mode**: Press N to toggle day/night
  - Dark sky with blue moonlight tint
  - Dimmed ambient lighting
- **Zombies**: 15 wandering zombies with AI
  - Shambling animation with reaching arms
  - Glowing red eyes
  - Take 3 paintball hits to kill
  - Respawn after 8-13 seconds
  - Red dots on minimap
- **Kill Notifications**: "ZOMBIE KILLED!" popup

### Changed
- **Controls Revamped**:
  - WASD for movement only
  - Arrow keys for looking around
  - `/` key for shooting (was Command, then changed due to browser shortcuts)
  - Camera auto-follows movement direction (arrows override)
- **Paintball Aiming**: Now shoots where camera looks, not just forward
- **Pitch Limit**: Can look up higher for better aiming
- **More Cars**: 8 abandoned cars scattered around (post-apocalyptic theme)

### Fixed
- Minimap now has north always up
- Player indicator rotates to show facing direction
- Added Google Maps Static image as minimap background (shows streets)

---

## V8 - Google Photorealistic

### Added
- **Google 3D Tiles**: Real-world photorealistic 3D environments
- **Third-Person Character**: Animated humanoid with running animation
- **Vehicles**: 5 drivable cars with physics
- **Jetpack**: Toggle with J, hold SHIFT to fly, fuel management
- **Paintball Mode**: Toggle with P, click or hold to shoot colored paintballs
- **Minimap**: Shows north, markers, vehicles, spawn point
- **Mobile Support**:
  - Virtual joystick for movement
  - Touch look zone
  - Hamburger menu for features
  - Auto-sprint toggle
- **Controls Key**: On-screen control reference (toggle with H)
- **Markers**: Drop markers with M, clear with C
- **Speedometer**: Shows MPH when in vehicle
- **GPS Support**: Use current location

### Technical
- ECEF to local ENU coordinate transformation
- Raycasting for ground height detection
- Smooth camera following
- Google Geocoding API integration

---

## V7 (Previous - Not in this repo)
- Used OpenStreetMap data
- Had issues with elevation, broken streets, poor building quality
- Led to rewrite using Google 3D Tiles

---

## V9-Cartoon (Experimental Branch)
- Attempted pure OSM-based approach
- Simple box buildings with collision detection
- Road segments from OSM data
- Currently on hold - Google 3D Tiles provide better visuals
