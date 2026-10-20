import { useMutation } from '@tanstack/react-query';
import { FormEvent, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { api } from '../api/endpoints';
import type { AuthResponse } from '../api/types';
import { useAuth } from '../auth/AuthContext';
import { ErrorNote } from '../components/ui';

function useAfterAuth() {
  const { signIn } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const from = (location.state as { from?: string } | null)?.from;
  return (auth: AuthResponse) => {
    signIn(auth);
    const home = auth.user.role === 'SELLER' ? '/sell' : auth.user.role === 'ADMIN' ? '/admin' : '/';
    navigate(from ?? home, { replace: true });
  };
}

export function LoginPage() {
  const done = useAfterAuth();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const login = useMutation({ mutationFn: api.login, onSuccess: done });

  const submit = (e: FormEvent) => {
    e.preventDefault();
    login.mutate({ username: username.trim(), password });
  };

  return (
    <section className="page auth">
      <h1>Sign in</h1>
      <form onSubmit={submit} className="form">
        <label>
          Username
          <input autoComplete="username" required value={username} onChange={(e) => setUsername(e.target.value)} />
        </label>
        <label>
          Password
          <input
            type="password"
            autoComplete="current-password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </label>
        <ErrorNote error={login.error} />
        <button className="btn btn-ink btn-block" disabled={login.isPending}>
          {login.isPending ? 'Signing in…' : 'Sign in'}
        </button>
      </form>
      <p className="muted">
        New here? <Link to="/register">Create an account</Link>
      </p>
    </section>
  );
}

export function RegisterPage() {
  const done = useAfterAuth();
  const [form, setForm] = useState({ username: '', password: '', phone: '', role: 'BUYER' as 'BUYER' | 'SELLER' });
  const register = useMutation({ mutationFn: api.register, onSuccess: done });

  const submit = (e: FormEvent) => {
    e.preventDefault();
    register.mutate({
      username: form.username.trim(),
      password: form.password,
      phone: form.phone.trim() || undefined,
      role: form.role,
    });
  };

  return (
    <section className="page auth">
      <h1>Create an account</h1>
      <form onSubmit={submit} className="form">
        <fieldset className="choice">
          <legend>I want to</legend>
          <label className={form.role === 'BUYER' ? 'chosen' : ''}>
            <input
              type="radio"
              name="role"
              checked={form.role === 'BUYER'}
              onChange={() => setForm({ ...form, role: 'BUYER' })}
            />
            Shop
          </label>
          <label className={form.role === 'SELLER' ? 'chosen' : ''}>
            <input
              type="radio"
              name="role"
              checked={form.role === 'SELLER'}
              onChange={() => setForm({ ...form, role: 'SELLER' })}
            />
            Sell
          </label>
        </fieldset>
        <label>
          Username
          <input
            autoComplete="username"
            required
            minLength={3}
            maxLength={50}
            pattern="[A-Za-z0-9_.\-]+"
            title="Letters, digits, underscore, dot or hyphen"
            value={form.username}
            onChange={(e) => setForm({ ...form, username: e.target.value })}
          />
        </label>
        <label>
          Password
          <input
            type="password"
            autoComplete="new-password"
            required
            minLength={8}
            maxLength={72}
            value={form.password}
            onChange={(e) => setForm({ ...form, password: e.target.value })}
          />
          <small className="muted">At least 8 characters.</small>
        </label>
        <label>
          Phone <span className="muted">(optional)</span>
          <input
            type="tel"
            autoComplete="tel"
            value={form.phone}
            onChange={(e) => setForm({ ...form, phone: e.target.value })}
          />
        </label>
        <ErrorNote error={register.error} />
        <button className="btn btn-ink btn-block" disabled={register.isPending}>
          {register.isPending ? 'Creating account…' : 'Create account'}
        </button>
      </form>
      <p className="muted">
        Already registered? <Link to="/login">Sign in</Link>
      </p>
    </section>
  );
}
