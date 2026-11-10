import { useRef, useState } from 'react';
import type { Photo, PhotoKind } from '../data/types';
import { makePhoto } from '../lib/photos';
import { Icon } from './Icon';
import '../styles/phone.css';

/** Camera/file button that hands back a compressed, GPS-tagged Photo. */
export function PhotoInput({ kind, label, onPhoto, className = 'photo', style }: { kind: PhotoKind; label: string; onPhoto: (p: Photo) => void; className?: string; style?: React.CSSProperties }) {
  const ref = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  return (
    <>
      <button
        type="button"
        aria-label={label}
        className={`${className} photo-add${error ? ' photo-add--error' : ''}`}
        disabled={busy}
        onClick={() => ref.current?.click()}
        style={style}
      >
        <Icon name={error ? 'warning' : 'camera'} size={24} />
        {busy ? 'Saving…' : error || label}
      </button>
      <input
        ref={ref}
        type="file"
        accept="image/*"
        capture="environment"
        hidden
        onChange={async (e) => {
          const file = e.target.files?.[0];
          e.target.value = '';
          if (!file) return;
          setBusy(true);
          setError('');
          try {
            onPhoto(await makePhoto(file, kind));
          } catch {
            setError('Try again');
          } finally {
            setBusy(false);
          }
        }}
      />
    </>
  );
}

/** Thumbnail for a stored photo; seeded photos have no image data and show a grey tile. */
export function PhotoThumb({ photo, label, onRemove, style }: { photo: Photo; label: string; onRemove?: () => void; style?: React.CSSProperties }) {
  return (
    <div className="photo" role="img" aria-label={label} style={{ position: 'relative', overflow: 'hidden', ...style }}>
      {photo.dataUrl && <img src={photo.dataUrl} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />}
      {!photo.uploaded && (
        <span className="badge badge--amber photo-thumb__badge">
          <Icon name="cloudOff" size={12} />
          Not uploaded
        </span>
      )}
      {onRemove && (
        <button type="button" aria-label={`Remove ${label}`} onClick={onRemove} className="icon-btn photo-thumb__remove">
          <Icon name="close" size={18} />
        </button>
      )}
    </div>
  );
}
