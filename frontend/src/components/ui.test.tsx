import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ConfirmButton, Countdown, OrderTrack, PriceTag, ProductArt } from './ui';

describe('PriceTag', () => {
  it('exposes the full price to assistive tech', () => {
    render(<PriceTag cents={4599} />);
    expect(screen.getByLabelText('$45.99')).toBeInTheDocument();
  });
});

describe('OrderTrack', () => {
  it('marks completed and current steps of the lifecycle', () => {
    render(<OrderTrack status="SHIPPED" />);
    const steps = screen.getAllByRole('listitem');
    expect(steps.map((s) => s.textContent)).toEqual(['1Placed', '2Paid', '3Shipped', '4Delivered']);
    expect(steps[0]).toHaveClass('done');
    expect(steps[1]).toHaveClass('done');
    expect(steps[2]).toHaveAttribute('aria-current', 'step');
    expect(steps[3]).not.toHaveClass('done');
  });

  it('shows cancellation instead of the normal track', () => {
    render(<OrderTrack status="CANCELLED" />);
    expect(screen.getByText('Cancelled')).toHaveClass('current');
    expect(screen.queryByText('Shipped')).not.toBeInTheDocument();
  });
});

describe('ProductArt', () => {
  it('renders the image when there is one, otherwise an initial', () => {
    const { rerender, container } = render(<ProductArt src="/uploads/a.png" name="Lamp" />);
    expect(screen.getByRole('img', { name: 'Lamp' })).toHaveAttribute('src', '/uploads/a.png');
    rerender(<ProductArt name="lamp" />);
    expect(container.textContent).toBe('L');
  });
});

describe('Countdown', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('counts down and fires onExpire once the window closes', () => {
    const onExpire = vi.fn();
    const until = new Date(Date.now() + 2500).toISOString();
    render(<Countdown until={until} onExpire={onExpire} />);
    expect(screen.getByText('0:03')).toBeInTheDocument();
    act(() => vi.advanceTimersByTime(1000));
    expect(screen.getByText('0:02')).toBeInTheDocument();
    // One tick per act: each re-render schedules the next one-second timer.
    act(() => vi.advanceTimersByTime(1000));
    expect(screen.getByText('0:01')).toBeInTheDocument();
    act(() => vi.advanceTimersByTime(1000));
    expect(screen.getByText('Payment window closed')).toBeInTheDocument();
    expect(onExpire).toHaveBeenCalledTimes(1);
  });
});

describe('ConfirmButton', () => {
  it('asks before acting, and can be backed out of', async () => {
    const onConfirm = vi.fn();
    render(<ConfirmButton label="Cancel order" question="Cancel this order?" confirmLabel="Yes, cancel" onConfirm={onConfirm} />);
    await userEvent.click(screen.getByRole('button', { name: 'Cancel order' }));
    expect(screen.getByText('Cancel this order?')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Keep it' }));
    expect(onConfirm).not.toHaveBeenCalled();

    await userEvent.click(screen.getByRole('button', { name: 'Cancel order' }));
    await userEvent.click(screen.getByRole('button', { name: 'Yes, cancel' }));
    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('button', { name: 'Cancel order' })).toBeInTheDocument();
  });
});
