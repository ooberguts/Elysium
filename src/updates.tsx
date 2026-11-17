import { useCallback, useEffect, useRef, useState } from 'react';
import { Download, RefreshCw } from 'lucide-react';
import { desktop, native } from './bridge';
import './updates.css';
import type { MouseEvent } from 'react';

export interface BuildInfo {
  version: string;
  commit: string;
  shortCommit: string;
  dirty: boolean;
  branch: string;
  repository: string;
  canInstall: boolean;
}
export interface UpdateCheck {
  commit: string;
  shortCommit: string;
  message: string;
  url: string;
  available: boolean;
}
const AUTO_CHECK_KEY = 'elysium.checkUpdatesOnStartup';

export function useUpdates() {
  const [build, setBuild] = useState<BuildInfo | null>(null);
  const [latest, setLatest] = useState<UpdateCheck | null>(null);
  const [checking, setChecking] = useState(false);
  const [installing, setInstalling] = useState(false);
  const [installerOpened, setInstallerOpened] = useState(false);
  const [error, setError] = useState('');
  const [checkedAt, setCheckedAt] = useState<Date | null>(null);
  const [autoCheck, setAutoCheck] = useState(() => {
    try {
      return localStorage.getItem(AUTO_CHECK_KEY) !== 'false';
    } catch {
      return true;
    }
  });
  const inFlight = useRef(false);
  const check = useCallback(async () => {
    if (!desktop || inFlight.current) return;
    inFlight.current = true;
    setChecking(true);
    setError('');
    setLatest(null);
    try {
      setLatest(await native<UpdateCheck>('check_for_updates'));
      setCheckedAt(new Date());
    } catch (err) {
      setError(String(err));
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
      // The session preference still works when persistent storage is unavailable.
    }
  };
  const install = async () => {
    if (!latest?.available || installing || installerOpened) return;
    setInstalling(true);
    setError('');
    try {
      await native('install_update', { commit: latest.commit });
      setInstallerOpened(true);
    } catch (err) {
      setError(String(err));
    } finally {
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
    installerOpened,
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
  const { build, latest, checking, installing, installerOpened, error, checkedAt } = updates;
  return (
    <section className="app-updates" aria-labelledby="updates-heading">
      <h2 id="updates-heading">Elysium {build?.version} · Updates</h2>
      <p>An independent music and video player by ooberguts.</p>
      {build ? (
        <dl className="build-version">
          <div>
            <dt>Installed commit</dt>
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
                <span>Unknown · no Git metadata</span>
              )}
              {build.dirty && <span className="local-build">Local changes</span>}
            </dd>
          </div>
          <div>
            <dt>Update branch</dt>
            <dd>{build.branch} on GitHub</dd>
          </div>
          {latest && (
            <div>
              <dt>Latest commit</dt>
              <dd>
                <a
                  href={latest.url}
                  target="_blank"
                  rel="noreferrer"
                  title={latest.commit}
                  onClick={(event) => updates.openCommit(event, latest.commit)}
                >
                  <code>{latest.shortCommit}</code>
                </a>
              </dd>
            </div>
          )}
        </dl>
      ) : (
        <p>
          {desktop
            ? 'Reading installed version…'
            : 'Version checks are available in the desktop app.'}
        </p>
      )}
      <label className="checkbox-label">
        <input
          type="checkbox"
          checked={updates.autoCheck}
          onChange={(event) => updates.setAutomatic(event.target.checked)}
          disabled={!desktop}
        />
        <span>
          Check GitHub when Elysium starts<small>Updates are installed only when you choose.</small>
        </span>
      </label>
      <div className="update-status" role="status" aria-live="polite">
        {checking ? (
          'Checking GitHub…'
        ) : latest ? (
          <>
            <strong>
              {latest.available
                ? 'A different commit is available on main.'
                : build?.dirty
                  ? 'Your base commit matches main; this build has local changes.'
                  : 'You’re on the latest commit.'}
            </strong>
            <span>{latest.message}</span>
            {checkedAt && (
              <small>
                Checked {checkedAt.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}
              </small>
            )}
          </>
        ) : (
          'Check for the latest version from GitHub.'
        )}
      </div>
      {error && (
        <p className="update-error" role="alert">
          {error}
        </p>
      )}
      {installerOpened && (
        <p className="update-handoff" role="status">
          The update installer is open in your terminal. Follow its progress there. When it says the
          build is ready, quit Elysium; the installer will replace the app and reopen it. If the
          installer fails, correct the issue and reopen Elysium to retry.
        </p>
      )}
      <div className="settings-actions">
        <button
          onClick={() => void updates.check()}
          disabled={!desktop || checking || installing || installerOpened}
        >
          <RefreshCw size={15} className={checking ? 'update-spinning' : undefined} />
          {checking ? 'Checking…' : 'Check for updates'}
        </button>
        {latest?.available && (
          <button
            className="primary"
            onClick={() => void updates.install()}
            disabled={!build?.canInstall || checking || installing || installerOpened}
          >
            <Download size={15} />
            {installerOpened
              ? 'Installer opened'
              : installing
                ? 'Opening installer…'
                : `Install ${latest.shortCommit}`}
          </button>
        )}
      </div>
      {build && !build.canInstall && (
        <p className="update-note">
          This is a development build or contains local changes. Install a packaged build from a
          clean Git commit to enable app updates.
        </p>
      )}
      <p className="update-note">
        The installer builds the selected commit from source and installs missing build tools. The
        first update may take several minutes. Your library and media stay in their existing
        locations.
      </p>
    </section>
  );
}
