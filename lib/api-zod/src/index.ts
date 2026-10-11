export * from "./generated/api";
export * from "./generated/types";
export * from "./extractTransactionSchemas";
// The office CR lookup has both a path and a query parameter, so orval emits a
// zod schema (path params) and a TS type (query params) under the same name.
// Export the schema explicitly; the query type is the same shape as the
// customer lookup's LookupCommercialRegisterParams.
export { LookupOfficeCommercialRegisterParams } from "./generated/api";
