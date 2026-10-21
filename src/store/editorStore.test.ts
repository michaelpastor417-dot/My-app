import { beforeEach, describe, expect, it } from 'vitest';
import { useEditor } from './editorStore';
import { clipsOnTrack, createTimeline } from '../timeline/model';
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
});
