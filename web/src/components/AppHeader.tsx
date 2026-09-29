import { useEffect, useRef, useState } from 'react';
import { useAuth } from '../auth.tsx';
import { api } from '../lib/api.ts';
import { formatDateTime } from '../lib/format.ts';
import { Link, useRouter } from '../lib/router.tsx';
import type { NotificationItem } from '../types.ts';
import { BellIcon, LogoutIcon } from './icons.tsx';
import { Avatar, cx } from './ui.tsx';

export function Logo() {
  return (
    <span className="flex items-center gap-2 font-bold tracking-tight text-slate-900">
      <svg viewBox="0 0 64 64" className="h-7 w-7" aria-hidden>
        <rect width="64" height="64" rx="14" fill="#0f766e" />
        <path d="M18 40c6-14 22-14 28 0" stroke="#fff" strokeWidth="5" fill="none" strokeLinecap="round" />
        <circle cx="32" cy="24" r="6" fill="#fde68a" />
      </svg>
      TripFund
    </span>
  );
}

export function AppHeader() {
  const { user, logout } = useAuth();
  const { path, navigate } = useRouter();
  const [open, setOpen] = useState<'none' | 'notifications' | 'user'>('none');
  const [notifications, setNotifications] = useState<NotificationItem[]>([]);
  const [unread, setUnread] = useState(0);
  const ref = useRef<HTMLDivElement>(null);

  // Refresh notifications on every page change.
  useEffect(() => {
    api
      .get<{ notifications: NotificationItem[]; unread: number }>('/notifications')
      .then((r) => {
        setNotifications(r.notifications);
        setUnread(r.unread);
      })
      .catch(() => undefined);
  }, [path]);

  useEffect(() => {
    if (open === 'none') return;
    const onClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen('none');
    };
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, [open]);

  const openNotifications = () => {
    setOpen(open === 'notifications' ? 'none' : 'notifications');
    if (unread > 0) {
      api.post('/notifications/read-all').catch(() => undefined);
      setUnread(0);
    }
  };

  return (
    <header className="sticky top-0 z-30 border-b border-slate-200 bg-white/90 backdrop-blur">
      <div ref={ref} className="mx-auto flex h-14 max-w-5xl items-center justify-between px-4">
        <Link to="/" aria-label="My trips">
          <Logo />
        </Link>
        <div className="flex items-center gap-1">
          <div className="relative">
            <button type="button" onClick={openNotifications} className="relative rounded-full p-2 text-slate-600 hover:bg-slate-100" aria-label="Notifications">
              <BellIcon />
              {unread > 0 && (
                <span className="absolute right-1 top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-spent-600 px-1 text-[10px] font-bold text-white">
                  {unread > 9 ? '9+' : unread}
                </span>
              )}
            </button>
            {open === 'notifications' && (
              <div className="absolute right-0 mt-2 w-80 max-w-[calc(100vw-2rem)] overflow-hidden rounded-xl bg-white shadow-lg ring-1 ring-slate-200">
                <p className="border-b border-slate-100 px-4 py-2.5 text-sm font-semibold">Activity</p>
                <ul className="max-h-96 overflow-y-auto">
                  {notifications.length === 0 && <li className="px-4 py-6 text-center text-sm text-slate-500">No activity yet.</li>}
                  {notifications.map((n) => (
                    <li key={n.id}>
                      <button
                        type="button"
                        onClick={() => {
                          setOpen('none');
                          navigate(`/trips/${n.tripId}`);
                        }}
                        className={cx('block w-full px-4 py-3 text-left text-sm hover:bg-slate-50', !n.read && 'bg-remain-50/60')}
                      >
                        <span className="block text-slate-800">{n.message}</span>
                        <span className="mt-0.5 block text-xs text-slate-500">
                          {n.tripName} · {formatDateTime(n.createdAt)}
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
          <div className="relative">
            <button type="button" onClick={() => setOpen(open === 'user' ? 'none' : 'user')} className="rounded-full p-1 hover:bg-slate-100" aria-label="Account">
              <Avatar name={user?.name ?? '?'} size="sm" />
            </button>
            {open === 'user' && (
              <div className="absolute right-0 mt-2 w-56 overflow-hidden rounded-xl bg-white shadow-lg ring-1 ring-slate-200">
                <div className="border-b border-slate-100 px-4 py-3">
                  <p className="truncate text-sm font-semibold">{user?.name}</p>
                  <p className="truncate text-xs text-slate-500">{user?.email}</p>
                </div>
                <button
                  type="button"
                  onClick={async () => {
                    setOpen('none');
                    await logout();
                    navigate('/', { replace: true });
                  }}
                  className="flex w-full items-center gap-2 px-4 py-3 text-left text-sm text-slate-700 hover:bg-slate-50"
                >
                  <LogoutIcon size={16} /> Log out
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
    </header>
  );
}
