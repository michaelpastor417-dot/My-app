# ClipForge

A CapCut-style video editor that runs in the browser, built step by step.

## Running it

```bash
npm install        # if a firewall blocks onnxruntime-node's binary download, add --ignore-scripts (the browser app doesn't use it)
npm run dev        # open http://localhost:5173
npm test           # timeline model unit tests
npm run build      # typecheck + production build
```

## Architecture

| Layer | Where | Role |
| --- | --- | --- |
| Data model | `src/types.ts`, `src/timeline/model.ts` | Media assets, tracks and clips. Timeline operations are pure functions (no mutation), which makes undo/redo and export straightforward. |
| State | `src/store/editorStore.ts` | Zustand store: library, timeline, playhead, selection, zoom, canvas ratio. |
| Playback engine | `src/engine/PlaybackEngine.ts` | Master clock plus one media element per clip, kept in sync with the clock; hands each frame to the compositor. |
| Compositor | `src/engine/Compositor.ts` | Draws one frame of the timeline (background, tracks, text, GPU looks, transitions). Shared by preview and export so both look identical. |
| Export | `src/export/*` | Frame-by-frame render with exact seeking, offline audio mix with WSOLA time-stretch, encoding and MP4 muxing via [Mediabunny](https://mediabunny.dev). |
| Clip time & keyframes | `src/timeline/animation.ts` | Maps timeline time to media time (speed, reverse, freeze) and interpolates keyframes; keyframes live in media time so trims, splits and speed changes keep them on the same frames. |
| Audio | `src/engine/audio.ts` | Volume/fade gain curve, waveform peak extraction and resampling (pure, tested). Playback routes every clip through a Web Audio gain node. |
| Text | `src/engine/text.ts`, `src/timeline/textPresets.ts` | Text layout, drawing and in/out animations (pure, tested); preset styles and stickers. |
| GPU | `src/engine/gpu.ts` | WebGL2 shaders: per-clip colour grading + effects, and transitions between two canvas-sized layers. The 2D compositor places the results. |
| Looks & transitions | `src/timeline/look.ts`, `src/timeline/transitions.ts` | Filter presets, adjustments and effects resolved into shader inputs; transition overlap, timing and audio crossfade (pure, tested). |
| Geometry | `src/engine/geometry.ts` | Where each clip lands on the canvas (transform + crop), hit testing and rotation maths, shared by the renderer and the player's handles. |
| Projects | `src/projects/*` | IndexedDB storage of project documents and media files, autosave, open/close, import; versioned format with an upgrade hook (tested with fake-indexeddb). |
| AI | `src/ai/*` | Silence detection and caption timing (pure, tested); Whisper worker; MediaPipe segmenter used by the compositor for background removal. |
| UI | `src/components/*` | Media panel, player, properties panel, timeline. |

Keyboard shortcuts: Space play/pause · Ctrl+B split · Ctrl+Z / Ctrl+Shift+Z (or Ctrl+Y) undo/redo · Ctrl+C / Ctrl+V copy/paste · Ctrl+D duplicate · Del delete · ←/→ step a frame (Shift: 1s).

Timeline rules (matching CapCut):
- **Main track is magnetic:** clips sit back to back with no gaps. Dropping between clips inserts, and deleting closes the gap. A transition makes the next clip overlap the previous one by its length (at most half of either clip).
- **Overlay and audio tracks are free:** clips go anywhere but never overlap on the same track.
- Upper tracks render on top of lower ones. Text tracks always sit above video tracks, audio below.
- Clips can't be trimmed past the ends of their source media; images stretch freely.
- Locked tracks can't be edited; hidden tracks don't render; muted tracks are silent.

## Roadmap

- [x] **Step 1: Foundation.** Import video/image/audio, media library, main + overlay + audio tracks, drag & drop, clip move/reorder with snapping, ruler scrubbing, synced preview playback, canvas ratios, zoom, keyboard shortcuts (Space, Del, ←/→).
- [x] **Step 2: Core editing.** Split at playhead, trim handles (with snapping and ripple on the main track), undo/redo, copy/paste/duplicate, track mute/hide/lock.
- [x] **Step 3: Transform & canvas.** Move/scale/rotate clips directly on the player (centre snapping, 90° rotation snapping), opacity, crop, canvas background (colour or blurred video), properties panel with numeric controls.
- [x] **Step 4: Text & stickers.** Text presets (title, subtitle, outline, boxed, typewriter, pop…), font/size/colour/bold/italic/alignment, outline, shadow, background box, in/out animations (fade, slide, pop, typewriter), emoji stickers; edited in the Properties panel and moved/scaled/rotated on the player.
- [x] **Step 5: Audio.** Waveforms on audio and video clips, per-clip volume (0–200%), fade in/out, detach audio from video, voiceover recording from the microphone, Audio tab.
- [x] **Step 6: Speed & keyframes.** Speed 0.1×–10× (presets or exact), reverse, freeze frame, keyframe animation of position/scale/rotation/opacity/volume with CapCut-style auto-keyframing, keyframe navigation and timeline diamonds. (Speed curves come later.)
- [x] **Step 7: Effects, filters, transitions.** WebGL2 pipeline: 10 colour adjustments, 10 filters with strength (previews rendered by the real shader), 8 effects (blur, vignette, glitch, RGB split, pixelate, grain, mirror, shake), 9 transitions between main-track clips with overlap and audio crossfade; tabbed Properties panel.
- [x] **Step 8: Export.** Frame-accurate MP4 export (480p–4K, 24–60 fps, three quality levels) through the same compositor as the preview; offline audio mix with keyframes, fades, crossfades, reversed audio and pitch-preserving speed changes; progress, cancel, in-dialog playback. H.264/AAC where the browser supports it, otherwise VP9/Opus.
- [x] **Step 9: Projects.** Home screen with project cards (thumbnail, length, last edited), new / open / rename / duplicate / delete, autosave (with a save indicator) into the browser's IndexedDB, imported media and voiceovers stored once and shared between copies, unused files cleaned up on delete, versioned project format.
- [x] **Step 10: AI features (on-device).** Auto captions with Whisper running in a Web Worker (model downloaded once from Hugging Face, then cached; runtime served by the app), background removal with MediaPipe's person segmenter (model bundled, works offline; preview and export), and silence removal from the waveform. AI tab plus a Remove background switch in the clip's Video settings.
- [ ] **Step 11: Platforms.** Desktop (Tauri/Electron) and mobile (Capacitor) packaging, touch UI.
