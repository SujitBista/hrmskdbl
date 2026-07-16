declare module "nepali-datepicker-reactjs" {
  import type { ComponentPropsWithoutRef, JSX } from "react";

  export type NepaliDatePickerLocale = "en" | "ne";
  export type NepaliDatePickerValue = string;

  export type NepaliDatePickerDate = {
    year: number;
    month: number;
    day: number;
  };

  export type NepaliDatePickerOptions = {
    closeOnSelect?: boolean;
    calenderLocale?: NepaliDatePickerLocale;
    valueLocale?: NepaliDatePickerLocale;
  };

  export type NepaliDatePickerProps = Omit<
    ComponentPropsWithoutRef<"div">,
    "onChange" | "onSelect"
  > & {
    inputClassName?: string;
    value?: NepaliDatePickerValue;
    onChange?: (value: NepaliDatePickerValue) => void;
    onSelect?: (value: NepaliDatePickerValue) => void;
    options?: NepaliDatePickerOptions;
    todayIfEmpty?: boolean;
    minYear?: number;
    maxYear?: number;
  };

  export function NepaliDatePicker(
    props: NepaliDatePickerProps
  ): JSX.Element;
}
