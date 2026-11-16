import { useEffect, useState } from 'react';
import { AudioLines, Mic, MonitorSpeaker, Music2, RefreshCw } from 'lucide-react';
import { Modal } from '../components';
import type { useAudioCapture } from './capture';

export function AudioSourceDialog({
  capture,
  external,
  usePlayer,
  choose,
  close,
}: {
  capture: ReturnType<typeof useAudioCapture>;
  external: boolean;
  usePlayer: () => void;
  choose: (device: ReturnType<typeof useAudioCapture>['devices'][number]) => void;
  close: () => void;
}) {
  const [selected, setSelected] = useState('');
  useEffect(() => {
    void capture.refresh();
  }, [capture.refresh]);
  const device = capture.devices.find((d) => `${d.kind}:${d.id}` === selected);
  return (
    <Modal title="What should the show listen to?" close={close}>
      <div className="audio-source-dialog">
        <p className="dialog-intro">
          Use your library, music playing in another app, or a connected audio input.
        </p>
        <button
          className={`audio-player-choice ${!external ? 'selected' : ''}`}
          onClick={() => {
            usePlayer();
            close();
          }}
        >
          <Music2 size={21} />
          <span>
            <strong>Elysium player</strong>
            <small>Follow the music in your library</small>
          </span>
        </button>
        <div className="audio-device-heading">
          <h3>Listen to a device</h3>
          <button
            className="icon-button"
            title="Refresh devices"
            aria-label="Refresh audio devices"
            disabled={capture.busy}
            onClick={() => void capture.refresh()}
          >
            <RefreshCw size={15} />
          </button>
        </div>
        <label>
          Audio device
          <select
            aria-label="Audio capture device"
            value={selected}
            onChange={(e) => setSelected(e.target.value)}
            disabled={capture.busy}
          >
            <option value="">Choose a device…</option>
            <optgroup label="System audio · sound from other apps">
              {capture.devices
                .filter((d) => d.kind === 'output')
                .map((d) => (
                  <option key={`output:${d.id}`} value={`output:${d.id}`}>
                    {d.name}
                    {d.isDefault ? ' (default output)' : ''}
                  </option>
                ))}
            </optgroup>
            <optgroup label="Inputs · microphones and loopback devices">
              {capture.devices
                .filter((d) => d.kind === 'input')
                .map((d) => (
                  <option key={`input:${d.id}`} value={`input:${d.id}`}>
                    {d.name}
                    {d.isDefault ? ' (default input)' : ''}
                  </option>
                ))}
            </optgroup>
          </select>
        </label>
        <div className="audio-source-tip">
          {device?.kind === 'input' ? <Mic size={19} /> : <MonitorSpeaker size={19} />}
          <p>
            {device?.kind === 'input'
              ? 'A microphone hears the room. A loopback input hears the audio you route to it.'
              : 'For YouTube Music, choose the speakers or headphones Chrome is playing through, then start listening.'}
          </p>
        </div>
        {external && capture.running && (
          <div className="capture-live">
            <AudioLines size={17} />
            <span>Listening to {capture.name}</span>
            <meter min="0" max="1" value={capture.level} aria-label="Captured audio level" />
          </div>
        )}
        {capture.error && (
          <p role="alert" className="error-message">
            {capture.error}
          </p>
        )}
        <p className="form-note">
          Your system may ask for audio or microphone access. Audio is analyzed live, never saved or
          sent anywhere. System audio is supported on Windows and macOS 14.6 or later; available
          devices depend on your audio driver.
        </p>
        <div className="dialog-actions">
          <button onClick={close}>Cancel</button>
          <button
            className="primary"
            disabled={!device || capture.busy}
            onClick={() => device && choose(device)}
          >
            {capture.busy ? 'Connecting…' : 'Start listening'}
          </button>
        </div>
      </div>
    </Modal>
  );
}
