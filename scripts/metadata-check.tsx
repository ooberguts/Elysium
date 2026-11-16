// Development-only UI fixture; real file writes are exercised by the native tests.
import { createRoot } from 'react-dom/client';
import { useState } from 'react';
import { TrackTable } from '../src/components';
import { MetadataDialog } from '../src/MetadataEditor';
import { ContextMenu } from '../src/ContextMenu';
import { contextSelection } from '../src/selection';
import type { MediaItem } from '../src/types';
import '../src/styles.css';
import '../src/polish.css';
const base: MediaItem = {
  id: '',
  path: '',
  sourceId: null,
  relativePath: '',
  kind: 'music',
  title: '',
  artist: '',
  album: '',
  albumArtist: '',
  genre: '',
  year: '2026',
  track: 1,
  disc: 1,
  duration: 210,
  format: 'MP3',
  sampleRate: 48000,
  bitrate: 320,
  artwork: null,
  favorite: false,
  rating: 0,
  playCount: 0,
  addedAt: 0,
  lastPlayed: 0,
  resume: 0,
  progressUpdatedAt: 0,
  watched: false,
  available: true,
  series: '',
  season: 0,
  episode: 0,
  overview: '',
  overrides: {},
};
function App() {
  const [items, setItems] = useState(
      ['Glass Horizon', 'Night Window', 'Afterglow'].map((title, i) => ({
        ...base,
        id: String(i),
        title,
        artist: ['Elysium Lab', 'Second performer', 'Elysium Lab'][i],
        album: ['First Light', 'Night Studies', 'First Light'][i],
        rating: i + 2,
      })),
    ),
    [selected, setSelected] = useState(new Set<string>()),
    [editing, setEditing] = useState<MediaItem[]>([]),
    [menu, setMenu] = useState<{ x: number; y: number; items: MediaItem[] } | null>(null),
    [played, setPlayed] = useState(0),
    [compact, setCompact] = useState(false);
  return (
    <div
      className="app"
      data-theme="graphite"
      style={{ padding: 24, display: 'flex', flexDirection: 'column', height: '100vh' }}
      onContextMenu={(e) => e.preventDefault()}
    >
      <h2>Music collection · interaction check</h2>
      <p role="status">
        {selected.size} selected · {played} playback actions
      </p>
      <div className="view-controls">
        <button onClick={() => setSelected(new Set(items.map((i) => i.id)))}>Select all</button>
        <button onClick={() => setEditing(items.filter((i) => selected.has(i.id)))}>
          Edit selected metadata
        </button>
        <label>
          <input type="checkbox" checked={compact} onChange={(e) => setCompact(e.target.checked)} />
          Compact rows
        </label>
      </div>
      <TrackTable
        items={items}
        selected={selected}
        currentId={null}
        play={() => setPlayed((n) => n + 1)}
        select={(item, e) =>
          setSelected(new Set(e.metaKey || e.ctrlKey ? [...selected, item.id] : [item.id]))
        }
        favorite={() => {}}
        info={(i) => setEditing([i])}
        enqueue={() => {}}
        compact={compact}
        ratingBusy={new Set()}
        rate={(item, rating) =>
          setItems(items.map((i) => (i.id === item.id ? { ...i, rating } : i)))
        }
        contextMenu={(item, e) => {
          e.preventDefault();
          e.stopPropagation();
          const targets = contextSelection(items, selected, item);
          if (!selected.has(item.id)) setSelected(new Set([item.id]));
          const r = e.currentTarget.getBoundingClientRect();
          setMenu({
            x: 'clientX' in e ? e.clientX : r.left,
            y: 'clientY' in e ? e.clientY : r.top,
            items: targets,
          });
        }}
      />
      {menu && (
        <ContextMenu
          {...menu}
          title={`${menu.items.length} selected items`}
          close={() => setMenu(null)}
          actions={[
            {
              label: `Edit metadata for ${menu.items.length} items…`,
              run: () => setEditing(menu.items),
            },
            { label: 'Add to queue', run: () => {} },
          ]}
        />
      )}
      {!!editing.length && (
        <MetadataDialog
          items={editing}
          close={() => setEditing([])}
          changed={async () => {}}
          notify={() => {}}
          activeId={null}
          stopPlayback={async () => {}}
        />
      )}
    </div>
  );
}
createRoot(document.getElementById('root')!).render(<App />);
