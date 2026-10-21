import type { Clip, MediaAsset, Timeline } from '../types';
import { clipGain } from '../engine/audio';
import { volumeAt } from '../timeline/animation';
import { transitionGain } from '../timeline/transitions';
import { timeStretch } from './timeStretch';

/** Gain automation resolution for export, in points per second. */
const GAIN_POINTS_PER_SECOND = 100;

/** Clips whose sound belongs in the export: audible media on unmuted tracks. */
export function audibleClips(timeline: Timeline, assets: MediaAsset[]): Clip[] {
  return timeline.clips.filter((c) => {
    const asset = assets.find((a) => a.id === c.assetId);
    const track = timeline.tracks.find((t) => t.id === c.trackId);
    return (
      asset &&
      !asset.missing &&
      asset.kind !== 'image' &&
      asset.peaks?.length !== 0 && // known to be silent
      !c.text &&
      !c.audioDetached &&
      c.freezeAt === undefined &&
      !track?.muted
    );
  });
}

/**
 * A clip's volume over its length, sampled for Web Audio automation: volume
 * keyframes × fades × transition crossfade, exactly as the preview applies them.
 */
export function gainCurve(timeline: Timeline, clip: Clip, pointsPerSecond = GAIN_POINTS_PER_SECOND): Float32Array {
  const points = Math.max(2, Math.ceil(clip.duration * pointsPerSecond) + 1);
  const curve = new Float32Array(points);
  for (let i = 0; i < points; i++) {
    // Sample just inside the clip at its ends so fades read 0 rather than "outside".
    const t = clip.start + Math.min(clip.duration - 1e-6, (i / (points - 1)) * clip.duration);
    curve[i] = clipGain(clip, t, volumeAt(clip, t)) * transitionGain(timeline, clip, t);
  }
  return curve;
}

/**
 * The part of a decoded source a clip plays, as it should sound: cut to the
 * clip's source span, reversed if the clip is, and time-stretched (keeping
 * pitch) to the clip's speed.
 */
export function clipSamples(source: Float32Array[], sampleRate: number, clip: Clip): Float32Array[] {
  const from = Math.max(0, Math.round(clip.inPoint * sampleRate));
  const to = Math.min(source[0]?.length ?? 0, Math.round((clip.inPoint + clip.duration * clip.speed) * sampleRate));
  let channels: Float32Array[] = source.map((c) => c.slice(from, Math.max(from, to)));
  if (clip.reversed) channels = channels.map((c) => c.reverse());
  if (clip.speed !== 1 && channels[0]?.length) channels = timeStretch(channels, clip.speed);
  return channels;
}

/**
 * Render the whole timeline's sound into one stereo AudioBuffer.
 * `decode` returns an asset's decoded audio at `sampleRate`, or null if it has none.
 */
export async function mixAudio(
  timeline: Timeline,
  assets: MediaAsset[],
  duration: number,
  sampleRate: number,
  decode: (asset: MediaAsset) => Promise<AudioBuffer | null>,
): Promise<AudioBuffer> {
  const ctx = new OfflineAudioContext(2, Math.max(1, Math.ceil(duration * sampleRate)), sampleRate);
  const decoded = new Map<string, AudioBuffer | null>();
  for (const clip of audibleClips(timeline, assets)) {
    const asset = assets.find((a) => a.id === clip.assetId)!;
    if (!decoded.has(asset.id)) decoded.set(asset.id, await decode(asset));
    const buffer = decoded.get(asset.id);
    if (!buffer) continue;
    const source = Array.from({ length: buffer.numberOfChannels }, (_, i) => buffer.getChannelData(i));
    const samples = clipSamples(source, sampleRate, clip);
    if (!samples[0]?.length) continue;

    const clipBuffer = ctx.createBuffer(samples.length, samples[0].length, sampleRate);
    samples.forEach((data, i) => clipBuffer.copyToChannel(data as Float32Array<ArrayBuffer>, i));
    const node = ctx.createBufferSource();
    node.buffer = clipBuffer;
    const gain = ctx.createGain();
    gain.gain.setValueCurveAtTime(gainCurve(timeline, clip), clip.start, clip.duration);
    node.connect(gain).connect(ctx.destination);
    node.start(clip.start);
    node.stop(clip.start + clip.duration);
  }
  return ctx.startRendering();
}
