/**
 * @vitest-environment jsdom
 */
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const replaceMock = vi.fn();
const refreshMock = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({
    replace: replaceMock,
    refresh: refreshMock,
    push: vi.fn(),
  }),
}));

import AdminLoginForm, {
  stripCredentialSearchParams,
} from "./admin-login-form";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("stripCredentialSearchParams", () => {
  it("removes email and password from the URL without using them", () => {
    window.history.pushState(
      {},
      "",
      "/admin?email=admin%40saptakoshi.com&password=secret"
    );
    stripCredentialSearchParams();
    expect(window.location.pathname).toBe("/admin");
    expect(window.location.search).toBe("");
  });
});

describe("AdminLoginForm", () => {
  beforeEach(() => {
    replaceMock.mockReset();
    refreshMock.mockReset();
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ admin: { email: "admin@saptakoshi.com" } }),
      })
    );
    window.history.pushState({}, "", "/admin");
  });

  async function fillAndSubmit(
    email: string,
    password: string
  ): Promise<void> {
    const user = userEvent.setup();
    await user.type(screen.getByLabelText("Email"), email);
    await user.type(screen.getByLabelText("Password"), password);
    await user.click(screen.getByRole("button", { name: /^sign in$/i }));
  }

  it("submits a POST with credentials in the body and keeps them out of the URL", async () => {
    render(<AdminLoginForm />);
    await fillAndSubmit("admin@saptakoshi.com", "Hrms@2026!");

    await waitFor(() => {
      expect(fetch).toHaveBeenCalledWith(
        "/api/auth/login",
        expect.objectContaining({
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            email: "admin@saptakoshi.com",
            password: "Hrms@2026!",
          }),
        })
      );
    });

    expect(window.location.href).not.toMatch(/[?&]email=/);
    expect(window.location.href).not.toMatch(/[?&]password=/);
    expect(window.location.search).toBe("");
  });

  it("redirects to the admin dashboard after successful login", async () => {
    render(<AdminLoginForm />);
    await fillAndSubmit("admin@saptakoshi.com", "Hrms@2026!");

    await waitFor(() => {
      expect(replaceMock).toHaveBeenCalledWith(
        "/admin/dashboard/asset-register"
      );
    });
    expect(refreshMock).toHaveBeenCalled();
  });

  it("displays an error when login fails", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        json: async () => ({ error: "Invalid email or password." }),
      })
    );
    render(<AdminLoginForm />);
    await fillAndSubmit("admin@saptakoshi.com", "wrong");

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toBe("Invalid email or password.");
    expect(replaceMock).not.toHaveBeenCalled();
  });

  it("does not submit when email or password is empty", async () => {
    render(<AdminLoginForm />);
    const form = screen.getByRole("button", { name: /^sign in$/i }).closest(
      "form"
    );
    expect(form).toBeTruthy();

    fireEvent.change(screen.getByLabelText("Email"), {
      target: { value: "   " },
    });
    fireEvent.change(screen.getByLabelText("Password"), {
      target: { value: "" },
    });
    fireEvent.submit(form!);

    expect(fetch).not.toHaveBeenCalled();
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toBe("Email and password are required.");
  });

  it("uses type=submit and method=post so native submit cannot put credentials in the query string", () => {
    render(<AdminLoginForm />);
    const button = screen.getByRole("button", { name: /^sign in$/i });
    const form = button.closest("form");
    expect(form?.getAttribute("method")).toBe("post");
    expect(form?.hasAttribute("action")).toBe(false);
    expect(button.getAttribute("type")).toBe("submit");
  });
});
