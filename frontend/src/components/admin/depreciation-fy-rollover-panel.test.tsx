/**
 * @vitest-environment jsdom
 */
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("next/link", () => ({
  default: ({ href, children, className }: { href: string; children: React.ReactNode; className?: string }) => (
    <a href={href} className={className}>
      {children}
    </a>
  ),
}));

import {
  DepreciationFyRolloverPanel,
  type DepreciationFyRolloverActionResult,
  type DepreciationFyRolloverStatusView,
} from "./depreciation-fy-rollover-panel";

afterEach(() => {
  cleanup();
});

function buildStatus(
  overrides: Partial<DepreciationFyRolloverStatusView> = {}
): DepreciationFyRolloverStatusView {
  return {
    currentBsDate: "2083/04/01",
    currentFiscalYearStart: 2083,
    priorFiscalYearStart: 2082,
    status: "pending",
    priorFyFinalRunId: 88,
    priorFyFinalRunStatus: "posted",
    priorFyFinalRunTitle: "Fiscal year closing (FY_END)",
    blockers: [],
    rolloverAllowed: true,
    blockingReason: null,
    sourceFinalRunId: 88,
    completedAt: null,
    completedByAdminId: null,
    completedByAdminEmail: null,
    depreciationOpeningFiscalYearStart: 2082,
    depreciationOpeningFyHelpText: "Opening FY: 2082-2083.",
    migrationSettings: {
      openingFiscalYearStart: 2082,
      firstSystemDepreciationDateBs: "2082/04/01",
      lastExternalDepreciationDateBs: "2082/03/31",
      source: "database",
      configuredByAdminId: 1,
      configuredByAdminEmail: "admin@example.com",
      configuredAt: "2026-07-30T10:00:00.000Z",
      editable: false,
      lockReason: "Locked after accounting history exists.",
    },
    ...overrides,
  };
}

function renderPanel(input?: {
  status?: DepreciationFyRolloverStatusView | null;
  loading?: boolean;
  error?: string | null;
  createFyEndLoading?: boolean;
  rolloverLoading?: boolean;
  priorFyRunHref?: string | null;
  onCreatePriorFyEnd?: () => Promise<void>;
  onRefreshStatusBeforeConfirm?: () => Promise<DepreciationFyRolloverStatusView | null>;
  onRunRollover?: () => Promise<DepreciationFyRolloverActionResult>;
}) {
  const onCreatePriorFyEnd =
    input?.onCreatePriorFyEnd ?? vi.fn(async () => undefined);
  const onRefreshStatusBeforeConfirm =
    input?.onRefreshStatusBeforeConfirm ?? vi.fn(async () => buildStatus());
  const onRunRollover =
    input?.onRunRollover ??
    vi.fn(async (): Promise<DepreciationFyRolloverActionResult> => ({
      status: "applied",
      newFiscalYearStart: 2083,
      priorFiscalYearStart: 2082,
      branchId: null,
      sourceFinalRunId: 88,
    }));

  render(
    <DepreciationFyRolloverPanel
      status={input?.status ?? buildStatus()}
      loading={input?.loading ?? false}
      error={input?.error ?? null}
      createFyEndLoading={input?.createFyEndLoading ?? false}
      rolloverLoading={input?.rolloverLoading ?? false}
      priorFyRunHref={input?.priorFyRunHref ?? "/admin/dashboard/asset-register/depreciation/88"}
      onCreatePriorFyEnd={onCreatePriorFyEnd}
      onRefreshStatusBeforeConfirm={onRefreshStatusBeforeConfirm}
      onRunRollover={onRunRollover}
    />
  );

  return {
    onCreatePriorFyEnd,
    onRefreshStatusBeforeConfirm,
    onRunRollover,
  };
}

describe("DepreciationFyRolloverPanel", () => {
  it("shows the loading state", () => {
    renderPanel({ status: null, loading: true });
    expect(screen.getByText("Loading status…")).toBeTruthy();
  });

  it("shows the not_required state calmly (no create year-end CTA)", () => {
    renderPanel({
      status: buildStatus({
        status: "not_required",
        rolloverAllowed: false,
        priorFyFinalRunId: null,
        priorFyFinalRunStatus: "not_applicable",
        blockers: [],
        blockingReason: null,
        currentFiscalYearStart: 2083,
        priorFiscalYearStart: 2082,
        depreciationOpeningFiscalYearStart: 2083,
        migrationSettings: {
          openingFiscalYearStart: 2083,
          firstSystemDepreciationDateBs: "2083/04/01",
          lastExternalDepreciationDateBs: "2083/03/32",
          source: "env",
          configuredByAdminId: null,
          configuredByAdminEmail: null,
          configuredAt: null,
          editable: true,
          lockReason: null,
        },
      }),
    });

    expect(screen.getByText("Not needed this year")).toBeTruthy();
    expect(
      screen.getByText(/first system fiscal year/i)
    ).toBeTruthy();
    expect(screen.queryByText(/Year-end depreciation missing/i)).toBeNull();
    expect(screen.queryByText(/^Not created yet$/)).toBeNull();
    expect(
      screen.queryByRole("button", { name: /create year-end depreciation/i })
    ).toBeNull();
    expect(
      screen.queryByRole("button", { name: /set opening balances/i })
    ).toBeNull();
    expect(screen.getByText("More details")).toBeTruthy();
    const technical = screen.getByText("More details").closest("details");
    expect(technical).toBeTruthy();
    expect(
      within(technical as HTMLElement).getByText("Environment fallback")
    ).toBeTruthy();
  });

  it("still shows genuine prior year-end requirements after opening FY", () => {
    renderPanel({
      status: buildStatus({
        status: "blocked",
        rolloverAllowed: false,
        priorFyFinalRunId: null,
        priorFyFinalRunStatus: null,
        blockers: ["PRIOR_FY_FINAL_DEPRECIATION_REQUIRED"],
        blockingReason:
          "Previous FY_END depreciation has not been created yet. Create and review the prior fiscal year final run before rollover.",
        currentFiscalYearStart: 2084,
        priorFiscalYearStart: 2083,
        depreciationOpeningFiscalYearStart: 2083,
        migrationSettings: {
          openingFiscalYearStart: 2083,
          firstSystemDepreciationDateBs: "2083/04/01",
          lastExternalDepreciationDateBs: "2083/03/32",
          source: "database",
          configuredByAdminId: 1,
          configuredByAdminEmail: "admin@example.com",
          configuredAt: "2026-07-30T10:00:00.000Z",
          editable: false,
          lockReason: "Locked after accounting history exists.",
        },
      }),
    });

    expect(screen.getByText("Year-end depreciation missing")).toBeTruthy();
    expect(
      screen.getByRole("button", {
        name: /create year-end depreciation for fy 2083\/84/i,
      })
    ).toBeTruthy();
    expect(screen.getByText(/you are here/i)).toBeTruthy();
  });

  it("shows a blocked state with plain-language guidance", () => {
    renderPanel({
      status: buildStatus({
        status: "blocked",
        rolloverAllowed: false,
        priorFyFinalRunId: null,
        priorFyFinalRunStatus: null,
        blockers: ["PRIOR_FY_FINAL_DEPRECIATION_REQUIRED"],
        blockingReason:
          "Previous FY_END depreciation has not been created yet. Create and review the prior fiscal year final run before rollover.",
      }),
    });

    expect(screen.getByText("Year-end depreciation missing")).toBeTruthy();
    expect(
      screen.getByText(/Create year-end depreciation for the previous fiscal year/i)
    ).toBeTruthy();
    expect(
      screen.getByRole("button", { name: /create year-end depreciation/i })
    ).toBeTruthy();
  });

  it("shows the completed state with audit information and next step", () => {
    renderPanel({
      status: buildStatus({
        status: "completed",
        rolloverAllowed: false,
        completedAt: "2026-07-30T10:30:00.000Z",
        completedByAdminEmail: "admin@example.com",
      }),
    });

    expect(screen.getByText("Opening balances are set")).toBeTruthy();
    expect(screen.getAllByText("admin@example.com").length).toBeGreaterThan(0);
    expect(screen.getAllByText("#88").length).toBeGreaterThan(0);
    expect(screen.getByText(/Quick: as of today/i)).toBeTruthy();
    expect(screen.queryByText(/System calculates from/i)).toBeNull();
  });

  it("shows a safe non-admin error state", () => {
    renderPanel({
      status: null,
      error: "Unauthorized.",
    });

    expect(screen.getByText("Could not load")).toBeTruthy();
    expect(screen.getByRole("alert").textContent).toContain("Unauthorized.");
    expect(
      screen.queryByRole("button", { name: /set opening balances/i })
    ).toBeNull();
  });

  it("allows cancelling the confirmation dialog", async () => {
    const user = userEvent.setup();
    const { onRefreshStatusBeforeConfirm, onRunRollover } = renderPanel();

    await user.click(
      screen.getByRole("button", { name: /set opening balances for fy 2083\/84/i })
    );
    expect(onRefreshStatusBeforeConfirm).toHaveBeenCalledTimes(1);
    expect(
      screen.getByText(/Set opening balances for FY 2083\/84\?/i)
    ).toBeTruthy();

    await user.click(screen.getByRole("button", { name: /^cancel$/i }));
    await waitFor(() => {
      expect(
        screen.queryByText(/Set opening balances for FY 2083\/84\?/i)
      ).toBeNull();
    });
    expect(onRunRollover).not.toHaveBeenCalled();
  });

  it("handles successful rollover after a fresh status check", async () => {
    const user = userEvent.setup();
    const { onRefreshStatusBeforeConfirm, onRunRollover } = renderPanel();

    await user.click(
      screen.getByRole("button", { name: /set opening balances for fy 2083\/84/i })
    );
    expect(onRefreshStatusBeforeConfirm).toHaveBeenCalledTimes(1);

    await user.click(screen.getByRole("checkbox"));
    await user.click(
      screen.getByRole("button", { name: /confirm opening balances/i })
    );

    await waitFor(() => {
      expect(screen.getByRole("status").textContent).toContain(
        "Opening balances are set"
      );
    });
    expect(onRunRollover).toHaveBeenCalledTimes(1);
  });

  it("treats already_applied as a completed outcome", async () => {
    const user = userEvent.setup();
    renderPanel({
      onRunRollover: vi.fn(async (): Promise<DepreciationFyRolloverActionResult> => ({
        status: "already_applied",
        newFiscalYearStart: 2083,
        priorFiscalYearStart: 2082,
        branchId: null,
        sourceFinalRunId: 88,
      })),
    });

    await user.click(
      screen.getByRole("button", { name: /set opening balances for fy 2083\/84/i })
    );
    await user.click(screen.getByRole("checkbox"));
    await user.click(
      screen.getByRole("button", { name: /confirm opening balances/i })
    );

    await waitFor(() => {
      expect(screen.getByRole("status").textContent).toContain(
        "already set earlier"
      );
    });
  });

  it("shows backend action errors without crashing", async () => {
    const user = userEvent.setup();
    renderPanel({
      onRunRollover: vi.fn(async () => {
        throw new Error("Prior FY_END depreciation exists but is not posted.");
      }),
    });

    await user.click(
      screen.getByRole("button", { name: /set opening balances for fy 2083\/84/i })
    );
    await user.click(screen.getByRole("checkbox"));
    await user.click(
      screen.getByRole("button", { name: /confirm opening balances/i })
    );

    await waitFor(() => {
      expect(screen.getByRole("alert").textContent).toContain(
        "Prior FY_END depreciation exists but is not posted."
      );
    });
  });

  it("disables the rollover button during submission", () => {
    renderPanel({ rolloverLoading: true });
    const button = screen.getByRole("button", {
      name: /setting opening balances/i,
    }) as HTMLButtonElement;
    expect(button.disabled).toBe(true);
  });

  it("uses the fresh server status before opening confirmation", async () => {
    const user = userEvent.setup();
    renderPanel({
      onRefreshStatusBeforeConfirm: vi.fn(async () =>
        buildStatus({
          status: "blocked",
          rolloverAllowed: false,
          priorFyFinalRunId: 88,
          priorFyFinalRunStatus: "void",
          blockers: ["PRIOR_FY_FINAL_DEPRECIATION_REQUIRED"],
          blockingReason: "Previous FY_END depreciation was voided.",
        })
      ),
    });

    await user.click(
      screen.getByRole("button", { name: /set opening balances for fy 2083\/84/i })
    );

    await waitFor(() => {
      expect(screen.getByRole("alert").textContent).toMatch(
        /year-end|voided/i
      );
    });
    expect(
      screen.queryByText(/Set opening balances for FY 2083\/84\?/i)
    ).toBeNull();
  });
});
