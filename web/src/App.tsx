import { AppHeader } from './components/AppHeader.tsx';
import { PageSpinner } from './components/ui.tsx';
import { useAuth } from './auth.tsx';
import { Link, useRouter } from './lib/router.tsx';
import { AuthPage } from './pages/AuthPage.tsx';
import { CreateTripPage } from './pages/CreateTripPage.tsx';
import { TripsPage } from './pages/TripsPage.tsx';
import { TripLayout } from './pages/trip/TripLayout.tsx';

export function App() {
  const { user, checking } = useAuth();
  const { path } = useRouter();

  if (checking) return <PageSpinner />;
  if (!user) return <AuthPage mode={path === '/register' ? 'register' : 'login'} />;

  const segments = path.split('/').filter(Boolean);
  let page;
  if (segments.length === 0 || path === '/login' || path === '/register') page = <TripsPage />;
  else if (path === '/trips/new') page = <CreateTripPage />;
  else if (segments[0] === 'trips' && segments[1]) page = <TripLayout key={segments[1]} tripId={segments[1]} />;
  else page = <NotFound />;

  return (
    <div className="min-h-dvh">
      <AppHeader />
      {page}
    </div>
  );
}

function NotFound() {
  return (
    <main className="mx-auto max-w-md px-4 py-16 text-center">
      <p className="text-lg font-semibold">Page not found</p>
      <Link to="/" className="mt-3 inline-block text-remain-700 underline">
        Go to my trips
      </Link>
    </main>
  );
}
