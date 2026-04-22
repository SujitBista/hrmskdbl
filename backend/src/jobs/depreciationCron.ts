import cron from "node-cron";
import { createLogger } from "../logger.js";
import { ensureCurrentFiscalYearAutomation } from "../services/depreciationAutomation.js";

const log = createLogger("jobs.depreciationCron");

const DEFAULT_SCHEDULE = "0 * * * *";

/** Survives `tsx watch` module reloads so we can stop the previous task before scheduling again. */
type CronGlobalState = {
  task: cron.ScheduledTask | null;
  tickRunning: boolean;
};

function getGlobalState(): CronGlobalState {
  const g = globalThis as typeof globalThis & {
    __hrmskdblDepreciationCron?: CronGlobalState;
  };
  if (!g.__hrmskdblDepreciationCron) {
    g.__hrmskdblDepreciationCron = { task: null, tickRunning: false };
  }
  return g.__hrmskdblDepreciationCron;
}

function parseCronEnabled(raw: string | undefined): boolean {
  if (raw == null || raw.trim() === "") return false;
  const v = raw.trim().toLowerCase();
  return v === "true" || v === "1" || v === "yes";
}

function resolveSchedule(): string {
  const s = process.env.DEPRECIATION_CRON_SCHEDULE?.trim();
  return s && s.length > 0 ? s : DEFAULT_SCHEDULE;
}

async function runCronTick(): Promise<void> {
  const state = getGlobalState();
  if (state.tickRunning) {
    log.warn("depreciation cron tick skipped: previous tick still running");
    return;
  }
  state.tickRunning = true;
  log.info("depreciation cron tick started");
  try {
    await ensureCurrentFiscalYearAutomation();
    log.info("depreciation cron tick finished");
  } catch (err) {
    log.error("depreciation cron tick failed", err);
  } finally {
    state.tickRunning = false;
  }
}

/**
 * Starts the depreciation automation cron if enabled via env.
 * Safe to call on every server boot: stops any prior scheduled task stored on `globalThis`
 * (covers dev hot reload) before registering a single new task.
 */
export function startDepreciationCron(): void {
  const enabled = parseCronEnabled(process.env.DEPRECIATION_CRON_ENABLED);
  const state = getGlobalState();

  if (state.task) {
    state.task.stop();
    state.task = null;
    log.info("depreciation cron: stopped previous scheduled task (reload or re-init)");
  }

  if (!enabled) {
    log.info("depreciation cron disabled (set DEPRECIATION_CRON_ENABLED=true to enable)");
    return;
  }

  const schedule = resolveSchedule();
  if (!cron.validate(schedule)) {
    log.error("depreciation cron not started: invalid DEPRECIATION_CRON_SCHEDULE", undefined, {
      schedule,
    });
    return;
  }

  state.task = cron.schedule(schedule, () => {
    void runCronTick();
  });
  log.info("depreciation cron started", { schedule });
}
