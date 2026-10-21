import { useEditor } from '../store/editorStore';
import { formatTime } from '../utils/time';

export function Inspector() {
  const clip = useEditor((s) => s.timeline.clips.find((c) => c.id === s.selectedClipId));
  const asset = useEditor((s) => (clip ? s.assets.find((a) => a.id === clip.assetId) : undefined));
  const track = useEditor((s) => (clip ? s.timeline.tracks.find((t) => t.id === clip.trackId) : undefined));

  return (
    <aside className="panel inspector">
      <div className="panel-title">Properties</div>
      {!clip || !asset ? (
        <p className="empty-hint">Select a clip on the timeline to see its properties.</p>
      ) : (
        <dl className="props">
          <dt>Name</dt>
          <dd title={asset.name}>{asset.name}</dd>
          <dt>Type</dt>
          <dd>{asset.kind}</dd>
          <dt>Track</dt>
          <dd>{track?.isMain ? 'Main track' : `${track?.kind} overlay`}</dd>
          <dt>Start</dt>
          <dd>{formatTime(clip.start, true)}</dd>
          <dt>Duration</dt>
          <dd>{formatTime(clip.duration, true)}</dd>
          {asset.width && (
            <>
              <dt>Resolution</dt>
              <dd>
                {asset.width}×{asset.height}
              </dd>
            </>
          )}
        </dl>
      )}
    </aside>
  );
}
