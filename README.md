# ClipForge

A CapCut-style video editor that runs in the browser, built step by step.

## Running it

```bash
npm install
npm run dev        # open http://localhost:5173
npm test           # timeline model unit tests
npm run build      # typecheck + production build
```

## Architecture

| Layer | Where | Role |
| --- | --- | --- |
| Data model | `src/types.ts`, `src/timeline/model.ts` | Media assets, tracks and clips. Timeline operations are pure functions (no mutation), which makes undo/redo and export straightforward. |
| State | `src/store/editorStore.ts` | Zustand store: library, timeline, playhead, selection, zoom, canvas ratio. |
| Playback engine | `src/engine/PlaybackEngine.ts` | Master clock plus one media element per clip, kept in sync with the clock; composites visible clips onto the preview canvas every frame. |
| Geometry | `src/engine/geometry.ts` | Where each clip lands on the canvas (transform + crop), hit testing and rotation maths, shared by the renderer and the player's handles. |
| UI | `src/components/*` | Media panel, player, properties panel, timeline. |

Keyboard shortcuts: Space play/pause · Ctrl+B split · Ctrl+Z / Ctrl+Shift+Z (or Ctrl+Y) undo/redo · Ctrl+C / Ctrl+V copy/paste · Ctrl+D duplicate · Del delete · ←/→ step a frame (Shift: 1s).

Timeline rules (matching CapCut):
- **Main track is magnetic:** clips sit back to back with no gaps. Dropping between clips inserts, and deleting closes the gap.
- **Overlay and audio tracks are free:** clips go anywhere but never overlap on the same track.
- Upper tracks render on top of lower ones.
- Clips can't be trimmed past the ends of their source media; images stretch freely.
- Locked tracks can't be edited; hidden tracks don't render; muted tracks are silent.

## Roadmap

- [x] **Step 1: Foundation.** Import video/image/audio, media library, main + overlay + audio tracks, drag & drop, clip move/reorder with snapping, ruler scrubbing, synced preview playback, canvas ratios, zoom, keyboard shortcuts (Space, Del, ←/→).
- [x] **Step 2: Core editing.** Split at playhead, trim handles (with snapping and ripple on the main track), undo/redo, copy/paste/duplicate, track mute/hide/lock.
- [x] **Step 3: Transform & canvas.** Move/scale/rotate clips directly on the player (centre snapping, 90° rotation snapping), opacity, crop, canvas background (colour or blurred video), properties panel with numeric controls.
- [ ] **Step 4: Text & stickers.** Text clips with fonts, styles, animations; stickers.
- [ ] **Step 5: Audio.** Waveforms, volume, fade in/out, extract audio, voiceover recording.
- [ ] **Step 6: Speed & keyframes.** Constant/curve speed, reverse, freeze frame, keyframe animation.
- [ ] **Step 7: Effects, filters, transitions.** WebGL render pipeline, color adjustments, transitions between main-track clips.
- [ ] **Step 8: Export.** Frame-accurate offline render with WebCodecs → MP4, resolution/fps/quality options.
- [ ] **Step 9: Projects.** Save/load projects locally (IndexedDB), autosave, drafts list.
- [ ] **Step 10: AI features.** Auto captions, background removal, smart cut.
- [ ] **Step 11: Platforms.** Desktop (Tauri/Electron) and mobile (Capacitor) packaging, touch UI.
