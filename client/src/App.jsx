import { Link, Route, Routes, useLocation } from 'react-router-dom';
import { RequireAuth, RequireRole } from './components/RequireAuth';
import { LoginPage, RegisterPage } from './pages/AuthPages';
import { CataloguePage } from './pages/CataloguePage';
import { ManageEventsPage } from './pages/ManageEventsPage';
import { EventEditorRoute } from './components/EventEditorModal';
import { AdminPage } from './pages/AdminPage';
import { EmptyState } from './components/ui/Feedback';
import { useAuth } from './context/AuthContext';

const PLANNERS = ['planner', 'admin'];

function NotFound() {
  return (
    <EmptyState title="Page not found" action={<Link to="/" className="text-sm font-medium text-brand-700 hover:underline">Go to the event catalogue</Link>}>
      The page you are looking for does not exist.
    </EmptyState>
  );
}

/**
 * The event editor is a modal route. Links that open it pass
 * `state={{ background: location }}`; the pages below then render at that
 * background location, so the page the user came from stays put underneath.
 * A direct visit to /manage/new or /manage/:id/edit has no background, so
 * those paths render Manage events underneath instead (the catalogue for demo
 * guests, who have no Manage page).
 */
export function App() {
  const location = useLocation();
  const background = location.state?.background;
  const { isPlanner } = useAuth();
  const managePage = <RequireRole roles={PLANNERS}><ManageEventsPage /></RequireRole>;
  const editorBackdrop = isPlanner ? managePage : <CataloguePage />;

  return (
    <>
      <Routes location={background || location}>
        <Route path="/login" element={<LoginPage />} />
        <Route path="/register" element={<RegisterPage />} />
        <Route element={<RequireAuth />}>
          <Route index element={<CataloguePage />} />
          <Route path="manage" element={managePage} />
          <Route path="manage/new" element={editorBackdrop} />
          <Route path="manage/:id/edit" element={editorBackdrop} />
          <Route path="admin" element={<RequireRole roles={['admin']}><AdminPage /></RequireRole>} />
          <Route path="*" element={<NotFound />} />
        </Route>
      </Routes>

      <Routes>
        <Route path="/manage/new" element={<EventEditorRoute />} />
        <Route path="/manage/:id/edit" element={<EventEditorRoute />} />
        <Route path="*" element={null} />
      </Routes>
    </>
  );
}
