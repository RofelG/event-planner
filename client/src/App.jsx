import { Link, Route, Routes } from 'react-router-dom';
import { RequireAuth, RequireRole } from './components/RequireAuth';
import { LoginPage, RegisterPage } from './pages/AuthPages';
import { CataloguePage } from './pages/CataloguePage';
import { ManageEventsPage } from './pages/ManageEventsPage';
import { EventEditorPage } from './pages/EventEditorPage';
import { AdminPage } from './pages/AdminPage';
import { EmptyState } from './components/ui/Feedback';

const PLANNERS = ['planner', 'admin'];

function NotFound() {
  return (
    <EmptyState title="Page not found" action={<Link to="/" className="text-sm font-medium text-brand-700 hover:underline">Go to the event catalogue</Link>}>
      The page you are looking for does not exist.
    </EmptyState>
  );
}

export function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route path="/register" element={<RegisterPage />} />
      <Route element={<RequireAuth />}>
        <Route index element={<CataloguePage />} />
        <Route path="manage" element={<RequireRole roles={PLANNERS}><ManageEventsPage /></RequireRole>} />
        <Route path="manage/new" element={<RequireRole roles={PLANNERS}><EventEditorPage /></RequireRole>} />
        <Route path="manage/:id/edit" element={<RequireRole roles={PLANNERS}><EventEditorPage /></RequireRole>} />
        <Route path="admin" element={<RequireRole roles={['admin']}><AdminPage /></RequireRole>} />
        <Route path="*" element={<NotFound />} />
      </Route>
    </Routes>
  );
}
