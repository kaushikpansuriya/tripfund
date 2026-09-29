import { useState, type FormEvent } from 'react';
import { useAuth } from '../auth.tsx';
import { Logo } from '../components/AppHeader.tsx';
import { Button, ErrorBanner, Input } from '../components/ui.tsx';
import { ApiError } from '../lib/api.ts';
import { Link } from '../lib/router.tsx';

export function AuthPage({ mode }: { mode: 'login' | 'register' }) {
  const { login, register } = useAuth();
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      if (mode === 'register') await register(name, email, password);
      else await login(email, password);
    } catch (err) {
      setError(err instanceof ApiError ? err : new ApiError(0, 'ERROR', String(err)));
    } finally {
      setBusy(false);
    }
  };

  const fields = error?.fieldErrors() ?? {};

  return (
    <main className="flex min-h-dvh items-center justify-center bg-gradient-to-b from-remain-50 to-slate-50 px-4 py-10">
      <div className="w-full max-w-sm">
        <div className="mb-6 flex flex-col items-center gap-2 text-center">
          <Logo />
          <p className="text-sm text-slate-600">Track who added money, who paid, and who owes whom on every trip.</p>
        </div>
        <form onSubmit={submit} className="space-y-4 rounded-2xl bg-white p-6 shadow-sm ring-1 ring-slate-200">
          <h1 className="text-xl font-semibold">{mode === 'register' ? 'Create your account' : 'Log in'}</h1>
          {error && Object.keys(fields).length === 0 && <ErrorBanner error={error} />}
          {mode === 'register' && (
            <Input label="Your name" autoComplete="name" required value={name} onChange={(e) => setName(e.target.value)} error={fields.name} />
          )}
          <Input label="Email" type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} error={fields.email} />
          <Input
            label="Password"
            type="password"
            autoComplete={mode === 'register' ? 'new-password' : 'current-password'}
            required
            minLength={mode === 'register' ? 8 : undefined}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            error={fields.password}
            hint={mode === 'register' ? 'At least 8 characters.' : undefined}
          />
          <Button type="submit" busy={busy} className="w-full">
            {mode === 'register' ? 'Create account' : 'Log in'}
          </Button>
          <p className="text-center text-sm text-slate-600">
            {mode === 'register' ? (
              <>
                Already have an account?{' '}
                <Link to="/login" className="font-medium text-remain-700 hover:underline">
                  Log in
                </Link>
              </>
            ) : (
              <>
                New here?{' '}
                <Link to="/register" className="font-medium text-remain-700 hover:underline">
                  Create an account
                </Link>
              </>
            )}
          </p>
        </form>
        {mode === 'register' && (
          <p className="mt-4 text-center text-xs text-slate-500">If a friend already added your email to a trip, you will see that trip right after signing up.</p>
        )}
      </div>
    </main>
  );
}
