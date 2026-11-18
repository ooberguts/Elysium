import { useCallback, useEffect, useRef, useState } from 'react';
import { Download, RefreshCw } from 'lucide-react';
import { check as checkRelease, type Update } from '@tauri-apps/plugin-updater';
import { relaunch } from '@tauri-apps/plugin-process';
import { desktop, native } from './bridge';
import './updates.css';
import type { MouseEvent } from 'react';

export interface BuildInfo {
  version: string;
  commit: string;
  shortCommit: string;
  dirty: boolean;
  repository: string;
}
const AUTO_CHECK_KEY = 'elysium.checkUpdatesOnStartup';

export function useUpdates() {
  const [build, setBuild] = useState<BuildInfo | null>(null);
  const [latest, setLatest] = useState<Update | null>(null);
  const [checking, setChecking] = useState(false);
  const [installing, setInstalling] = useState(false);
  const [progress, setProgress] = useState<number | null>(null);
  const [error, setError] = useState('');
  const [checkedAt, setCheckedAt] = useState<Date | null>(null);
  const [autoCheck, setAutoCheck] = useState(() => {
    try {
      return localStorage.getItem(AUTO_CHECK_KEY) !== 'false';
    } catch {
      return true;
    }
  });
  const updateRef = useRef<Update | null>(null);
  const inFlight = useRef(false);
  const check = useCallback(async () => {
    if (!desktop || inFlight.current) return;
    inFlight.current = true;
    setChecking(true);
    setError('');
    setCheckedAt(null);
    try {
      const old = updateRef.current;
      updateRef.current = null;
      setLatest(null);
      if (old) await old.close();
      const update = await checkRelease({ timeout: 15000 });
      updateRef.current = update;
      setLatest(update);
      setCheckedAt(new Date());
    } catch (err) {
      setError(
        `Could not check for updates. Please check your connection and try again. ${String(err)}`,
      );
    } finally {
      inFlight.current = false;
      setChecking(false);
    }
  }, []);
  useEffect(() => {
    if (!desktop) return;
    void native<BuildInfo>('build_info')
      .then(setBuild)
      .catch((err) => setError(String(err)));
    if (autoCheck) void check();
    // The preference applies to startup, not to every render or toggle.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [check]);
  const setAutomatic = (enabled: boolean) => {
    setAutoCheck(enabled);
    try {
      localStorage.setItem(AUTO_CHECK_KEY, String(enabled));
    } catch {
      /* Session preference still works. */
    }
  };
  const install = async () => {
    const update = updateRef.current;
    if (!update || installing) return;
    setInstalling(true);
    setProgress(null);
    setError('');
    let total = 0;
    let downloaded = 0;
    try {
      await update.downloadAndInstall((event) => {
        if (event.event === 'Started') total = event.data.contentLength ?? 0;
        if (event.event === 'Progress') {
          downloaded += event.data.chunkLength;
          if (total) setProgress(Math.min(100, Math.round((downloaded * 100) / total)));
        }
      });
      await relaunch();
    } catch (err) {
      setError(`The update could not be installed. Please try again. ${String(err)}`);
      setInstalling(false);
    }
  };
  const openCommit = (event: MouseEvent<HTMLAnchorElement>, commit: string) => {
    if (!desktop) return;
    event.preventDefault();
    void native('open_commit_page', { commit }).catch((err) => setError(String(err)));
  };
  return {
    build,
    latest,
    checking,
    installing,
    progress,
    error,
    checkedAt,
    autoCheck,
    check,
    install,
    setAutomatic,
    openCommit,
  };
}

export function AppUpdates({ updates }: { updates: ReturnType<typeof useUpdates> }) {
  const { build, latest, checking, installing, progress, error, checkedAt } = updates;
  return (
    <section className="app-updates" aria-labelledby="updates-heading">
      <h2 id="updates-heading">Elysium {build?.version} · Updates</h2>
      <p>An independent music and video player by ooberguts.</p>
      {build && (
        <dl className="build-version">
          <div>
            <dt>Installed build</dt>
            <dd>
              {/^[0-9a-f]{40}$/.test(build.commit) ? (
                <a
                  href={`${build.repository}/commit/${build.commit}`}
                  target="_blank"
                  rel="noreferrer"
                  title={build.commit}
                  onClick={(event) => updates.openCommit(event, build.commit)}
                >
                  <code>{build.shortCommit}</code>
                </a>
              ) : (
                <span>Unknown</span>
              )}
              {build.dirty && <span className="local-build">Local changes</span>}
            </dd>
          </div>
        </dl>
      )}
      <label className="checkbox-label">
        <input
          type="checkbox"
          checked={updates.autoCheck}
          onChange={(event) => updates.setAutomatic(event.target.checked)}
          disabled={!desktop}
        />
        <span>
          Check for updates when Elysium starts
          <small>Updates are installed only when you choose.</small>
        </span>
      </label>
      <div className="update-status" role="status" aria-live="polite">
        {checking ? (
          'Checking for updates…'
        ) : installing ? (
          progress === null ? (
            'Preparing update…'
          ) : (
            `Downloading update: ${progress}%`
          )
        ) : latest ? (
          <>
            <strong>Elysium {latest.version} is available.</strong>
            {latest.body && <span>{latest.body}</span>}
          </>
        ) : checkedAt ? (
          <strong>You’re up to date.</strong>
        ) : (
          'Check for a new Elysium release.'
        )}
        {checkedAt && !checking && !installing && (
          <small>
            Checked {checkedAt.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}
          </small>
        )}
      </div>
      {error && (
        <p className="update-error" role="alert">
          {error}
        </p>
      )}
      <div className="settings-actions">
        <button onClick={() => void updates.check()} disabled={!desktop || checking || installing}>
          <RefreshCw size={15} className={checking ? 'update-spinning' : undefined} />
          {checking ? 'Checking…' : 'Check for updates'}
        </button>
        {latest && (
          <button
            className="primary"
            onClick={() => void updates.install()}
            disabled={checking || installing}
          >
            <Download size={15} />
            {installing ? 'Installing…' : 'Download and install'}
          </button>
        )}
      </div>
      <p className="update-note">
        Updates download a verified, prebuilt app and restart Elysium. Your library and media stay
        in their existing locations.
      </p>
    </section>
  );
}
