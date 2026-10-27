import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useCallback, useState } from "react";
import { act, cleanup, render } from "@testing-library/react";
import { useExpiringCountdown } from "@/hooks/useExpiringCountdown";

// Mirrors how StudentHomework uses the hook: handleSubmit switches the timer off itself.
function Harness({ onSubmit, start = 3, paused = false }: { onSubmit: (answers: string) => void; start?: number; paused?: boolean }) {
  const [seconds, setSeconds] = useState(start);
  const [active, setActive] = useState(true);
  const [answer, setAnswer] = useState("typed in the last second");
  const submit = useCallback(() => { setActive(false); onSubmit(answer); }, [answer, onSubmit]);
  useExpiringCountdown({ active, seconds, setSeconds, paused, onExpire: submit });
  return <div><span data-testid="t">{seconds}</span><button onClick={() => setAnswer("changed")}>x</button></div>;
}

const tick = async (secs: number) => { for (let i = 0; i < secs; i++) await act(async () => { await vi.advanceTimersByTimeAsync(1000); }); };

beforeEach(() => vi.useFakeTimers());
afterEach(() => { cleanup(); vi.useRealTimers(); });

describe("homework countdown auto-submit", () => {
  it("submits exactly once when the timer reaches 00:00", async () => {
    const onSubmit = vi.fn();
    render(<Harness onSubmit={onSubmit} />);
    await tick(2);
    expect(onSubmit).not.toHaveBeenCalled();
    await tick(1); // reaches 00:00
    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(onSubmit).toHaveBeenCalledWith("typed in the last second");
    await tick(10);
    expect(onSubmit).toHaveBeenCalledTimes(1);
  });
  it("does not run (or submit) while paused, e.g. during the draft restore prompt", async () => {
    const onSubmit = vi.fn();
    const { getByTestId } = render(<Harness onSubmit={onSubmit} paused />);
    await act(async () => { await vi.advanceTimersByTimeAsync(10_000); });
    expect(getByTestId("t").textContent).toBe("3");
    expect(onSubmit).not.toHaveBeenCalled();
  });
});
