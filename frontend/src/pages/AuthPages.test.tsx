import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { mockApi, renderAt } from '../test/utils';
import { LoginPage, RegisterPage } from './AuthPages';

const routes = [
  { path: '/login', element: <LoginPage /> },
  { path: '/register', element: <RegisterPage /> },
  { path: '/', element: <p>Catalogue</p> },
  { path: '/sell', element: <p>Seller home</p> },
];

describe('auth pages', () => {
  it('shows the server’s message on bad credentials', async () => {
    mockApi({
      'POST /api/auth/login': () => ({ status: 401, body: { code: 'BAD_CREDENTIALS', message: 'Wrong username or password' } }),
    });
    renderAt('/login', routes);
    await userEvent.type(screen.getByLabelText('Username'), 'alice');
    await userEvent.type(screen.getByLabelText('Password'), 'nope');
    await userEvent.click(screen.getByRole('button', { name: 'Sign in' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Wrong username or password');
    expect(localStorage.getItem('pd.token')).toBeNull();
  });

  it('registers a seller, stores the token and lands on the seller page', async () => {
    const { calls } = mockApi({
      'POST /api/auth/register': () => ({
        status: 201,
        body: { accessToken: 'jwt', expiresIn: 7200, user: { id: 3, username: 'shop', role: 'SELLER' } },
      }),
    });
    renderAt('/register', routes);
    await userEvent.click(screen.getByLabelText('Sell'));
    await userEvent.type(screen.getByLabelText('Username'), 'shop');
    await userEvent.type(screen.getByLabelText(/^Password/), 'password123');
    await userEvent.click(screen.getByRole('button', { name: 'Create account' }));

    expect(await screen.findByText('Seller home')).toBeInTheDocument();
    expect(localStorage.getItem('pd.token')).toBe('jwt');
    const body = JSON.parse(String(calls[0].init.body));
    expect(body).toEqual({ username: 'shop', password: 'password123', role: 'SELLER' });
  });
});
