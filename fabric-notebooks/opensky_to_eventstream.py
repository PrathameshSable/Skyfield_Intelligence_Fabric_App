# Fabric notebook source

# METADATA ********************

# META {
# META   "kernel_info": {
# META     "name": "jupyter",
# META     "jupyter_kernel_name": "python3.11"
# META   },
# META   "dependencies": {
# META     "lakehouse": {
# META       "default_lakehouse": "c081d8a4-f4fa-4aca-abd5-707fc5ade545",
# META       "default_lakehouse_name": "MK_Lakehouse",
# META       "default_lakehouse_workspace_id": "69cb4790-1cc3-43cb-8904-1f115e71dfdd",
# META       "known_lakehouses": [
# META         {
# META           "id": "c081d8a4-f4fa-4aca-abd5-707fc5ade545"
# META         }
# META       ]
# META     }
# META   }
# META }

# MARKDOWN ********************

# # Skyfield - live flight feed (start / stop)
#
# Each sweep reads the aircraft over one region from **adsb.fi open data**, adds route and airline from adsbdb
# (cached in `MK_Lakehouse/Files/skyfield_cache.json`) and sends them to the **flights** Eventstream -> Eventhouse
# **Flight_api**, table `Flights`, which the Skyfield app reads through the `Flights` semantic model.
#
# **Start**: the app's Start button (or run this notebook). **Stop**: the app's Stop button cancels the run, and it stops
# by itself after `run_minutes`. The Eventstream connection is looked up at run time, so no secret is kept here.
#
# Why not OpenSky: its API times out from Fabric (checked 11 Nov 2026), though it still answers from a laptop.
# adsb.fi answers from Fabric, but only around a point (250 NM) and 1 call a second, so the feed covers one region.
# adsb.fi open data is for personal, non-commercial use and must be credited (https://adsb.fi).

# PARAMETERS CELL ********************

run_minutes = 30            # stop by itself after this long
region = "europe"           # europe | uk | india | us_east | gulf (see REGIONS)
poll_seconds = 20           # at least this long between the starts of two sweeps
enrich_seconds = 8          # time per sweep for new route lookups (cached routes cost nothing)
send_to_eventstream = True  # False = fetch and print, send nothing

# METADATA ********************

# META {
# META   "language": "python",
# META   "language_group": "jupyter_python"
# META }

# CELL ********************

import base64
import hashlib
import hmac
import json
import math
import os
import re
import subprocess
import time
import urllib.parse
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone

import requests

WORKSPACE_ID = "69cb4790-1cc3-43cb-8904-1f115e71dfdd"     # Fabric Apps Demos
EVENTSTREAM_ID = "20a4411f-d94c-4867-97a6-27280ff07f8f"   # flights
SOURCE_NAME = "flight_pipe"
FABRIC_API = "https://api.fabric.microsoft.com/v1"
ADSBFI = "https://opendata.adsb.fi/api/v3/lat/{lat:.3f}/lon/{lon:.3f}/dist/250"
CACHE_PATH = "/lakehouse/default/Files/skyfield_cache.json"

# south, west, north, east
REGIONS = {
    "europe": (36, -11, 60, 30),
    "uk": (49.5, -11, 59.5, 2.5),
    "india": (7, 68, 35, 97),
    "us_east": (25, -92, 47, -67),
    "gulf": (16, 39, 32, 60),
}

# Fabric puts `notebookutils` straight into the namespace (importing it fails); outside Fabric borrow `az login` tokens.
IN_FABRIC = "notebookutils" in globals()
_tokens = {}


def token(audience):
    if IN_FABRIC:
        return notebookutils.credentials.getToken(audience)
    tok, at = _tokens.get(audience, (None, 0))
    if not tok or time.time() - at > 1800:
        tok = subprocess.run("az account get-access-token --resource https://api.fabric.microsoft.com --query accessToken -o tsv",
                             shell=True, capture_output=True, text=True, check=True).stdout.strip()
        _tokens[audience] = (tok, time.time())
    return tok


def save_error(step):
    """Keep the traceback in MK_Lakehouse/Files/skyfield_feed_errors: runs started from the app show no cell output."""
    import traceback
    text = f"{step} failed at {datetime.now(timezone.utc).isoformat()}\n\n{traceback.format_exc()}"
    print(text)
    if IN_FABRIC:
        try:
            os.makedirs("/lakehouse/default/Files/skyfield_feed_errors", exist_ok=True)
            with open(f"/lakehouse/default/Files/skyfield_feed_errors/{datetime.now(timezone.utc):%Y%m%d_%H%M%S}.txt", "w") as fh:
                fh.write(text)
        except OSError:
            pass


if region not in REGIONS:
    raise ValueError(f"region must be one of {', '.join(REGIONS)}, not {region!r}")
print(f"In Fabric: {IN_FABRIC} | region: {region} | {run_minutes} min | "
      f"{'sending' if send_to_eventstream else 'dry run, sending nothing'}")

# METADATA ********************

# META {
# META   "language": "python",
# META   "language_group": "jupyter_python"
# META }

# MARKDOWN ********************

# ## 1. Aircraft from adsb.fi

# CELL ********************

def tiles(bbox, step_km=620):
    """Circle centres covering the box. 250 NM circles (463 km) on a 620 km grid leave no gaps."""
    s, w, n, e = bbox
    rows = max(1, math.ceil((n - s) / (step_km / 111.2)))
    out = []
    for i in range(rows):
        lat = s + (i + 0.5) * (n - s) / rows
        cols = max(1, math.ceil((e - w) / (step_km / (111.2 * max(0.2, math.cos(math.radians(lat)))))))
        out += [(lat, w + (j + 0.5) * (e - w) / cols) for j in range(cols)]
    return out


# ICAO 24-bit address blocks per state (ICAO Annex 10, Vol. III). adsb.fi gives no country, so it is read from the
# address, the way OpenSky did. The narrowest matching block wins.
ICAO_BLOCKS_TEXT = """
004000 0043FF Zimbabwe|006000 006FFF Mozambique|008000 00FFFF South Africa|010000 017FFF Egypt|018000 01FFFF Libya
020000 027FFF Morocco|028000 02FFFF Tunisia|030000 0303FF Botswana|032000 032FFF Burundi|034000 034FFF Cameroon
036000 036FFF Congo|038000 038FFF Cote d'Ivoire|03E000 03EFFF Gabon|040000 040FFF Ethiopia|042000 042FFF Equatorial Guinea
044000 044FFF Ghana|046000 046FFF Guinea|04C000 04CFFF Kenya|050000 050FFF Liberia|054000 054FFF Madagascar
058000 058FFF Malawi|05A000 05A3FF Maldives|05C000 05CFFF Mali|05E000 05E3FF Mauritania|060000 0603FF Mauritius
062000 062FFF Niger|064000 064FFF Nigeria|068000 068FFF Uganda|06A000 06A3FF Qatar|06E000 06EFFF Rwanda
070000 070FFF Senegal|074000 0743FF Seychelles|076000 0763FF Sierra Leone|078000 078FFF Somalia|07C000 07CFFF Sudan
080000 080FFF Tanzania|084000 084FFF Chad|088000 088FFF Togo|08A000 08AFFF Zambia|08C000 08CFFF DR Congo
090000 090FFF Angola|094000 0943FF Benin|096000 0963FF Cape Verde|098000 0983FF Djibouti|09C000 09CFFF Burkina Faso
0A0000 0A7FFF Algeria|0A8000 0A8FFF Bahamas|0AA000 0AA3FF Barbados|0AC000 0ACFFF Colombia|0AE000 0AEFFF Costa Rica
0B0000 0B0FFF Cuba|0B2000 0B2FFF El Salvador|0B4000 0B4FFF Guatemala|0B6000 0B6FFF Guyana|0B8000 0B8FFF Haiti
0BA000 0BAFFF Honduras|0BE000 0BEFFF Jamaica|0C0000 0C0FFF Nicaragua|0C2000 0C2FFF Panama|0C4000 0C4FFF Dominican Republic
0C6000 0C6FFF Trinidad and Tobago|0C8000 0C8FFF Suriname|0D0000 0D7FFF Mexico|0D8000 0DFFFF Venezuela
100000 1FFFFF Russia|201000 2013FF Namibia|202000 2023FF Eritrea|300000 33FFFF Italy|340000 37FFFF Spain
380000 3BFFFF France|3C0000 3FFFFF Germany|400000 43FFFF United Kingdom|440000 447FFF Austria|448000 44FFFF Belgium
450000 457FFF Bulgaria|458000 45FFFF Denmark|460000 467FFF Finland|468000 46FFFF Greece|470000 477FFF Hungary
478000 47FFFF Norway|480000 487FFF Netherlands|488000 48FFFF Poland|490000 497FFF Portugal|498000 49FFFF Czechia
4A0000 4A7FFF Romania|4A8000 4AFFFF Sweden|4B0000 4B7FFF Switzerland|4B8000 4BFFFF Turkey|4C0000 4C7FFF Serbia
4C8000 4C83FF Cyprus|4CA000 4CAFFF Ireland|4CC000 4CCFFF Iceland|4D0000 4D03FF Luxembourg|4D2000 4D23FF Malta
4D4000 4D43FF Monaco|500000 5003FF San Marino|501000 5013FF Albania|501C00 501FFF Croatia|502C00 502FFF Latvia
503C00 503FFF Lithuania|504C00 504FFF Moldova|505C00 505FFF Slovakia|506C00 506FFF Slovenia|507C00 507FFF Uzbekistan
508000 50FFFF Ukraine|510000 5103FF Belarus|511000 5113FF Estonia|512000 5123FF North Macedonia
513000 5133FF Bosnia and Herzegovina|514000 5143FF Georgia|515000 5153FF Tajikistan|516000 5163FF Montenegro
600000 6003FF Armenia|600800 600BFF Azerbaijan|601000 6013FF Kyrgyzstan|601800 601BFF Turkmenistan|680000 6803FF Bhutan
682000 6823FF Mongolia|683000 6833FF Kazakhstan|700000 700FFF Afghanistan|702000 702FFF Bangladesh|704000 704FFF Myanmar
706000 706FFF Kuwait|708000 708FFF Laos|70A000 70AFFF Nepal|70C000 70C3FF Oman|70E000 70EFFF Cambodia
710000 717FFF Saudi Arabia|718000 71FFFF South Korea|720000 727FFF North Korea|728000 72FFFF Iraq|730000 737FFF Iran
738000 73FFFF Israel|740000 747FFF Jordan|748000 74FFFF Lebanon|750000 757FFF Malaysia|758000 75FFFF Philippines
760000 767FFF Pakistan|768000 76FFFF Singapore|770000 777FFF Sri Lanka|778000 77FFFF Syria|780000 7BFFFF China
7C0000 7FFFFF Australia|800000 83FFFF India|840000 87FFFF Japan|880000 887FFF Thailand|888000 88FFFF Viet Nam
890000 890FFF Yemen|894000 894FFF Bahrain|895000 8953FF Brunei|896000 896FFF United Arab Emirates
898000 898FFF Papua New Guinea|899000 8993FF Taiwan|8A0000 8A7FFF Indonesia|A00000 AFFFFF United States
C00000 C3FFFF Canada|C80000 C87FFF New Zealand|C88000 C88FFF Fiji|E00000 E3FFFF Argentina|E40000 E7FFFF Brazil
E80000 E80FFF Chile|E84000 E84FFF Ecuador|E88000 E88FFF Paraguay|E8C000 E8CFFF Peru|E90000 E90FFF Uruguay
E94000 E94FFF Bolivia
"""
ICAO_BLOCKS = sorted(
    ((int(a, 16), int(b, 16), name) for a, b, name in
     (item.strip().split(" ", 2) for item in ICAO_BLOCKS_TEXT.replace("\n", "|").split("|") if item.strip())),
    key=lambda blk: blk[1] - blk[0])
_country_cache = {}


def country_of(hex_id):
    if hex_id not in _country_cache:
        try:
            v = int(hex_id, 16)
        except ValueError:
            v = -1
        _country_cache[hex_id] = next((name for lo, hi, name in ICAO_BLOCKS if lo <= v <= hi), "Unknown")
    return _country_cache[hex_id]


# Multi-word makers in adsb.fi's type description; any other maker is the first word.
MAKERS = [("DE HAVILLAND CANADA", "De Havilland Canada"), ("MCDONNELL DOUGLAS", "McDonnell Douglas"),
          ("BRITISH AEROSPACE", "BAE Systems"), ("ATR", "ATR"), ("BEECH", "Beechcraft")]


def aircraft_from_desc(desc):
    """'AIRBUS A-321neo' -> ('Airbus', 'Airbus A-321neo')."""
    if not desc:
        return None, None
    d = desc.strip()
    for prefix, name in MAKERS:
        if d.upper() == prefix or d.upper().startswith(prefix + " "):
            return name, (name + d[len(prefix):]).strip()
    first, _, rest = d.partition(" ")
    return first.title(), f"{first.title()} {rest}".strip()


session = requests.Session()
session.headers["User-Agent"] = "skyfield-fabric-demo"


def fetch_region(points):
    """Every aircraft with a fresh position in the region, one call per circle, at most one call a second."""
    seen, failed = {}, 0
    for lat, lon in points:
        t = time.time()
        try:
            r = session.get(ADSBFI.format(lat=lat, lon=lon), timeout=15)
            if r.status_code == 429:
                failed += 1
                time.sleep(5)
                continue
            r.raise_for_status()
            body = r.json()
            now_s = (body.get("now") or time.time() * 1000) / 1000
            for a in body.get("ac") or []:
                hx = a.get("hex") or ""
                age = a.get("seen_pos")
                # "~" = not a real ICAO address (TIS-B); drop positions older than a minute
                if hx.startswith("~") or a.get("lat") is None or (age is not None and age > 60):
                    continue
                a["_t"] = now_s - (a.get("seen") or 0)
                old = seen.get(hx)
                if old is None or (age or 0) < (old.get("seen_pos") or 0):
                    seen[hx] = a
        except (requests.RequestException, ValueError) as exc:
            failed += 1
            print(f"  circle {lat:.1f},{lon:.1f} failed: {exc.__class__.__name__}")
        time.sleep(max(0.0, 1.1 - (time.time() - t)))
    return list(seen.values()), failed


FT, KT, FPM = 0.3048, 0.514444, 0.00508   # feet -> m, knots -> m/s, ft/min -> m/s


def num(v):
    return v if isinstance(v, (int, float)) else None


def to_flight(a, ingested_iso):
    """adsb.fi aircraft -> a row of the Flights table (same columns and units OpenSky used)."""
    ground = a.get("alt_baro") == "ground"
    baro = None if ground or num(a.get("alt_baro")) is None else a["alt_baro"] * FT
    geom = None if ground or num(a.get("alt_geom")) is None else a["alt_geom"] * FT
    rate = num(a.get("geom_rate", a.get("baro_rate")))
    maker, model = aircraft_from_desc(a.get("desc"))
    return {
        "icao24": a["hex"],
        "callsign": (a.get("flight") or "").strip() or None,
        "originCountry": country_of(a["hex"]),
        "longitude": a["lon"],
        "latitude": a["lat"],
        "geoAltitude": geom if geom is not None else baro,
        "baroAltitude": baro,
        "velocity": a["gs"] * KT if num(a.get("gs")) is not None else None,
        "heading": num(a.get("track", a.get("true_heading"))),
        "verticalRate": rate * FPM if rate is not None else None,
        "onGround": ground,
        "lastContact": datetime.fromtimestamp(a["_t"], timezone.utc).isoformat(),
        "ingestedAt": ingested_iso,
        "originLat": None, "originLon": None, "originIata": None,
        "destLat": None, "destLon": None, "destIata": None,
        "airline": None,
        "manufacturer": maker,
        "aircraftType": model,
    }


points = tiles(REGIONS[region])
print(f"{region}: {len(points)} circles, about {len(points) * 1.1:.0f} s a sweep")

# METADATA ********************

# META {
# META   "language": "python",
# META   "language_group": "jupyter_python"
# META }

# MARKDOWN ********************

# ## 2. Routes and airlines (adsbdb, cached)

# CELL ********************

ROUTES, AIRCRAFT = {}, {}


def load_cache():
    global ROUTES, AIRCRAFT
    try:
        with open(CACHE_PATH) as fh:
            data = json.load(fh)
        ROUTES, AIRCRAFT = data.get("routes", {}), data.get("aircraft", {})
        print(f"cache: {len(ROUTES)} callsigns, {len(AIRCRAFT)} airframes")
    except (OSError, ValueError) as exc:
        print(f"no cache yet ({exc.__class__.__name__}), starting empty")


def save_cache():
    try:
        with open(CACHE_PATH + ".tmp", "w") as fh:
            json.dump({"routes": ROUTES, "aircraft": AIRCRAFT}, fh)
        os.replace(CACHE_PATH + ".tmp", CACHE_PATH)
    except OSError:
        pass  # no lakehouse (local run): keep the in-memory cache


def lookup_route(callsign):
    """callsign -> origin/destination airport and airline, or None. Unknown callsigns are cached too."""
    route = None
    try:
        r = requests.get(f"https://api.adsbdb.com/v0/callsign/{callsign}", timeout=10)
        if r.status_code == 200:
            resp = r.json().get("response")
            fr = resp.get("flightroute") if isinstance(resp, dict) else None
            if fr:
                o, d = fr.get("origin") or {}, fr.get("destination") or {}
                if o.get("latitude") is not None and d.get("latitude") is not None:
                    route = {"originLat": o["latitude"], "originLon": o.get("longitude"), "originIata": o.get("iata_code"),
                             "destLat": d["latitude"], "destLon": d.get("longitude"), "destIata": d.get("iata_code"),
                             "airline": (fr.get("airline") or {}).get("name")}
        elif r.status_code != 404:
            return  # rate limited or down: try again in a later sweep
    except (requests.RequestException, ValueError):
        return
    ROUTES[callsign] = route


AIRLINE_CALLSIGN = re.compile(r"^[A-Z]{3}\d")   # "AAL2412"; registrations like "N535KT" rarely have a route


def enrich(flights):
    """Fill routes from the cache, and the aircraft type from adsbdb's cache where adsb.fi has none."""
    for f in flights:
        route = ROUTES.get(f["callsign"]) if f["callsign"] else None
        if route:
            f.update(route)
        if f["manufacturer"] is None and AIRCRAFT.get(f["icao24"]):
            f.update(AIRCRAFT[f["icao24"]])


def learn_routes(flights, seconds):
    """Look up callsigns never seen before, airline ones first, for at most `seconds`. They show from the next sweep."""
    todo = sorted({f["callsign"] for f in flights if f["callsign"] and f["callsign"] not in ROUTES},
                  key=lambda cs: 0 if AIRLINE_CALLSIGN.match(cs) else 1)
    deadline, done = time.time() + seconds, 0
    with ThreadPoolExecutor(max_workers=4) as pool:
        for i in range(0, len(todo), 4):
            if time.time() > deadline:
                break
            list(pool.map(lookup_route, todo[i:i + 4]))
            done += len(todo[i:i + 4])
    return done


load_cache()

# METADATA ********************

# META {
# META   "language": "python",
# META   "language_group": "jupyter_python"
# META }

# MARKDOWN ********************

# ## 3. Send to the Eventstream

# CELL ********************

def endpoint_connection():
    """Event Hubs details of the custom endpoint, fetched at run time (the key is never printed or stored)."""
    h = {"Authorization": f"Bearer {token('pbi')}"}
    topo = requests.get(f"{FABRIC_API}/workspaces/{WORKSPACE_ID}/eventstreams/{EVENTSTREAM_ID}/topology", headers=h, timeout=30)
    topo.raise_for_status()
    source = next(s for s in topo.json()["sources"] if s["name"] == SOURCE_NAME)
    conn = requests.get(f"{FABRIC_API}/workspaces/{WORKSPACE_ID}/eventstreams/{EVENTSTREAM_ID}/sources/{source['id']}/connection",
                        headers=h, timeout=30)
    conn.raise_for_status()
    body = conn.json()
    parts = dict(p.split("=", 1) for p in body["accessKeys"]["primaryConnectionString"].split(";") if "=" in p)
    entity = parts.get("EntityPath") or body["eventHubName"]
    return parts["Endpoint"].replace("sb://", "https://").rstrip("/") + "/" + entity, parts["SharedAccessKeyName"], parts["SharedAccessKey"]


HUB_URI, KEY_NAME, KEY = endpoint_connection() if send_to_eventstream else (None, None, None)


def sas(ttl=3600):
    expiry = str(int(time.time()) + ttl)
    resource = urllib.parse.quote_plus(HUB_URI)
    sig = base64.b64encode(hmac.new(KEY.encode(), f"{resource}\n{expiry}".encode(), hashlib.sha256).digest()).decode()
    return f"SharedAccessSignature sr={resource}&sig={urllib.parse.quote_plus(sig)}&se={expiry}&skn={KEY_NAME}"


def post_batch(batch):
    payload = json.dumps([{"Body": json.dumps(e, separators=(",", ":"))} for e in batch])
    for attempt in range(5):
        r = requests.post(f"{HUB_URI}/messages?timeout=60&api-version=2014-01", data=payload, timeout=60,
                          headers={"Authorization": sas(), "Content-Type": "application/vnd.microsoft.servicebus.json"})
        if r.status_code in (200, 201):
            return
        time.sleep(2 ** attempt)
    raise RuntimeError(f"send failed: HTTP {r.status_code} {r.text[:200]}")


def send(events, batch_size=250):
    if not send_to_eventstream or not events:
        return
    with ThreadPoolExecutor(max_workers=8) as pool:
        list(pool.map(post_batch, [events[i:i + batch_size] for i in range(0, len(events), batch_size)]))


print("Eventstream endpoint ready" if send_to_eventstream else "Dry run: nothing will be sent")

# METADATA ********************

# META {
# META   "language": "python",
# META   "language_group": "jupyter_python"
# META }

# MARKDOWN ********************

# ## 4. Run

# CELL ********************

ends_at = time.time() + run_minutes * 60
sweeps, errors_in_row, reason, last = 0, 0, "time_up", []
print(f"Feeding {region} until {datetime.fromtimestamp(ends_at, timezone.utc):%H:%M} UTC")
while time.time() < ends_at:
    t0 = time.time()
    try:
        raw, failed = fetch_region(points)
        ingested = datetime.now(timezone.utc).isoformat()
        last = [to_flight(a, ingested) for a in raw]
        enrich(last)
        send(last)
        sent_s = time.time() - t0
        learned = learn_routes(last, enrich_seconds)
        sweeps += 1
        if sweeps % 5 == 0:
            save_cache()
        errors_in_row = 0 if last else errors_in_row + 1
        print(f"{datetime.now(timezone.utc):%H:%M:%S} sweep {sweeps}: {len(last)} aircraft "
              f"({sum(f['originLat'] is not None for f in last)} with a route), {failed}/{len(points)} circles failed, "
              f"sent after {sent_s:.0f} s, {learned} new callsigns looked up")
    except Exception:
        errors_in_row += 1
        save_error(f"Sweep {sweeps + 1}")
    if errors_in_row >= 5:
        reason = "stopped after 5 empty or failed sweeps in a row"
        break
    time.sleep(max(0.0, min(t0 + poll_seconds, ends_at) - time.time()))

save_cache()
summary = {"region": region, "sweeps": sweeps, "aircraft": len(last), "reason": reason}
print(json.dumps(summary))

# METADATA ********************

# META {
# META   "language": "python",
# META   "language_group": "jupyter_python"
# META }

# CELL ********************

if IN_FABRIC:
    notebookutils.notebook.exit(json.dumps(summary))

# METADATA ********************

# META {
# META   "language": "python",
# META   "language_group": "jupyter_python"
# META }
