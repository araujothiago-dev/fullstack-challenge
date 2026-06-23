import { act, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { ToastProvider, useToast } from "./Toast";

function Harness() {
  const toast = useToast();
  return (
    <div>
      <button onClick={() => toast.show("Falhou feio")}>erro</button>
      <button onClick={() => toast.show("Deu certo", "success")}>ok</button>
    </div>
  );
}

describe("ToastProvider", () => {
  it("exibe a notificacao disparada via useToast", async () => {
    const user = userEvent.setup();
    render(
      <ToastProvider>
        <Harness />
      </ToastProvider>,
    );

    await user.click(screen.getByText("erro"));
    expect(screen.getByRole("alert")).toHaveTextContent("Falhou feio");
  });

  it("remove a notificacao ao clicar nela", async () => {
    const user = userEvent.setup();
    render(
      <ToastProvider>
        <Harness />
      </ToastProvider>,
    );

    await user.click(screen.getByText("ok"));
    const toast = screen.getByRole("alert");
    expect(toast).toHaveTextContent("Deu certo");

    await user.click(toast);
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("some sozinha apos o tempo de auto-dismiss", () => {
    vi.useFakeTimers();
    try {
      render(
        <ToastProvider>
          <Harness />
        </ToastProvider>,
      );
      fireEvent.click(screen.getByText("erro"));
      expect(screen.getByRole("alert")).toHaveTextContent("Falhou feio");

      act(() => {
        vi.advanceTimersByTime(4000);
      });
      expect(screen.queryByRole("alert")).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it("useToast lanca erro fora do provider", () => {
    function Orphan() {
      useToast();
      return null;
    }
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(() => render(<Orphan />)).toThrow(/ToastProvider/);
    spy.mockRestore();
  });
});
