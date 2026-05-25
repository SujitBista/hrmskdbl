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
  asset_status: "ACTIVE" | "DISPOSED";
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
  allocation_remarks: string;
  allocation_category_name: string;
  allocation_branch_name: string;
  allocation_emp_name: string;
  allocation_serial_number: string | null;
  disposal_date_bs: string | null;
  disposal_type: string | null;
  disposal_amount: string | null;
  net_book_value_at_disposal: string | null;
  profit_amount: string | null;
  loss_amount: string | null;
};

export type AssetDisposal = {
  id: number;
  asset_id: number;
  asset_code: string | null;
  asset_name: string;
  disposal_date_bs: string;
  disposal_type: string;
  disposal_amount: string;
  net_book_value_at_disposal: string;
  accumulated_depreciation_at_disposal: string;
  profit_amount: string;
  loss_amount: string;
  reference_no: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
};
