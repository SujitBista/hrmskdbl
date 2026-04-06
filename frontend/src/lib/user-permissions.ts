export type UserPermissions = {
  perm_view: boolean;
  perm_edit: boolean;
  perm_delete: boolean;
};

const defaultPermissions: UserPermissions = {
  perm_view: true,
  perm_edit: false,
  perm_delete: false,
};

/** View is implied if edit or delete is granted (matches backend). */
export function normalizePermissionsInput(
  p: Partial<UserPermissions> | undefined
): UserPermissions {
  const base = { ...defaultPermissions, ...p };
  const edit = Boolean(base.perm_edit);
  const del = Boolean(base.perm_delete);
  const view = Boolean(base.perm_view) || edit || del;
  return { perm_view: view, perm_edit: edit, perm_delete: del };
}

export function getDefaultPermissions(): UserPermissions {
  return { ...defaultPermissions };
}
