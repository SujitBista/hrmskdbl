/** Row shape from GET /api/admin/assets (list). */
export type AssetRegisterRow = {
  id: number;
  group_id: number;
  sub_group_id: number | null;
  branch_id: number;
  asset_code: string | null;
  asset_name: string;
  group_name: string;
  group_code: string;
  group_dep_method: string | null;
  group_dep_rate: string | null;
  sub_group_name: string | null;
  branch_code: string;
  branch_name: string;
  ownership_type: string;
  working_status: string;
  department_id: number | null;
  department_name: string | null;
  purchase_date_bs: string;
  depreciation_start_date_bs: string;
  purchase_qty: string | null;
  unit_rate: string | null;
  /** When set and positive, depreciation runs use this carrying amount as cost basis (overrides qty × rate and old book value). */
  book_value?: string | null;
  /** Legacy override; runs prefer `book_value` then qty × unit rate when those are set. */
  old_book_value: string | null;
  purchase_invoice_no: string | null;
  created_at: string;
};
