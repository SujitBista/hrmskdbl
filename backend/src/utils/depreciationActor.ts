import type { AdminJwtPayload } from "../auth/jwt.js";
import type { DepreciationRunActor } from "../services/depreciationRuns.js";

/** Maps an authenticated admin JWT payload to a depreciation audit actor. */
export function depreciationActorFromAdmin(
  payload: AdminJwtPayload
): DepreciationRunActor {
  return {
    adminId: payload.sub,
    adminEmail: payload.email,
    isSuperAdmin: false,
  };
}
