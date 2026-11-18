import { useEffect, useState } from 'react';
import { RefreshCw } from 'lucide-react';
import { desktop, native } from '../bridge';
import type { Library } from '../types';
import type { Broadcast, Output } from './useBroadcast';

export function BroadcastPreferences({
  broadcast: b,
  library,
  setEnabled,
  refresh,
}: {
  broadcast: Broadcast;
  library: Library;
  setEnabled: (enabled: boolean, name: string) => Promise<void>;
  refresh: () => Promise<void>;
}) {
  const s = b.state;
  const [name, setName] = useState(library.settings.lanRoomName || 'This computer');
  const [volume, setVolume] = useState(s.volume);
  const [outputs, setOutputs] = useState<Output[]>([]);
  const [outputError, setOutputError] = useState('');
  const [loadingOutputs, setLoadingOutputs] = useState(false);
  useEffect(() => {
    if (s.enabled) setName(s.name);
  }, [s.enabled, s.name]);
  useEffect(() => setVolume(s.volume), [s.volume]);
  async function loadOutputs() {
    if (!desktop) return;
    setLoadingOutputs(true);
    setOutputError('');
    try {
      setOutputs(await native<Output[]>('broadcast_outputs'));
    } catch (error) {
      setOutputError(String(error));
    } finally {
      setLoadingOutputs(false);
    }
  }
  useEffect(() => {
    if (s.enabled) void loadOutputs();
  }, [s.enabled]);
  const settings = (changes: Record<string, unknown>) =>
    void b
      .call('broadcast_settings', {
        name: s.name,
        allowRequests: s.allowRequests,
        volume: s.volume,
        delayMs: s.delayMs,
        outputDevice: s.outputDevice,
        ...changes,
      })
      .catch(() => {});
  const saveName = () => {
    const value = name.trim() || 'This computer';
    setName(value);
    if (s.enabled) {
      if (value !== s.name) settings({ name: value });
    } else
      void native('save_settings', { values: { lanRoomName: value } })
        .then(refresh)
        .catch(() => {});
  };
  return (
    <>
      <h2>LAN broadcasting</h2>
      <p>Allow this computer to broadcast media and discover broadcasts on your local network.</p>
      <label className="checkbox-label">
        <input
          type="checkbox"
          role="switch"
          aria-label="Enable LAN broadcasting"
          checked={s.enabled}
          disabled={!desktop || !!b.busy}
          onChange={(event) => void setEnabled(event.target.checked, name)}
        />
        <span>
          Enable LAN broadcasting
          <small>
            {s.enabled
              ? 'On · This computer can discover broadcasts and share playback.'
              : 'Off · Turn this on to broadcast or join another room.'}
          </small>
        </span>
      </label>
      {b.active && <p>Turning this off ends the current broadcast or listening session.</p>}
      <div className="lan-preferences-fields">
        <label>
          Room name
          <input
            aria-label="Room name"
            maxLength={60}
            value={name}
            onChange={(event) => setName(event.target.value)}
            onBlur={saveName}
            disabled={!desktop || !!b.busy}
          />
          <small>Other Elysium computers see this name.</small>
        </label>
        {s.enabled && (
          <>
            <label>
              Audio output
              <select
                aria-label="LAN audio output"
                value={s.outputDevice || ''}
                disabled={b.active || !!b.busy}
                onChange={(event) => settings({ outputDevice: event.target.value || null })}
              >
                <option value="">System default</option>
                {s.outputDevice && !outputs.some((device) => device.id === s.outputDevice) && (
                  <option value={s.outputDevice}>Saved device unavailable</option>
                )}
                {outputs.map((device) => (
                  <option value={device.id} key={device.id}>
                    {device.name}
                    {device.isDefault ? ' · default' : ''}
                  </option>
                ))}
              </select>
              <small>
                {b.active
                  ? 'Stop the current session to change output.'
                  : 'Choose where audio plays in this room.'}
              </small>
            </label>
            <button
              className="small-button"
              disabled={b.active || loadingOutputs}
              onClick={() => void loadOutputs()}
            >
              <RefreshCw size={13} />
              {loadingOutputs ? 'Checking devices…' : 'Refresh outputs'}
            </button>
            {outputError && (
              <p className="error-message" role="alert">
                {outputError}
              </p>
            )}
            <label>
              Room volume · {Math.round(volume * 100)}%
              <input
                aria-label="LAN room volume"
                type="range"
                min="0"
                max="1"
                step=".01"
                value={volume}
                onChange={(event) => setVolume(Number(event.target.value))}
                onPointerUp={(event) => settings({ volume: Number(event.currentTarget.value) })}
                onKeyUp={(event) => settings({ volume: Number(event.currentTarget.value) })}
              />
            </label>
            <label>
              Timing adjustment (ms)
              <input
                aria-label="Room timing adjustment"
                type="number"
                min="-500"
                max="500"
                step="5"
                key={s.id}
                defaultValue={s.delayMs}
                onBlur={(event) => settings({ delayMs: Number(event.target.value) || 0 })}
              />
              <small>Positive values delay this room, useful for Bluetooth speakers.</small>
            </label>
            <label className="checkbox-label">
              <input
                type="checkbox"
                checked={s.allowRequests}
                onChange={(event) => settings({ allowRequests: event.target.checked })}
              />
              <span>
                Accept playback requests while idle
                <small>
                  Other rooms can start playback here; otherwise this room receives an invitation.
                </small>
              </span>
            </label>
          </>
        )}
        <label>
          Video quality
          <select
            aria-label="Room video quality"
            value={b.quality}
            onChange={(event) => b.setQuality(event.target.value as Broadcast['quality'])}
          >
            <option value="auto">Auto · keep live</option>
            <option value="high">High · up to 1080p</option>
            <option value="medium">Medium · up to 720p</option>
            <option value="low">Low · up to 480p</option>
          </select>
        </label>
      </div>
    </>
  );
}
