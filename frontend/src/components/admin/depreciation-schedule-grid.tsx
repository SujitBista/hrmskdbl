"use client";

import type { DepreciationScheduleResult } from "@/lib/depreciation-schedule";

function formatMoney(amount: number): string {
  return new Intl.NumberFormat(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(amount);
}

export function DepreciationScheduleGrid({
  result,
}: {
  result: DepreciationScheduleResult | null;
}) {
  if (result === null) {
    return (
      <p className="text-sm text-slate-500">
        Select an asset to see the first-year projected schedule.
      </p>
    );
  }

  if (!result.ok) {
    return (
      <div
        className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-900"
        role="alert"
      >
        <p className="font-medium">Cannot calculate</p>
        <ul className="mt-2 list-inside list-disc">
          {result.errors.map((e) => (
            <li key={e}>{e}</li>
          ))}
        </ul>
      </div>
    );
  }

  const { summary, rows } = result;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 sm:flex-row sm:items-start sm:justify-between">
        <span className="inline-flex w-fit shrink-0 items-center rounded-full border border-slate-300 bg-slate-50 px-3 py-1 text-xs font-semibold uppercase tracking-wide text-slate-800">
          Mode: {summary.calculationModeLabel}
        </span>
        <div className="min-w-0 space-y-1 text-xs text-slate-600">
          <p>
            <span className="font-medium text-slate-700">ERP Accurate:</span>{" "}
            uses actual date ranges and is preferred for accounting accuracy.
          </p>
          <p>
            <span className="font-medium text-slate-700">Excel Fixed:</span>{" "}
            is a simplified spreadsheet-style approximation.
          </p>
        </div>
      </div>

      <div className="overflow-x-auto rounded-lg border border-slate-200 bg-slate-50 p-4">
        <p className="mb-3 text-sm font-semibold text-slate-800">Summary</p>
        <dl className="grid gap-x-6 gap-y-2 sm:grid-cols-2 lg:grid-cols-3 text-sm">
          <div>
            <dt className="text-slate-500">Purchase amount</dt>
            <dd className="font-medium tabular-nums text-slate-900">
              {formatMoney(summary.purchaseAmount)}
            </dd>
          </div>
          <div>
            <dt className="text-slate-500">Depreciation method</dt>
            <dd className="font-medium text-slate-900">
              {summary.depreciationMethodLabel}
            </dd>
          </div>
          <div>
            <dt className="text-slate-500">Calculation mode</dt>
            <dd className="font-medium text-slate-900">
              {summary.calculationModeLabel}
            </dd>
          </div>
          <div>
            <dt className="text-slate-500">Dep rate</dt>
            <dd className="font-medium tabular-nums text-slate-900">
              {summary.depRatePercent}%
            </dd>
          </div>
          <div>
            <dt className="text-slate-500">First year from (depreciation start)</dt>
            <dd className="font-mono text-slate-900">
              {summary.calculationFromBs}
            </dd>
          </div>
          <div>
            <dt className="text-slate-500">First year through</dt>
            <dd className="font-mono text-slate-900">
              {summary.calculationToBs}
            </dd>
          </div>
          <div>
            <dt className="text-slate-500">Total working days (in schedule)</dt>
            <dd className="font-medium tabular-nums text-slate-900">
              {summary.totalWorkingDays}
            </dd>
          </div>
          <div>
            <dt className="text-slate-500">Total depreciation</dt>
            <dd className="font-medium tabular-nums text-slate-900">
              {formatMoney(summary.totalDepreciation)}
            </dd>
          </div>
          <div>
            <dt className="text-slate-500">Book value (end of schedule)</dt>
            <dd className="font-semibold tabular-nums text-emerald-900">
              {formatMoney(summary.currentBookValue)}
            </dd>
          </div>
        </dl>
      </div>

      <div className="overflow-x-auto rounded-lg border border-slate-300 shadow-sm">
        <table className="min-w-[1180px] border-collapse text-sm">
          <caption className="caption-bottom space-y-1 px-2 py-2 text-left text-xs text-slate-600">
            <p>
              <span className="font-medium text-slate-700">Closing</span> ={" "}
              <span className="font-medium text-slate-700">purchase amount</span>{" "}
              − <span className="font-medium text-slate-700">total dep</span> (same
              as opening − dep amount for this row only). Declining balance: dep
              base is prior closing (period 1 uses cost).
            </p>
            <p>
              Period 2+ <span className="font-medium text-slate-700">opening</span>{" "}
              already includes prior depreciation (it is the previous
              closing). Closing is{" "}
              <span className="font-medium text-slate-700">not</span> opening −
              total dep — that would remove earlier months twice. Use opening −
              this row&rsquo;s dep only, or purchase amount − total dep.
            </p>
          </caption>
          <thead>
            <tr className="bg-slate-200 text-left text-xs font-semibold uppercase tracking-wide text-slate-800">
              <th
                scope="col"
                className="border border-slate-300 px-2 py-2"
              >
                Period
              </th>
              <th
                scope="col"
                className="border border-slate-300 px-2 py-2"
              >
                Start date
              </th>
              <th
                scope="col"
                className="border border-slate-300 px-2 py-2"
              >
                End date
              </th>
              <th
                scope="col"
                className="border border-slate-300 px-2 py-2 text-right"
                title="Written-down value at the start of this period. From period 2 onward, this equals the previous row’s closing (already net of earlier depreciation)."
              >
                Opening (WDV)
              </th>
              <th
                scope="col"
                className="border border-slate-300 px-2 py-2 text-right"
              >
                Dep base
              </th>
              <th
                scope="col"
                className="border border-slate-300 px-2 py-2 text-right"
              >
                Dep rate %
              </th>
              <th
                scope="col"
                className="border border-slate-300 px-2 py-2 text-right"
              >
                Working days
              </th>
              <th
                scope="col"
                className="border border-slate-300 px-2 py-2 text-right"
              >
                Dep amount
              </th>
              <th
                scope="col"
                className="border border-slate-300 px-2 py-2 text-right"
                title="Cumulative depreciation from period 1 through this row. Compare to purchase amount in the summary — purchase minus this total equals closing."
              >
                Total dep
              </th>
              <th
                scope="col"
                className="sticky right-0 z-10 border border-slate-300 border-l-slate-400 bg-slate-200 px-2 py-2 text-right shadow-[-4px_0_8px_-2px_rgba(15,23,42,0.12)]"
              >
                Book value (closing)
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, rowIdx) => (
              <tr
                key={`${r.period}-${r.startDateBs}`}
                className="bg-white odd:bg-slate-50/90"
              >
                <td className="border border-slate-300 px-2 py-1.5 tabular-nums">
                  {r.period}
                </td>
                <td className="border border-slate-300 px-2 py-1.5 font-mono text-xs">
                  {r.startDateBs}
                </td>
                <td className="border border-slate-300 px-2 py-1.5 font-mono text-xs">
                  {r.endDateBs}
                </td>
                <td className="border border-slate-300 px-2 py-1.5 text-right tabular-nums">
                  {formatMoney(r.openingBookValue)}
                </td>
                <td className="border border-slate-300 px-2 py-1.5 text-right tabular-nums">
                  {formatMoney(r.depBaseAmount)}
                </td>
                <td className="border border-slate-300 px-2 py-1.5 text-right tabular-nums">
                  {r.depRatePercent}
                </td>
                <td className="border border-slate-300 px-2 py-1.5 text-right tabular-nums">
                  {r.workingDays}
                </td>
                <td className="border border-slate-300 px-2 py-1.5 text-right tabular-nums">
                  {formatMoney(r.depAmount)}
                </td>
                <td className="border border-slate-300 px-2 py-1.5 text-right tabular-nums">
                  {formatMoney(r.totalDepAmount)}
                </td>
                <td
                  className={`sticky right-0 z-10 border border-slate-300 border-l-slate-400 px-2 py-1.5 text-right font-semibold tabular-nums text-emerald-900 shadow-[-4px_0_8px_-2px_rgba(15,23,42,0.08)] ${
                    rowIdx % 2 === 1 ? "bg-slate-50/90" : "bg-white"
                  }`}
                >
                  {formatMoney(r.closingBookValue)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
