/**
 * @vitest-environment jsdom
 */
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const pushMock = vi.fn();
const refreshMock = vi.fn();

vi.mock("next/link", () => ({
  default: ({
    href,
    children,
    className,
  }: {
    href: string;
    children: React.ReactNode;
    className?: string;
  }) => (
    <a href={href} className={className}>
      {children}
    </a>
  ),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({
    push: pushMock,
    refresh: refreshMock,
    replace: vi.fn(),
  }),
  usePathname: () => "/admin/dashboard/asset-register/depreciation",
}));

import { DepreciationMasterScreen } from "./depreciation-master-screen";
import type { DepreciationFyRolloverStatusView } from "./depreciation-fy-rollover-panel";
import type { DepreciationRunListRow } from "./depreciation-master-screen";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function openingFyStatus(
  overrides: Partial<DepreciationFyRolloverStatusView> = {}
): DepreciationFyRolloverStatusView {
  return {
    currentBsDate: "2083/04/14",
    currentFiscalYearStart: 2083,
    priorFiscalYearStart: 2082,
    status: "not_required",
    priorFyFinalRunId: null,
    priorFyFinalRunStatus: "not_applicable",
    blockers: [],
    rolloverAllowed: false,
    blockingReason: null,
    depreciationOpeningFiscalYearStart: 2083,
    depreciationOpeningFyHelpText: "Opening FY: 2083-2084.",
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
    ...overrides,
  };
}

function sampleRun(
  overrides: Partial<DepreciationRunListRow> = {}
): DepreciationRunListRow {
  return {
    id: 12,
    fiscal_year_start: 2083,
    dep_title: "As of 2083/04/14",
    quarter_no: 1,
    months_covered: 1,
    calculation_date_ad: "2026-07-30",
    calculation_date_bs: "2083/04/14",
    depreciation_scope_mode: "AS_OF_DATE",
    remarks: null,
    is_final_for_fy: false,
    status: "posted",
    branch_id: null,
    created_at: "2026-07-30T00:00:00.000Z",
    updated_at: "2026-07-30T00:00:00.000Z",
    ...overrides,
  };
}

function mockFetch(input: {
  runs?: DepreciationRunListRow[];
  runsOk?: boolean;
  runsError?: string;
  status?: DepreciationFyRolloverStatusView | null;
  statusOk?: boolean;
}) {
  const runsOk = input.runsOk ?? true;
  const statusOk = input.statusOk ?? true;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: RequestInfo | URL) => {
      const href = String(url);
      if (href.includes("/api/admin/depreciation-runs") && !href.includes("ensure")) {
        return {
          ok: runsOk,
          json: async () =>
            runsOk
              ? { runs: input.runs ?? [] }
              : { error: input.runsError ?? "Could not load runs." },
        };
      }
      if (href.includes("/api/admin/depreciation-fy-rollover/status")) {
        return {
          ok: statusOk,
          json: async () =>
            statusOk
              ? (input.status ?? openingFyStatus())
              : { error: "Could not load FY rollover status." },
        };
      }
      return { ok: false, json: async () => ({ error: "Unexpected fetch" }) };
    })
  );
}

describe("DepreciationMasterScreen empty state", () => {
  beforeEach(() => {
    pushMock.mockReset();
    refreshMock.mockReset();
  });

  it("shows the empty-state card when zero runs load successfully", async () => {
    mockFetch({ runs: [], status: openingFyStatus() });
    render(<DepreciationMasterScreen />);

    await waitFor(() => {
      expect(screen.getByTestId("depreciation-runs-empty-state")).toBeTruthy();
    });
    expect(screen.getByText("No depreciation runs yet")).toBeTruthy();
    expect(
      screen.getByText(/Your opening fiscal year is FY 2083\/84/i)
    ).toBeTruthy();
    expect(screen.getByText(/on or after 2083\/04\/01/i)).toBeTruthy();
    expect(screen.queryByRole("table")).toBeNull();
  });

  it("links Create depreciation run to the new-run route", async () => {
    mockFetch({ runs: [] });
    render(<DepreciationMasterScreen />);
    await waitFor(() => {
      expect(screen.getByTestId("depreciation-runs-empty-state")).toBeTruthy();
    });
    const links = screen.getAllByRole("link", {
      name: /create depreciation run/i,
    });
    expect(links.length).toBeGreaterThan(0);
    for (const link of links) {
      expect(link.getAttribute("href")).toBe(
        "/admin/dashboard/asset-register/depreciation/new"
      );
    }
  });

  it("hides Export and row actions when there are zero runs", async () => {
    mockFetch({ runs: [] });
    render(<DepreciationMasterScreen />);
    await waitFor(() => {
      expect(screen.getByTestId("depreciation-runs-empty-state")).toBeTruthy();
    });
    expect(screen.queryByRole("button", { name: /^export$/i })).toBeNull();
    expect(screen.queryByRole("link", { name: /^details$/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /^edit$/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /^delete$/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /recalculate/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /void/i })).toBeNull();
  });

  it("enables Calculate as of today when eligibility is met", async () => {
    mockFetch({ runs: [], status: openingFyStatus() });
    render(<DepreciationMasterScreen />);
    await waitFor(() => {
      expect(screen.getByTestId("depreciation-runs-empty-state")).toBeTruthy();
    });
    const empty = screen.getByTestId("depreciation-runs-empty-state");
    const quick = within(empty).getByRole("button", {
      name: /calculate as of today/i,
    }) as HTMLButtonElement;
    expect(quick.disabled).toBe(false);
  });

  it("disables Calculate as of today with a reason when not eligible", async () => {
    mockFetch({
      runs: [],
      status: openingFyStatus({
        status: "blocked",
        priorFyFinalRunStatus: null,
        blockingReason:
          "Previous FY_END depreciation has not been created yet.",
        depreciationOpeningFiscalYearStart: 2082,
        migrationSettings: {
          openingFiscalYearStart: 2082,
          firstSystemDepreciationDateBs: "2082/04/01",
          lastExternalDepreciationDateBs: "2082/03/32",
          source: "env",
          configuredByAdminId: null,
          configuredByAdminEmail: null,
          configuredAt: null,
          editable: true,
          lockReason: null,
        },
      }),
    });
    render(<DepreciationMasterScreen />);
    await waitFor(() => {
      expect(screen.getByTestId("depreciation-runs-empty-state")).toBeTruthy();
    });
    const empty = screen.getByTestId("depreciation-runs-empty-state");
    const quick = within(empty).getByRole("button", {
      name: /calculate as of today/i,
    }) as HTMLButtonElement;
    expect(quick.disabled).toBe(true);
    expect(
      within(empty).getByText(/Previous FY_END depreciation has not been created yet/i)
    ).toBeTruthy();
  });

  it("shows normal table and actions when runs exist", async () => {
    mockFetch({ runs: [sampleRun()] });
    render(<DepreciationMasterScreen />);
    await waitFor(() => {
      expect(screen.getByRole("table")).toBeTruthy();
    });
    expect(screen.queryByTestId("depreciation-runs-empty-state")).toBeNull();
    expect(screen.getByRole("link", { name: /add new/i })).toBeTruthy();
    expect(screen.getByRole("button", { name: /^export$/i })).toBeTruthy();
    expect(screen.getByRole("link", { name: /^details$/i })).toBeTruthy();
    expect(screen.getByText("As of 2083/04/14")).toBeTruthy();
  });

  it("does not show empty state while loading", async () => {
    let resolveRuns: ((value: unknown) => void) | null = null;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: RequestInfo | URL) => {
        const href = String(url);
        if (href.includes("/api/admin/depreciation-runs")) {
          return new Promise((resolve) => {
            resolveRuns = resolve;
          });
        }
        if (href.includes("/api/admin/depreciation-fy-rollover/status")) {
          return {
            ok: true,
            json: async () => openingFyStatus(),
          };
        }
        return { ok: false, json: async () => ({}) };
      })
    );

    render(<DepreciationMasterScreen />);
    expect(screen.getByText(/Loading depreciation runs/i)).toBeTruthy();
    expect(screen.queryByTestId("depreciation-runs-empty-state")).toBeNull();
    expect(screen.queryByText("No depreciation runs yet")).toBeNull();

    await waitFor(() => {
      expect(resolveRuns).not.toBeNull();
    });
    resolveRuns!({
      ok: true,
      json: async () => ({ runs: [] }),
    });
    await waitFor(() => {
      expect(screen.getByTestId("depreciation-runs-empty-state")).toBeTruthy();
    });
  });

  it("does not show empty state on request failure", async () => {
    mockFetch({
      runsOk: false,
      runsError: "Could not load runs.",
      status: openingFyStatus(),
    });
    render(<DepreciationMasterScreen />);
    await waitFor(() => {
      expect(screen.getByRole("alert").textContent).toMatch(/Could not load runs/i);
    });
    expect(screen.queryByTestId("depreciation-runs-empty-state")).toBeNull();
    expect(screen.queryByText("No depreciation runs yet")).toBeNull();
  });
});
