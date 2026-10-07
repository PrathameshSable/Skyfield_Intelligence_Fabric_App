/**
 * Live aircraft query against the flight semantic model (DirectQuery / Direct
 * Lake over the Eventhouse `Flights` table). `Flights` is append-only, so we
 * pull the most-recent rows; the app keeps the latest one per aircraft and maps
 * columns BY NAME (see fabricProvider.ts).
 *
 * We return the whole row (not SELECTCOLUMNS) so the query is resilient to
 * schema changes — add columns like airline / manufacturer / aircraftType to the
 * table and they flow through automatically with no query edit.
 */
export const LIVE_FLIGHTS_DAX = `
EVALUATE
TOPN ( 6000, Flights, Flights[ingestedAt], DESC )
ORDER BY Flights[ingestedAt] DESC
`.trim();
