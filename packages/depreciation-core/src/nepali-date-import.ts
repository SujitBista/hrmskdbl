import nepaliImport from "nepali-date-converter";

export type NepaliDateConstructor =
  typeof import("nepali-date-converter").default;

/**
 * Node ESM exposes `nepali-date-converter` as `{ dateConfigMap, default: NepaliDate }`;
 * bundlers often expose the class as the default directly. Resolve both.
 */
export const NepaliDateCtor: NepaliDateConstructor =
  typeof nepaliImport === "function"
    ? (nepaliImport as NepaliDateConstructor)
    : (nepaliImport as { default: NepaliDateConstructor }).default;

export type NepaliDate = InstanceType<NepaliDateConstructor>;
