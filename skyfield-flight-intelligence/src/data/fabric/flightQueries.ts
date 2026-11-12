/**
 * Live aircraft query against the flight semantic model (DirectQuery / Direct
 * Lake over the Eventhouse `Flights` table). `Flights` is append-only, so we
 * pull the most-recent rows; the app keeps the latest one per aircraft and maps
 * columns BY NAME (see fabricProvider.ts).
 *
 * We return the whole row (not SELECTCOLUMNS) so the query is resilient to
 * schema changes — add columns like airline / manufacturer / aircraftType to the
 * table and they flow through automatically with no query edit.
 *
 * Only rows from the last 10 minutes count: the table's 15-min retention purge
 * lags by an hour or more, so without the filter a stopped feed leaves old
 * aircraft on the globe. UTCNOW() is the server's clock, not the viewer's.
 */
export const LIVE_WINDOW_MINUTES = 10;

export const LIVE_FLIGHTS_DAX = `
EVALUATE
TOPN (
    6000,
    FILTER ( Flights, Flights[ingestedAt] >= UTCNOW () - ${LIVE_WINDOW_MINUTES} / 1440 ),
    Flights[ingestedAt], DESC
)
ORDER BY Flights[ingestedAt] DESC
`.trim();
