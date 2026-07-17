/** Rejects unsafe depreciation env combinations at application startup. */
export function assertDepreciationProductionEnv(): void {
  if (process.env.NODE_ENV !== "production") {
    return;
  }
  const raw = process.env.DEPRECIATION_LEGACY_REGISTER_CARRY_FORWARD?.trim();
  if (raw == null || raw === "") {
    return;
  }
  const v = raw.toLowerCase();
  const enabled = v === "true" || v === "1" || v === "yes";
  if (enabled) {
    throw new Error(
      "DEPRECIATION_LEGACY_REGISTER_CARRY_FORWARD cannot be enabled in production. Post prior fiscal year FY_END runs instead."
    );
  }
}
