import { useCallback, useEffect, useState } from 'react';
import { ApiAuthError, api, type ClassRow, type WorkflowRow } from './api';
import { Login } from './Login';
import { Shell, type PageId } from './Shell';
import { PageWelcome } from './pages/PageWelcome';
import { PageClasses } from './pages/PageClasses';
import { PageWorkflows } from './pages/PageWorkflows';
import { PageLive } from './pages/PageLive';
import { PageEvals } from './pages/PageEvals';

const PAGE_IDS: PageId[] = ['welcome', 'classes', 'workflows', 'live', 'evals'];

function pageFromHash(): PageId {
  const raw = window.location.hash.replace(/^#\/?/, '');
  return (PAGE_IDS as string[]).includes(raw) ? (raw as PageId) : 'welcome';
}

export function App() {
  const [authed, setAuthed] = useState<boolean | null>(null);
  const [page, setPage] = useState<PageId>(pageFromHash);
  const [classes, setClasses] = useState<ClassRow[]>([]);
  const [workflows, setWorkflows] = useState<WorkflowRow[]>([]);
  const [evalsCount, setEvalsCount] = useState(0);
  const [hasLive, setHasLive] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const [c, w, e, l] = await Promise.all([
        api.get<{ classes: ClassRow[] }>('/api/classes'),
        api.get<{ workflows: WorkflowRow[] }>('/api/workflows'),
        api.get<{ evaluations: { id: string }[] }>('/api/evals'),
        api.get<{ launches: { id: string }[] }>('/api/live/launches'),
      ]);
      setClasses(c.classes);
      setWorkflows(w.workflows);
      setEvalsCount(e.evaluations.length);
      setHasLive(l.launches.length > 0);
    } catch (err) {
      if (err instanceof ApiAuthError) {
        setAuthed(false);
      }
    }
  }, []);

  useEffect(() => {
    api
      .get('/api/admin/me')
      .then(() => setAuthed(true))
      .catch((err) => {
        if (err instanceof ApiAuthError) setAuthed(false);
        else setAuthed(false);
      });
  }, []);

  useEffect(() => {
    if (authed) refresh();
  }, [authed, refresh]);

  useEffect(() => {
    const onHash = () => setPage(pageFromHash());
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  const navigate = useCallback((p: PageId) => {
    if (window.location.hash !== `#/${p}`) {
      window.location.hash = `#/${p}`;
    }
    setPage(p);
  }, []);

  if (authed === null) {
    return <div className="boot">Cargando…</div>;
  }
  if (!authed) {
    return <Login onLogin={() => setAuthed(true)} />;
  }

  return (
    <Shell
      active={page}
      onNav={navigate}
      onLogout={() => setAuthed(false)}
      counts={{ classes: classes.length, workflows: workflows.length, evals: evalsCount }}
      hasLive={hasLive}
    >
      {page === 'welcome' && <PageWelcome onGoToClasses={() => navigate('classes')} />}
      {page === 'classes' && <PageClasses classes={classes} onChange={refresh} />}
      {page === 'workflows' && <PageWorkflows classes={classes} onChange={refresh} />}
      {page === 'live' && <PageLive classes={classes} workflows={workflows} onChange={refresh} />}
      {page === 'evals' && <PageEvals classes={classes} onChange={refresh} />}
    </Shell>
  );
}
