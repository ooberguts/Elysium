import { useState, type FormEvent } from 'react';
import { LoaderCircle, Search } from 'lucide-react';
import { Artwork, Modal } from './components';
import { native, open, savePath } from './bridge';
import { seconds } from './domain';
import type { Match, MediaItem } from './types';

const fields = [
  ['title', 'Title'],
  ['artist', 'Artist'],
  ['album', 'Album'],
  ['albumArtist', 'Album artist'],
  ['genre', 'Genre'],
  ['year', 'Year'],
  ['track', 'Track'],
  ['disc', 'Disc'],
] as const;
export function MetadataDialog({
  items,
  close,
  changed,
  notify,
  activeId,
  stopPlayback,
}: {
  items: MediaItem[];
  close: () => void;
  changed: () => Promise<void>;
  notify: (message: string) => void;
  activeId: string | null;
  stopPlayback: () => Promise<void>;
}) {
  const [changes, setChanges] = useState<Record<string, string>>({}),
    [write, setWrite] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [matches, setMatches] = useState<Match[] | null>(null),
    [lookup, setLookup] = useState(false),
    [tab, setTab] = useState('details'),
    [coverBusy, setCoverBusy] = useState(false),
    [saved, setSaved] = useState(false);
  const item = items[0],
    single = items.length === 1,
    video = item.kind === 'movie' || item.kind === 'tv',
    remote = items.some((i) => i.serverId);
  const mixed = (key: string) =>
    new Set(items.map((i) => String((i as unknown as Record<string, unknown>)[key] ?? ''))).size >
    1;
  const compatible = items.filter((i) => ['MP3', 'FLAC'].includes(i.format) && !i.serverId).length;
  const reset = (key: string) => {
    setSaved(false);
    setChanges((old) => {
      const next = { ...old };
      delete next[key];
      return next;
    });
  };
  const draftCover = {
    ...item,
    artwork: changes.artwork === undefined ? item.artwork : changes.artwork || null,
  };
  async function chooseCover() {
    const path = await open({
      multiple: false,
      title: video ? 'Choose video cover artwork' : 'Choose front cover artwork',
      filters: [{ name: 'Cover artwork', extensions: ['jpg', 'jpeg', 'png'] }],
    });
    if (typeof path !== 'string') return;
    setCoverBusy(true);
    setError('');
    try {
      update('artwork', await native<string>('prepare_cover', { path }));
    } catch (e) {
      setError(String(e));
    } finally {
      setCoverBusy(false);
    }
  }
  const fieldValue = (key: string) => {
    const values = new Set(
      items.map((i) => String((i as unknown as Record<string, unknown>)[key] ?? '')),
    );
    return values.size === 1 ? [...values][0] : '';
  };
  const value = (key: string) => changes[key] ?? fieldValue(key);
  const update = (key: string, value: string) => {
    setSaved(false);
    setError('');
    setChanges((prev) => ({ ...prev, [key]: value }));
  };
  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!Object.keys(changes).length) return;
    if (write && items.some((i) => i.id === activeId)) {
      setError(
        'Stop or switch away from this item before writing its file tags. Library-only changes can be saved during playback.',
      );
      return;
    }
    setBusy(true);
    setError('');
    try {
      const result = await native<{
        saved: number;
        embedded: number;
        errors: string[];
        warnings: string[];
      }>('update_metadata', {
        ids: items.map((i) => i.id),
        changes,
        writeFiles: write,
      });
      await changed();
      if (result.errors.length || result.warnings.length) {
        setSaved(true);
        setError(
          `${result.saved} saved in Elysium · ${result.embedded} files updated.\n${[...result.warnings, ...result.errors].join('\n')}`,
        );
      } else {
        notify(
          `${result.saved} ${result.saved === 1 ? 'item' : 'items'} updated${write ? ` · ${result.embedded} files updated with backups` : ' in Elysium'}`,
        );
        close();
      }
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  }
  async function find() {
    setLookup(true);
    setError('');
    try {
      setMatches(
        await native<Match[]>('find_metadata', { title: value('title'), artist: value('artist') }),
      );
    } catch (e) {
      setError(String(e));
    } finally {
      setLookup(false);
    }
  }
  async function nfo() {
    const path = await savePath(`${item.title}.nfo`, 'nfo');
    if (path) {
      await native('export_nfo', { id: item.id, path });
      notify('NFO sidecar exported');
    }
  }
  return (
    <Modal
      title={single ? 'Edit metadata' : `Edit metadata · ${items.length} items`}
      close={() => {
        if (!busy) close();
      }}
      wide
    >
      <form onSubmit={submit} className="metadata-form">
        <div className="info-overview">
          <Artwork item={draftCover} />
          <div>
            <h3>{single ? item.title : `${items.length} selected items`}</h3>
            <p>
              {single
                ? item.artist || item.series || item.format
                : 'Only fields you change will be applied.'}
            </p>
            <small>
              {single
                ? `${item.format} · ${seconds(item.duration)}${item.sampleRate ? ` · ${item.sampleRate / 1000} kHz` : ''}`
                : 'Different values are marked; untouched fields stay as they are.'}
            </small>
          </div>
        </div>
        <div className="segmented">
          <button
            type="button"
            className={tab === 'details' ? 'active' : ''}
            onClick={() => setTab('details')}
          >
            Details
          </button>
          <button
            type="button"
            className={tab === 'artwork' ? 'active' : ''}
            onClick={() => setTab('artwork')}
          >
            Cover art
          </button>
          <button
            type="button"
            className={tab === 'source' ? 'active' : ''}
            onClick={() => setTab('source')}
          >
            Source & recovery
          </button>
        </div>
        {tab === 'details' ? (
          <>
            <div className="form-grid">
              {(video
                ? [
                    ['title', 'Title'],
                    ['series', 'Series'],
                    ['season', 'Season'],
                    ['episode', 'Episode'],
                    ['genre', 'Genre'],
                    ['year', 'Year'],
                  ]
                : fields
              ).map(([key, label]) => (
                <label key={key}>
                  <span className="metadata-field-label">
                    {label}
                    {Object.hasOwn(changes, key) && (
                      <button
                        type="button"
                        disabled={busy}
                        aria-label={`Undo ${label.toLowerCase()} change`}
                        onClick={() => reset(key)}
                        title={`Keep original ${label.toLowerCase()}`}
                      >
                        Undo
                      </button>
                    )}
                  </span>
                  <input
                    aria-label={label}
                    value={value(key)}
                    placeholder={mixed(key) ? 'Multiple values — unchanged' : ''}
                    type={['track', 'disc', 'season', 'episode'].includes(key) ? 'number' : 'text'}
                    min="0"
                    onChange={(e) => update(key, e.target.value)}
                    disabled={remote || busy}
                  />
                </label>
              ))}
              {!video && (
                <label>
                  <span className="metadata-field-label">
                    Rating
                    {Object.hasOwn(changes, 'rating') && (
                      <button
                        type="button"
                        disabled={busy}
                        aria-label="Undo rating change"
                        onClick={() => reset('rating')}
                      >
                        Undo
                      </button>
                    )}
                  </span>
                  <select
                    aria-label="Rating for selected songs"
                    value={value('rating')}
                    onChange={(e) => update('rating', e.target.value)}
                    disabled={remote || busy}
                  >
                    {mixed('rating') && (
                      <option value="" disabled>
                        Multiple ratings — unchanged
                      </option>
                    )}
                    <option value="0">Unrated</option>
                    {[1, 2, 3, 4, 5].map((n) => (
                      <option key={n} value={n}>
                        {'★'.repeat(n)} · {n} of 5
                      </option>
                    ))}
                  </select>
                </label>
              )}
              {video && (
                <label className="full-span">
                  Overview
                  <textarea
                    rows={3}
                    value={value('overview')}
                    onChange={(e) => update('overview', e.target.value)}
                    disabled={remote || busy}
                  />
                </label>
              )}
            </div>
            {!single && !video && Object.hasOwn(changes, 'album') && (
              <p className="form-note">
                For songs by different performers, use one Album artist to keep them together.{' '}
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => update('albumArtist', 'Various Artists')}
                >
                  Use Various Artists
                </button>
              </p>
            )}
            {single && !video && !remote && (
              <button
                type="button"
                className="lookup-button"
                disabled={lookup || busy}
                onClick={() => void find()}
              >
                {lookup ? <LoaderCircle className="spin" size={15} /> : <Search size={15} />}Find
                matches on MusicBrainz
              </button>
            )}
            {matches && (
              <div className="match-list">
                {!matches.length && (
                  <p>No matches found. Try editing the title or artist before searching again.</p>
                )}
                {matches.map((match) => (
                  <button
                    type="button"
                    disabled={busy}
                    key={match.id}
                    onClick={() => {
                      setChanges((prev) => ({
                        ...prev,
                        title: match.title,
                        artist: match.artist,
                        ...(match.album ? { album: match.album } : {}),
                        ...(match.year ? { year: match.year } : {}),
                      }));
                      setMatches(null);
                    }}
                  >
                    <span>
                      <strong>{match.title}</strong>
                      <small>
                        {match.artist} · {match.album || 'Release not identified'} {match.year}
                      </small>
                    </span>
                    <span>{match.score}%</span>
                  </button>
                ))}
              </div>
            )}
            {remote && (
              <p className="notice">
                This item is managed by Jellyfin. Edit its metadata on your server.
              </p>
            )}
          </>
        ) : tab === 'artwork' ? (
          <section className="cover-editor">
            <div className="cover-comparison">
              <div>
                <Artwork item={item} />
                <span>{mixed('artwork') ? 'Multiple existing covers' : 'Current cover'}</span>
              </div>
              <span aria-hidden="true">→</span>
              <div>
                <Artwork item={draftCover} />
                <span>
                  {Object.hasOwn(changes, 'artwork')
                    ? changes.artwork
                      ? 'New front cover'
                      : video
                        ? 'Automatic video frame after saving'
                        : 'No front cover'
                    : 'Unchanged'}
                </span>
              </div>
            </div>
            <p>
              {single
                ? video
                  ? 'Choose a cover for this video. Without a custom cover, Elysium uses a still frame.'
                  : 'Choose the artwork that represents this song.'
                : `Apply one front cover to all ${items.length} selected items.`}
            </p>
            <div className="cover-actions">
              <button
                type="button"
                disabled={remote || coverBusy || busy}
                onClick={() => void chooseCover().catch((e) => setError(String(e)))}
              >
                {coverBusy ? 'Reading artwork…' : 'Choose cover image…'}
              </button>
              <button type="button" disabled={remote || busy} onClick={() => update('artwork', '')}>
                {video ? 'Use automatic video frame' : 'Remove front cover'}
              </button>
              {Object.hasOwn(changes, 'artwork') && (
                <button type="button" disabled={busy} onClick={() => reset('artwork')}>
                  Keep existing covers
                </button>
              )}
            </div>
            <small>
              {video
                ? 'JPEG or PNG, up to 8 MB. Covers are stored in Elysium; video files stay unchanged.'
                : 'JPEG or PNG, up to 8 MB. Back covers and other embedded pictures are preserved.'}
            </small>
          </section>
        ) : (
          <div className="source-information">
            <p className="file-path">{item.path}</p>
            <p>
              {Object.keys(item.overrides).length
                ? `${Object.keys(item.overrides).length} library overrides are protected from rescans.`
                : 'Information comes from embedded tags, local sidecars, or the filename.'}
            </p>
            {single && !remote && (
              <button
                type="button"
                disabled={busy}
                onClick={async () => {
                  setBusy(true);
                  try {
                    await native('restore_tags', { id: item.id });
                    await changed();
                    notify('Original file tags restored');
                    close();
                  } catch (e) {
                    setError(String(e));
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                Restore last embedded-tag backup
              </button>
            )}
            {single && video && !remote && (
              <button type="button" onClick={() => void nfo().catch((e) => setError(String(e)))}>
                Export Kodi NFO sidecar
              </button>
            )}
          </div>
        )}
        {!remote && (
          <fieldset className="metadata-destination" disabled={busy}>
            <legend>Save changes to</legend>
            <label>
              <input
                type="radio"
                name="metadata-destination"
                checked={!write}
                onChange={() => setWrite(false)}
              />{' '}
              Elysium library
            </label>
            <label>
              <input
                type="radio"
                name="metadata-destination"
                checked={write}
                disabled={!compatible}
                onChange={() => setWrite(true)}
              />{' '}
              Library + compatible files ({compatible} MP3 / FLAC)
            </label>
            <p>
              {write
                ? 'Files are backed up and their audio is verified. Any file that cannot be updated keeps its changes in Elysium, with a report.'
                : 'Personal edits survive rescans. Original media files stay unchanged.'}
            </p>
            {write && items.some((i) => i.id === activeId) && (
              <p className="notice">
                A selected item is open for playback.{' '}
                <button
                  type="button"
                  onClick={() => void stopPlayback().catch((e) => setError(String(e)))}
                >
                  Stop playback to write file tags
                </button>
              </p>
            )}
          </fieldset>
        )}
        {Object.keys(changes).length > 0 && (
          <div className="metadata-review">
            <strong>
              {Object.keys(changes).length} {Object.keys(changes).length === 1 ? 'field' : 'fields'}{' '}
              to update across {items.length} {single ? 'item' : 'items'}
            </strong>
            {Object.entries(changes).map(([key, next]) => (
              <div className="metadata-review-line" key={key}>
                <span>
                  {key === 'artwork'
                    ? 'Front cover'
                    : key === 'albumArtist'
                      ? 'Album artist'
                      : key[0].toUpperCase() + key.slice(1)}
                </span>
                <span>
                  {key === 'artwork'
                    ? mixed(key)
                      ? 'Multiple covers'
                      : item.artwork
                        ? 'Existing cover'
                        : 'No cover'
                    : mixed(key)
                      ? 'Multiple values'
                      : fieldValue(key) || 'Empty'}
                </span>
                <span>→</span>
                <strong>
                  {key === 'artwork'
                    ? next
                      ? 'Chosen image'
                      : video
                        ? 'Use automatic video frame'
                        : 'Remove front cover'
                    : key === 'rating'
                      ? next === '0'
                        ? 'Unrated'
                        : `${next} of 5 stars`
                      : next || 'Clear field'}
                </strong>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => reset(key)}
                  aria-label={`Revert ${key} change`}
                >
                  Undo
                </button>
              </div>
            ))}
            {!single && (
              <details>
                <summary>Review affected items ({items.length})</summary>
                <ul>
                  {items.map((i) => (
                    <li key={i.id}>
                      <strong>{i.title}</strong>
                      <small>
                        {i.artist || 'Unknown artist'} · {i.album || 'No album'} · {i.format}
                      </small>
                    </li>
                  ))}
                </ul>
              </details>
            )}
            {!single && Object.hasOwn(changes, 'title') && (
              <p className="notice">Every selected item will receive the same title.</p>
            )}
          </div>
        )}
        {error && (
          <p
            className={saved ? 'notice save-report' : 'error-message'}
            role={saved ? 'status' : 'alert'}
          >
            {error}
          </p>
        )}
        <div className="dialog-actions">
          <button type="button" onClick={close} disabled={busy}>
            {saved ? 'Done' : 'Cancel'}
          </button>
          <button
            className="primary"
            type="submit"
            disabled={busy || coverBusy || saved || remote || !Object.keys(changes).length}
          >
            {busy ? 'Saving…' : 'Save changes'}
          </button>
        </div>
      </form>
    </Modal>
  );
}
