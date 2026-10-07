# ─────────────────────────────────────────────────────────────────────────────
# OpenSky → Fabric Eventstream — ingestion notebook
#
# Paste this into a Microsoft Fabric NOTEBOOK (Python). It pulls live aircraft
# from OpenSky and pushes them to your Eventstream's CUSTOM ENDPOINT, which then
# routes them to the Eventhouse `Flights` table (via the FlightsJson mapping).
#
# This is the in-Fabric alternative to running the Node `fabric-live-api-backend`
# locally — same data, same schema, no local machine required.
#
# HOW TO RUN
#   1. Fabric → your workspace → New → Notebook. Set language to PySpark/Python.
#   2. First cell:  %pip install azure-eventhub requests
#   3. Paste the rest below into a second cell, fill in the 4 CONFIG values, Run.
#   4. It ingests for RUN_MINUTES, then stops. Re-run (or schedule via a pipeline)
#      to keep going. Verify with:  LatestFlights() | count
# ─────────────────────────────────────────────────────────────────────────────

# %pip install azure-eventhub requests      # <-- run this in its own first cell

import json
import os
import re
import time
from datetime import datetime, timezone

import requests
from azure.eventhub import EventData, EventHubProducerClient

# ── CONFIG — fill these in ───────────────────────────────────────────────────
OPENSKY_CLIENT_ID = "prathameshsable-api-client"
OPENSKY_CLIENT_SECRET = "<paste your OpenSky secret (Reset Credential)>"
# Eventstream custom-endpoint connection string (source node → Keys tab).
# Must contain EntityPath=...
EVENTSTREAM_CONNECTION_STRING = "<paste from the custom endpoint Keys tab>"
# Bounding box: south, west, north, east (degrees).
#   Global  (-60, -180, 75, 180)  → ~4 credits/call  → use POLL_SECONDS >= 90
#   Region  (48, 2, 52, 8) ~24 sq°→  1 credit/call   → POLL_SECONDS 25 is fine
OPENSKY_BBOX = (-60, -180, 75, 180)   # whole world for the reference look

POLL_SECONDS = 90      # global ≈ 960 calls/day × 4 credits = 3,840 (under 4,000/day)
RUN_MINUTES = 120      # how long this notebook run keeps ingesting

# ── OpenSky endpoints ────────────────────────────────────────────────────────
TOKEN_URL = (
    "https://auth.opensky-network.org/auth/realms/opensky-network"
    "/protocol/openid-connect/token"
)
STATES_URL = "https://opensky-network.org/api/states/all"


def get_token(max_wait_s: int = 600) -> str:
    # Keep retrying through OpenSky auth outages (up to ~10 min) so the notebook
    # starts on its own once OpenSky is reachable again, instead of crashing.
    last = None
    waited = 0
    attempt = 0
    while waited < max_wait_s:
        attempt += 1
        try:
            r = requests.post(
                TOKEN_URL,
                data={
                    "grant_type": "client_credentials",
                    "client_id": OPENSKY_CLIENT_ID,
                    "client_secret": OPENSKY_CLIENT_SECRET,
                },
                timeout=30,
            )
            r.raise_for_status()
            return r.json()["access_token"]
        except requests.RequestException as ex:
            last = ex
            wait = min(30, 2 ** min(attempt, 5))
            print(f"token attempt {attempt} failed ({ex.__class__.__name__}); waited {waited}s; retry in {wait}s")
            time.sleep(wait)
            waited += wait
    raise last


def fetch_states(token):
    lamin, lomin, lamax, lomax = OPENSKY_BBOX
    # token=None → anonymous request (works when OpenSky's auth server is down,
    # just with lower rate limits → use a smaller bbox + slower poll).
    headers = {"Authorization": f"Bearer {token}"} if token else {}
    r = requests.get(
        STATES_URL,
        headers=headers,
        params={"lamin": lamin, "lomin": lomin, "lamax": lamax, "lomax": lomax},
        timeout=30,
    )
    r.raise_for_status()
    return r.json().get("states") or []


def to_flight(s):
    """Map an OpenSky state vector → the Flights table schema. None if no position."""
    lon, lat = s[5], s[6]
    if lon is None or lat is None:
        return None
    now = datetime.now(timezone.utc).isoformat()
    callsign = (s[1] or "").strip() or None
    return {
        "icao24": s[0],
        "callsign": callsign,
        "originCountry": s[2],
        "longitude": lon,
        "latitude": lat,
        "geoAltitude": s[13],
        "baroAltitude": s[7],
        "velocity": s[9],
        "heading": s[10],
        "verticalRate": s[11],
        "onGround": s[8],
        "lastContact": datetime.fromtimestamp(s[4], tz=timezone.utc).isoformat(),
        "ingestedAt": now,
        # Enriched by enrich() (null until adsbdb resolves them).
        "originLat": None, "originLon": None, "originIata": None,
        "destLat": None, "destLon": None, "destIata": None,
        "airline": None,            # operator, from the route lookup
        "manufacturer": None,       # Boeing / Airbus / … from the aircraft lookup
        "aircraftType": None,       # e.g. "Boeing 737-800"
    }


# ── Route enrichment (callsign → origin/destination airport) ──────────────────
# adsbdb.com is free, no key. We cache each callsign (including "unknown") so we
# only hit the API once per callsign, and cap new lookups per cycle to be polite.
# Cache persists for the notebook session; once a callsign is resolved it's free
# forever. Higher cap = routes fill in faster after a global switch (adsbdb is
# generous, but keep it reasonable).
ROUTE_CACHE: dict = {}
AIRCRAFT_CACHE: dict = {}
MAX_LOOKUPS_PER_CYCLE = 200

# ── Persistent cache ──────────────────────────────────────────────────────────
# In-memory caches reset every time you re-run the cell, which restarts the ~45min
# warm-up (that's why routes keep saying "pending"). Persisting them to a Lakehouse
# file means a restart RESUMES with full coverage. Attach a Lakehouse to this
# notebook (Explorer → Add → Lakehouse) so /lakehouse/default/Files exists.
# If no Lakehouse is attached, it silently falls back to in-memory.
CACHE_PATH = "/lakehouse/default/Files/skyfield_cache.json"


def load_cache():
    global ROUTE_CACHE, AIRCRAFT_CACHE
    try:
        with open(CACHE_PATH) as f:
            data = json.load(f)
        ROUTE_CACHE = data.get("routes", {})
        AIRCRAFT_CACHE = data.get("aircraft", {})
        print(f"loaded cache: {len(ROUTE_CACHE)} callsigns, {len(AIRCRAFT_CACHE)} airframes")
    except Exception as ex:
        print(f"no persisted cache ({ex.__class__.__name__}); starting fresh "
              f"(attach a Lakehouse to keep it across restarts)")


def save_cache():
    try:
        tmp = CACHE_PATH + ".tmp"
        with open(tmp, "w") as f:
            json.dump({"routes": ROUTE_CACHE, "aircraft": AIRCRAFT_CACHE}, f)
        os.replace(tmp, CACHE_PATH)
    except Exception:
        pass  # no Lakehouse / write failure → just keep the in-memory cache


def lookup_route(callsign):
    """callsign → {origin/destination airport + airline}. Cached, None if unknown."""
    if callsign in ROUTE_CACHE:
        return ROUTE_CACHE[callsign]
    route = None
    try:
        r = requests.get(f"https://api.adsbdb.com/v0/callsign/{callsign}", timeout=10)
        if r.status_code == 200:
            resp = r.json().get("response")
            fr = resp.get("flightroute") if isinstance(resp, dict) else None
            if fr:
                o, d = fr.get("origin") or {}, fr.get("destination") or {}
                if o.get("latitude") is not None and d.get("latitude") is not None:
                    route = {
                        "originLat": o.get("latitude"), "originLon": o.get("longitude"),
                        "originIata": o.get("iata_code"),
                        "destLat": d.get("latitude"), "destLon": d.get("longitude"),
                        "destIata": d.get("iata_code"),
                        "airline": (fr.get("airline") or {}).get("name"),
                    }
    except Exception:
        route = None
    ROUTE_CACHE[callsign] = route
    return route


def lookup_aircraft(icao24):
    """icao24 → {manufacturer, aircraftType}. Static per airframe, cached."""
    if icao24 in AIRCRAFT_CACHE:
        return AIRCRAFT_CACHE[icao24]
    ac = None
    try:
        r = requests.get(f"https://api.adsbdb.com/v0/aircraft/{icao24}", timeout=10)
        if r.status_code == 200:
            resp = r.json().get("response")
            a = resp.get("aircraft") if isinstance(resp, dict) else None
            if a and (a.get("manufacturer") or a.get("type")):
                ac = {"manufacturer": a.get("manufacturer"), "aircraftType": a.get("type")}
    except Exception:
        ac = None
    AIRCRAFT_CACHE[icao24] = ac
    return ac


# Airline callsigns look like "AAL2412" (3-letter ICAO airline + flight number)
# and almost always resolve a route. Registrations like "N535KT" are general
# aviation and rarely do — so we spend the lookup budget on airline flights first.
_AIRLINE = re.compile(r"^[A-Z]{3}\d")


def enrich(flights):
    """Add route+airline (by callsign) and manufacturer+type (by icao24)."""
    new_r = new_a = 0
    # Airline-format callsigns first; GA/odd ones only if budget remains.
    ordered = sorted(
        flights,
        key=lambda f: 0 if f.get("callsign") and _AIRLINE.match(f["callsign"]) else 1,
    )
    for f in ordered:
        cs = f.get("callsign")
        if cs:
            if cs in ROUTE_CACHE:
                route = ROUTE_CACHE[cs]
            elif new_r < MAX_LOOKUPS_PER_CYCLE:
                route = lookup_route(cs)
                new_r += 1
                time.sleep(0.03)
            else:
                route = None
            if route:
                f.update(route)

        icao = f.get("icao24")
        if icao:
            if icao in AIRCRAFT_CACHE:
                ac = AIRCRAFT_CACHE[icao]
            elif new_a < MAX_LOOKUPS_PER_CYCLE:
                ac = lookup_aircraft(icao)
                new_a += 1
                time.sleep(0.03)
            else:
                ac = None
            if ac:
                f.update(ac)


def send(producer, flights):
    batch = producer.create_batch()
    for f in flights:
        try:
            batch.add(EventData(json.dumps(f)))
        except ValueError:  # batch full → flush and start a new one
            producer.send_batch(batch)
            batch = producer.create_batch()
            batch.add(EventData(json.dumps(f)))
    if len(batch) > 0:
        producer.send_batch(batch)


producer = EventHubProducerClient.from_connection_string(EVENTSTREAM_CONNECTION_STRING)
load_cache()  # resume route/airframe coverage from a previous run (if a Lakehouse is attached)

# Try to authenticate; if OpenSky's auth server is down, fall back to anonymous.
try:
    token = get_token(max_wait_s=45)
except requests.RequestException:
    token = None
    print("⚠ OpenSky auth server unreachable — running ANONYMOUS (lower limits; "
          "prefer a small bbox + POLL_SECONDS≥30). Switch back to authed when it recovers.")

deadline = time.time() + RUN_MINUTES * 60
mode = "authenticated" if token else "ANONYMOUS"
print(f"Ingesting OpenSky → Eventstream for {RUN_MINUTES} min ({mode}, bbox={OPENSKY_BBOX})")

cycle = 0
try:
    while time.time() < deadline:
        try:
            states = fetch_states(token)
            flights = [f for f in (to_flight(s) for s in states) if f]
            if flights:
                enrich(flights)
                routed = sum(1 for f in flights if f["originLat"] is not None)
                typed = sum(1 for f in flights if f["manufacturer"] is not None)
                send(producer, flights)
                print(
                    f"{datetime.now():%H:%M:%S}  sent {len(flights)} flights "
                    f"({routed} routed, {typed} typed) | cache {len(ROUTE_CACHE)}cs/{len(AIRCRAFT_CACHE)}ac"
                )
            cycle += 1
            if cycle % 5 == 0:
                save_cache()  # persist coverage every ~5 cycles
        except requests.HTTPError as ex:
            code = ex.response.status_code if ex.response is not None else None
            if code == 401 and token is not None:
                try:
                    token = get_token(max_wait_s=45)  # expired → refresh
                except requests.RequestException:
                    token = None  # auth still down → keep going anonymously
            elif code == 429:
                print("rate limited (429); backing off 30s")
                time.sleep(30)
            else:
                print("HTTP error:", ex)
        except requests.RequestException as ex:
            # Timeout / connection error → don't crash the run; retry next cycle.
            print(f"network error ({ex.__class__.__name__}); retrying next cycle")
        time.sleep(POLL_SECONDS)
finally:
    save_cache()
    producer.close()
    print("done — producer closed")
