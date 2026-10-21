import { beforeEach, describe, expect, it } from 'vitest';
import { useEditor } from './editorStore';
import { clipsOnTrack, createTimeline } from '../timeline/model';
import { keyframeTimes, transformAt } from '../timeline/animation';
import type { MediaAsset } from '../types';

const video: MediaAsset = { id: 'v', name: 'v.mp4', kind: 'video', url: '', duration: 4 };
const photo: MediaAsset = { id: 'p', name: 'p.png', kind: 'image', url: '', duration: 0 };

const s = () => useEditor.getState();
const mainStarts = () => clipsOnTrack(s().timeline, 'main').map((c) => [c.start, c.duration]);

beforeEach(() => {
  useEditor.setState({
    assets: [video, photo],
    timeline: createTimeline(),
    past: [],
    future: [],
    gestureBase: null,
    gestureDepth: 0,
    currentTime: 0,
    selectedClipId: null,
    clipboard: null,
  });
});

describe('editor store', () => {
  it('undoes and redoes timeline edits', () => {
    s().addToTimeline('v');
    s().addToTimeline('p');
    expect(mainStarts()).toEqual([[0, 4], [4, 3]]);
    s().undo();
    expect(mainStarts()).toEqual([[0, 4]]);
    s().undo();
    expect(mainStarts()).toEqual([]);
    s().redo();
    s().redo();
    expect(mainStarts()).toEqual([[0, 4], [4, 3]]);
  });

  it('a new edit clears the redo stack', () => {
    s().addToTimeline('v');
    s().undo();
    s().addToTimeline('p');
    expect(s().future).toEqual([]);
  });

  it('splits the clip under the playhead', () => {
    s().addToTimeline('v');
    s().select(null);
    s().seek(1);
    s().splitAtPlayhead();
    expect(mainStarts()).toEqual([[0, 1], [1, 3]]);
  });

  it('a whole trim drag undoes as a single step', () => {
    s().addToTimeline('v');
    const id = s().selectedClipId!;
    s().beginGesture();
    s().trimGesture(id, 'end', 3);
    s().trimGesture(id, 'end', 2);
    s().endGesture();
    expect(mainStarts()).toEqual([[0, 2]]);
    s().undo();
    expect(mainStarts()).toEqual([[0, 4]]);
  });

  it('copy and paste places a copy at the playhead', () => {
    s().addToTimeline('v');
    s().copySelected();
    s().seek(4);
    s().paste();
    expect(mainStarts()).toEqual([[0, 4], [4, 4]]);
  });

  it('locked tracks reject edits', () => {
    s().addToTimeline('v');
    const id = s().selectedClipId!;
    s().toggleTrackFlag('main', 'locked');
    s().select(id);
    s().deleteSelected();
    s().seek(1);
    s().splitAtPlayhead();
    expect(mainStarts()).toEqual([[0, 4]]);
  });

  it('adding media while main is locked creates an overlay track instead', () => {
    s().toggleTrackFlag('main', 'locked');
    s().addToTimeline('p');
    expect(mainStarts()).toEqual([]);
    expect(s().timeline.tracks).toHaveLength(2);
  });

  it('slider-style edits of one property undo as a single step', () => {
    s().addToTimeline('v');
    const id = s().selectedClipId!;
    s().updateClip(id, { transform: { scale: 0.9 } }, 'scale');
    s().updateClip(id, { transform: { scale: 0.8 } }, 'scale');
    s().updateClip(id, { transform: { scale: 0.7 } }, 'scale');
    s().updateClip(id, { transform: { opacity: 0.5 } }, 'opacity');
    s().undo();
    expect(s().timeline.clips[0].transform).toMatchObject({ scale: 0.7, opacity: 1 });
    s().undo();
    expect(s().timeline.clips[0].transform.scale).toBe(1);
  });

  it('clamps opacity and crop', () => {
    s().addToTimeline('v');
    const id = s().selectedClipId!;
    s().updateClip(id, { transform: { opacity: 3 }, crop: { left: 0.6, right: 0.6 } });
    const c = s().timeline.clips[0];
    expect(c.transform.opacity).toBe(1);
    expect(c.crop.left + c.crop.right).toBeCloseTo(0.95);
  });

  it('a preview drag (live updates) undoes as one step', () => {
    s().addToTimeline('v');
    const id = s().selectedClipId!;
    s().beginGesture();
    s().updateClipLive(id, { transform: { x: 0.1 } });
    s().updateClipLive(id, { transform: { x: 0.2 } });
    s().endGesture();
    expect(s().timeline.clips[0].transform.x).toBe(0.2);
    s().undo();
    expect(s().timeline.clips[0].transform.x).toBe(0);
  });

  it('background changes are undoable', () => {
    s().setBackground({ type: 'blur', amount: 0.5 });
    expect(s().timeline.background.type).toBe('blur');
    s().undo();
    expect(s().timeline.background.type).toBe('color');
  });

  it('adds preset text at the playhead on a text track above video', () => {
    s().addToTimeline('v');
    s().seek(1);
    s().addText({ presetId: 'subtitle' });
    const clip = s().timeline.clips.find((c) => c.text)!;
    expect(clip).toMatchObject({ start: 1, duration: 3, transform: { y: 0.38 } });
    expect(clip.text!.content).toBe('Subtitle text');
    expect(s().timeline.tracks[0].kind).toBe('text');
  });

  it('reuses a text track when there is room, otherwise stacks a new one', () => {
    s().addText({ presetId: 'default' });
    s().addText({ sticker: '🔥' }); // overlaps the first -> new track
    useEditor.setState({ currentTime: 5 }); // seek() clamps to the timeline end, so set directly
    s().addText({ presetId: 'title' }); // free spot at 5s on the first text track
    const textTracks = s().timeline.tracks.filter((t) => t.kind === 'text');
    expect(textTracks).toHaveLength(2);
  });

  it('edits text content and undoes typing as one step', () => {
    s().addText({ presetId: 'default' });
    const id = s().selectedClipId!;
    s().updateText(id, { content: 'H' }, 'content');
    s().updateText(id, { content: 'Hi' }, 'content');
    expect(s().timeline.clips[0].text!.content).toBe('Hi');
    s().undo();
    expect(s().timeline.clips[0].text!.content).toBe('Default text');
  });

  it('text clips can be trimmed longer freely and pasted', () => {
    s().addText({ presetId: 'default' });
    const id = s().selectedClipId!;
    s().beginGesture();
    s().trimGesture(id, 'end', 20);
    s().endGesture();
    expect(s().timeline.clips[0].duration).toBe(20);
    s().copySelected();
    s().paste();
    expect(s().timeline.clips.filter((c) => c.text)).toHaveLength(2);
  });

  it('detaches audio from a video clip and undoes it', () => {
    s().addToTimeline('v');
    const id = s().selectedClipId!;
    s().detachAudio(id);
    const audioClip = s().timeline.clips.find((c) => c.audioOnly)!;
    expect(audioClip).toMatchObject({ start: 0, duration: 4 });
    expect(s().timeline.tracks.find((t) => t.id === audioClip.trackId)!.kind).toBe('audio');
    // Copy/paste keeps detached audio on an audio track.
    s().select(audioClip.id);
    s().copySelected();
    useEditor.setState({ currentTime: 4 });
    s().paste();
    const pasted = s().timeline.clips.filter((c) => c.audioOnly);
    expect(pasted.every((c) => s().timeline.tracks.find((t) => t.id === c.trackId)!.kind === 'audio')).toBe(true);
    s().undo();
    s().undo();
    expect(s().timeline.clips).toHaveLength(1);
    expect(s().timeline.clips[0].audioDetached).toBeUndefined();
  });

  it('volume and fades are clamped and undoable', () => {
    s().addToTimeline('v');
    const id = s().selectedClipId!;
    s().updateClip(id, { audio: { volume: 9, fadeIn: 3, fadeOut: 3 } });
    expect(s().timeline.clips[0].audio).toEqual({ volume: 2, fadeIn: 3, fadeOut: 1 });
    s().undo();
    expect(s().timeline.clips[0].audio).toEqual({ volume: 1, fadeIn: 0, fadeOut: 0 });
  });

  it('keyframes: edits at different playhead positions animate the clip', () => {
    s().addToTimeline('v');
    const id = s().selectedClipId!;
    s().seek(0);
    s().toggleKeyframe(id);
    s().seek(2);
    s().updateClip(id, { transform: { x: 0.5 } });
    const clip = s().timeline.clips[0];
    expect(clip.keyframes!.map((k) => [k.time, k.transform.x])).toEqual([[0, 0], [2, 0.5]]);
    expect(transformAt(clip, 1).x).toBeCloseTo(0.25);
    s().undo();
    s().undo();
    expect(s().timeline.clips[0].keyframes).toBeUndefined();
  });

  it('keyframe edits stay inside the clip even if the playhead is past it', () => {
    s().addToTimeline('v');
    s().addToTimeline('p');
    const photo = s().selectedClipId!;
    s().toggleKeyframe(photo); // playhead at 0 -> held to the photo's start (4s)
    expect(keyframeTimes(s().timeline.clips.find((c) => c.id === photo)!)).toEqual([4]);
  });

  it('changes speed, ripples, and undoes a slider drag in one step', () => {
    s().addToTimeline('v');
    s().addToTimeline('p');
    const id = s().timeline.clips.find((c) => c.assetId === 'v')!.id;
    s().setSpeed(id, 1.5, 'speed');
    s().setSpeed(id, 2, 'speed');
    expect(mainStarts()).toEqual([[0, 2], [2, 3]]);
    s().undo();
    expect(mainStarts()).toEqual([[0, 4], [4, 3]]);
  });

  it('inserts a freeze frame at the playhead and selects it', () => {
    s().addToTimeline('v');
    s().select(null);
    s().seek(1);
    s().freezeFrame();
    expect(mainStarts()).toEqual([[0, 1], [1, 3], [4, 3]]);
    expect(s().timeline.clips.find((c) => c.id === s().selectedClipId)!.freezeAt).toBe(1);
  });

  it('applies a filter from the library to the main clip under the playhead and tunes it', () => {
    s().addToTimeline('v');
    s().select(null);
    s().applyFilter('warm');
    const id = s().timeline.clips[0].id;
    expect(s().timeline.clips[0].filter).toEqual({ id: 'warm', intensity: 1 });
    s().setFilter(id, { id: 'warm', intensity: 0.4 }, 'intensity');
    s().setFilter(id, { id: 'warm', intensity: 0.3 }, 'intensity');
    s().setAdjustment(id, 'contrast', 20);
    s().setAdjustment(id, 'contrast', 30);
    expect(s().timeline.clips[0]).toMatchObject({ filter: { intensity: 0.3 }, adjust: { contrast: 30 } });
    s().undo(); // both contrast edits
    s().undo(); // both intensity edits
    expect(s().timeline.clips[0]).toMatchObject({ filter: { intensity: 1 } });
    expect(s().timeline.clips[0].adjust).toBeUndefined();
  });

  it('adds a transition at the cut nearest the playhead and deletes it with Delete', () => {
    s().addToTimeline('v');
    s().addToTimeline('p');
    useEditor.setState({ currentTime: 3.6 });
    s().applyTransition('slide-left');
    const first = clipsOnTrack(s().timeline, 'main')[0];
    expect(first.transition).toEqual({ type: 'slide-left', duration: 0.5 });
    expect(mainStarts()).toEqual([[0, 4], [3.5, 3]]);
    expect(s().selectedTransitionId).toBe(first.id);
    s().deleteSelected();
    expect(mainStarts()).toEqual([[0, 4], [4, 3]]);
  });

  it('does not apply effects to text or audio', () => {
    s().addText({ presetId: 'default' });
    s().applyEffect('glitch');
    expect(s().timeline.clips[0].effect).toBeUndefined();
  });

  it('removes silences from a clip and reports what was cut', () => {
    // 4s of video at 100 peaks/s: speech 0-1s, silence 1-3s, speech 3-4s
    const peaks = [...Array(100).fill(0.8), ...Array(200).fill(0.001), ...Array(100).fill(0.8)];
    useEditor.setState({ assets: [{ ...video, peaks }, photo] });
    s().addToTimeline('v');
    s().addToTimeline('p');
    const result = s().removeSilences(s().timeline.clips[0].id);
    expect(result).toEqual({ pauses: 1, seconds: expect.closeTo(1.76, 2) });
    expect(mainStarts().map(([a, b]) => [+a.toFixed(2), +b.toFixed(2)])).toEqual([[0, 1.12], [1.12, 1.12], [2.24, 3]]);
    s().undo();
    expect(mainStarts()).toEqual([[0, 4], [4, 3]]);
  });

  it('explains why silences cannot be removed', () => {
    s().addToTimeline('p');
    expect(s().removeSilences(s().timeline.clips[0].id)).toEqual({ error: 'Pick a video or audio clip.' });
    useEditor.setState({ assets: [video, photo] }); // no waveform yet
    s().addToTimeline('v');
    const v = s().timeline.clips.find((c) => c.assetId === 'v')!;
    expect(s().removeSilences(v.id)).toEqual({ error: 'Still analysing the sound. Try again in a moment.' });
  });

  it('adds captions as subtitle clips on their own text track, in one undo step', () => {
    s().addToTimeline('v');
    const id = s().timeline.clips[0].id;
    const added = s().addCaptions(id, [
      { text: 'Hello everyone', start: 0.5, end: 1.5 },
      { text: 'welcome back', start: 2, end: 3 },
    ]);
    expect(added).toBe(2);
    const captions = s().timeline.clips.filter((c) => c.text);
    expect(captions.map((c) => [c.text!.content, c.start, c.duration])).toEqual([
      ['Hello everyone', 0.5, 1],
      ['welcome back', 2, 1],
    ]);
    expect(new Set(captions.map((c) => c.trackId)).size).toBe(1);
    expect(captions[0].transform.y).toBe(0.38); // subtitle position
    s().undo();
    expect(s().timeline.clips.filter((c) => c.text)).toHaveLength(0);
  });

  it('toggles background removal', () => {
    s().addToTimeline('v');
    const id = s().timeline.clips[0].id;
    s().setRemoveBackground(id, true);
    expect(s().timeline.clips[0].removeBackground).toBe(true);
    s().setRemoveBackground(id, false);
    expect(s().timeline.clips[0].removeBackground).toBeUndefined();
  });

  it('overlapping gestures (move + pinch) undo as a single step', () => {
    s().addToTimeline('v');
    const id = s().selectedClipId!;
    s().beginGesture(); // one finger starts moving
    s().updateClipLive(id, { transform: { x: 0.1 } });
    s().beginGesture(); // second finger starts pinching
    s().updateClipLive(id, { transform: { scale: 1.5 } });
    s().endGesture(); // pinch ends: still mid-gesture
    expect(s().past).toHaveLength(1); // only the add
    s().updateClipLive(id, { transform: { x: 0.2 } });
    s().endGesture(); // move ends
    expect(s().timeline.clips[0].transform).toMatchObject({ x: 0.2, scale: 1.5 });
    s().undo();
    expect(s().timeline.clips[0].transform).toMatchObject({ x: 0, scale: 1 });
  });
});
