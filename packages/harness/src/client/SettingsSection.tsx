// HimaHarness's own settings section (#41 task 8): Packs, Sites and the current Campaign's
// knowledge count, read the way the shell's own settings pages read — root-scoped, no session of its
// own, the session picker's own current selection standing in for "the Campaign I am looking at"
// wherever a route needs a live session (Site rediscovery). No credential ever appears here: a saved
// Site's own SSH destination is never sent back to this page (`SiteHeadView` does not carry one), so
// rediscovering an SSH Site asks for the destination again rather than pretending one is remembered.
import { useEffect, useState, type ReactElement } from 'react';
import type { SiteHeadView } from '../remote.js';
import type { StartChoices } from '../workbench.js';
import { discoverSite, fetchCampaignFile, fetchSites, fetchStartChoices } from './api.js';
import { PackOwnerPanel } from './PackOwnerPanel.js';
import { HIMA_STYLE } from './workbench-style.js';

export interface SettingsSectionProps {
  readonly useSessions: <T>(selector: (state: { current?: string }) => T) => T;
  /** The native folder picker (#41 task 8), passed through to the Pack owner panel when present. */
  pickFolder?: () => Promise<string | null>;
}

const READINESS_SAID: Readonly<Record<SiteHeadView['readiness'], string>> = {
  ready: 'ready', 'needs-discovery': 'needs discovery', stale: 'discovery is stale',
};

const NO_LIVE_SESSION = 'Open a session to rediscover a Site.';

/** Registered on `settings.section`, `id: 'hima'`. Root-scoped: `useSessions` is a standard prop the
 *  shell always delivers; `pickFolder` is this registration's own inject (`index.ts`). */
export function SettingsSection({ useSessions, pickFolder }: SettingsSectionProps): ReactElement {
  const sessionId = useSessions((state) => state.current);
  const [choices, setChoices] = useState<StartChoices>();
  const [sites, setSites] = useState<readonly SiteHeadView[]>([]);
  const [knowledgeCount, setKnowledgeCount] = useState<number>();
  const [sshBySite, setSshBySite] = useState<Readonly<Record<string, string>>>({});
  const [busySite, setBusySite] = useState<string>();
  const [siteMessage, setSiteMessage] = useState<string>();

  useEffect(() => {
    const controller = new AbortController();
    void fetchStartChoices(undefined, undefined, controller.signal).then((result) => { if (result.ok) setChoices(result.value); });
    void fetchSites(controller.signal).then((result) => { if (result.ok) setSites(result.value.sites); });
    return () => { controller.abort(); };
  }, []);

  useEffect(() => {
    if (sessionId === undefined) { setKnowledgeCount(undefined); return; }
    const controller = new AbortController();
    void fetchCampaignFile(sessionId, controller.signal).then((result) => { if (result.ok) setKnowledgeCount(result.value.file.knowledge.length); });
    return () => { controller.abort(); };
  }, [sessionId]);

  const rediscover = async (site: SiteHeadView) => {
    if (sessionId === undefined) return;
    const destination = (sshBySite[site.name] ?? '').trim();
    if (destination === '') { setSiteMessage(`Enter the SSH destination for ${site.name} before rediscovering it.`); return; }
    setBusySite(site.name); setSiteMessage(undefined);
    const result = await discoverSite({ sessionId, name: site.name, ssh: { destination }, save: true });
    setBusySite(undefined);
    if (!result.ok) { setSiteMessage(result.error.message); return; }
    const refreshed = await fetchSites();
    if (refreshed.ok) setSites(refreshed.value.sites);
    setSiteMessage(`${site.name} rediscovered.`);
  };

  return (
    <div className="hima-root hima-settings" data-hima-region="hima-settings">
      <style>{HIMA_STYLE}</style>
      <section>
        <h3>Packs</h3>
        {choices === undefined ? <p className="hima-small">Reading installed Packs…</p> : (
          <p className="hima-small">
            {choices.packs.length} installed
            {choices.cannotStart === undefined || choices.cannotStart.length === 0 ? '' : `, ${choices.cannotStart.length} cannot start`}.
          </p>
        )}
        <PackOwnerPanel sessionId={sessionId ?? ''} initialPack="" pickFolder={pickFolder} />
      </section>
      <section>
        <h3>Sites</h3>
        {sites.length === 0 ? <p className="hima-small">No Site has been saved yet.</p> : (
          <div className="hima-settings-sites">
            {sites.map((site) => (
              <div key={site.name} className="hima-settings-row" data-hima-region={`site-${site.name}`} data-hima-state-readiness={site.readiness}>
                <span className="hima-mono">{site.name}</span>
                <span className="hima-muted">{site.kind} · {READINESS_SAID[site.readiness]}</span>
                {site.kind !== 'ssh' ? null : sessionId === undefined ? (
                  <span className="hima-muted">{NO_LIVE_SESSION}</span>
                ) : (
                  <>
                    <input aria-label={`SSH destination for ${site.name}`} placeholder="user@host" value={sshBySite[site.name] ?? ''}
                      onChange={(event) => { setSshBySite((prior) => ({ ...prior, [site.name]: event.target.value })); }} />
                    <button type="button" className="hima-button" data-hima-control={`site-rediscover-${site.name}`} disabled={busySite === site.name}
                      onClick={() => { void rediscover(site); }}>Rediscover</button>
                  </>
                )}
              </div>
            ))}
          </div>
        )}
        {siteMessage === undefined ? null : <p role="status" className="hima-small">{siteMessage}</p>}
      </section>
      <section>
        <h3>Knowledge</h3>
        <p className="hima-small">
          {sessionId === undefined
            ? 'Open a session to see its current knowledge count.'
            : knowledgeCount === undefined
              ? 'Reading the current Campaign file…'
              : `${knowledgeCount} knowledge document${knowledgeCount === 1 ? '' : 's'} attached to the current Campaign.`}
        </p>
      </section>
    </div>
  );
}
