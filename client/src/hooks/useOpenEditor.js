import { useLocation, useNavigate } from 'react-router-dom';
import { useEnsureSignedIn } from '../context/GuestContext';

/**
 * Opens the event editor modal over the current page (see App.jsx). Demo
 * visitors are asked for their name first. Pass an id to edit, none to create.
 */
export function useOpenEditor() {
  const navigate = useNavigate();
  const location = useLocation();
  const ensureSignedIn = useEnsureSignedIn();

  return async (id) => {
    if (!id && !(await ensureSignedIn('create events'))) return;
    navigate(id ? `/manage/${id}/edit` : '/manage/new', { state: { background: location } });
  };
}
