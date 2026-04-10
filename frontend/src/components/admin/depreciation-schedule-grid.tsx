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
        Select an asset and dates to build the schedule.
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
            <dt className="text-slate-500">Dep rate</dt>
            <dd className="font-medium tabular-nums text-slate-900">
              {summary.depRatePercent}%
            </dd>
          </div>
          <div>
            <dt className="text-slate-500">Calculation from</dt>
            <dd className="font-mono text-slate-900">
              {summary.calculationFromBs}
            </dd>
          </div>
          <div>
            <dt className="text-slate-500">Calculation to</dt>
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
            <dt className="text-slate-500">This period depreciation (last row)</dt>
            <dd className="font-medium tabular-nums text-slate-900">
              {formatMoney(summary.thisPeriodDepreciation)}
            </dd>
          </div>
          <div>
            <dt className="text-slate-500">Total depreciation</dt>
            <dd className="font-medium tabular-nums text-slate-900">
              {formatMoney(summary.totalDepreciation)}
            </dd>
          </div>
          <div>
            <dt className="text-slate-500">Current book value</dt>
            <dd className="font-semibold tabular-nums text-emerald-900">
              {formatMoney(summary.currentBookValue)}
            </dd>
          </div>
        </dl>
      </div>

      <div className="overflow-x-auto rounded-lg border border-slate-300 shadow-sm">
        <table className="min-w-[1100px] border-collapse text-sm">
          <thead>
            <tr className="bg-slate-200 text-left text-xs font-semibold uppercase tracking-wide text-slate-800">
              <th className="border border-slate-300 px-2 py-2">Period</th>
              <th className="border border-slate-300 px-2 py-2">Start date</th>
              <th className="border border-slate-300 px-2 py-2">End date</th>
              <th className="border border-slate-300 px-2 py-2 text-right">
                Opening BV
              </th>
              <th className="border border-slate-300 px-2 py-2 text-right">
                Dep base
              </th>
              <th className="border border-slate-300 px-2 py-2 text-right">
                Dep rate %
              </th>
              <th className="border border-slate-300 px-2 py-2 text-right">
                Working days
              </th>
              <th className="border border-slate-300 px-2 py-2 text-right">
                Dep amount
              </th>
              <th className="border border-slate-300 px-2 py-2 text-right">
                Total dep
              </th>
              <th className="border border-slate-300 px-2 py-2 text-right">
                Closing BV
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
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
                <td className="border border-slate-300 px-2 py-1.5 text-right font-medium tabular-nums text-emerald-900">
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
