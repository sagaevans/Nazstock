"""Nazstock - update data harian (end of day).

Mengambil data OHLCV harian dari Yahoo Finance (yfinance) untuk semua saham
di scripts/universe_idx.csv dan scripts/universe_us.csv, lalu menulis:
  data/IDX.json, data/US.json, data/meta.json

Pemakaian:
  python scripts/update.py IDX
  python scripts/update.py US
  python scripts/update.py ALL
"""
import csv, json, os, sys, time, warnings
from collections import Counter
from datetime import datetime, timezone, timedelta

import yfinance as yf

warnings.filterwarnings("ignore")
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
BARS = 100          # jumlah candle harian yang disimpan
CHUNK = 150         # jumlah ticker per permintaan ke Yahoo
CFG = {
    "IDX": {"csv": "universe_idx.csv", "suffix": ".JK", "dec": 0},
    "US":  {"csv": "universe_us.csv",  "suffix": "",    "dec": 4},
}


def load_universe(market):
    with open(os.path.join(ROOT, "scripts", CFG[market]["csv"]), encoding="utf-8") as f:
        return [r for r in csv.DictReader(f) if r["kode"].strip()]


def download(symbols):
    for attempt in range(4):
        try:
            return yf.download(symbols, period="8mo", interval="1d", progress=False,
                               group_by="ticker", auto_adjust=False, threads=True)
        except Exception as e:  # Yahoo kadang membatasi akses; coba ulang
            print("  gagal, coba ulang:", e, flush=True)
            time.sleep(10 * (attempt + 1))
    return None


def rnd(x, dec):
    return int(round(x)) if dec == 0 else round(float(x), dec)


def run(market):
    cfg = CFG[market]
    uni = load_universe(market)
    raw = {}
    for k in range(0, len(uni), CHUNK):
        part = uni[k:k + CHUNK]
        syms = [r["kode"] + cfg["suffix"] for r in part]
        df = download(syms)
        if df is None:
            continue
        for r, s in zip(part, syms):
            try:
                d = df[s][["Open", "High", "Low", "Close", "Volume"]].dropna()
            except Exception:
                continue
            rows = {}
            for idx, v in d.iterrows():
                o, h, l, c, vol = (float(x) for x in v)
                if c <= 0 or h < l or vol < 0:      # buang data cacat
                    continue
                rows[str(idx.date())] = [rnd(o, cfg["dec"]), rnd(h, cfg["dec"]), rnd(l, cfg["dec"]), rnd(c, cfg["dec"]), int(vol)]
            if rows:
                raw[r["kode"]] = rows
        print(f"{market}: {min(k + CHUNK, len(uni))}/{len(uni)} diproses, {len(raw)} ada data", flush=True)
        time.sleep(2)

    if not raw:
        print("Tidak ada data, file lama dipertahankan.")
        return False

    cnt = Counter(d for rows in raw.values() for d in rows)
    top = max(cnt.values())
    dates = sorted(d for d, n in cnt.items() if n >= 0.3 * top)[-BARS:]
    last = dates[-1]
    out = []
    for r in uni:
        rows = raw.get(r["kode"])
        if not rows:
            continue
        bars = [rows.get(d) for d in dates]
        valid = sum(b is not None for b in bars)
        if valid < 60:
            continue
        lastd = max(rows)
        if (datetime.fromisoformat(last) - datetime.fromisoformat(lastd)).days > 14:
            continue   # kemungkinan disuspensi / delisting
        out.append([r["kode"], r["nama"], int(r["utama"]), int(r["lapis1"]), bars])

    now = datetime.now(timezone(timedelta(hours=7))).strftime("%Y-%m-%d %H:%M WIB")
    data = {"market": market, "asof": last, "updated": now, "dates": dates, "s": out}
    os.makedirs(os.path.join(ROOT, "data"), exist_ok=True)
    with open(os.path.join(ROOT, "data", f"{market}.json"), "w", encoding="utf-8") as f:
        json.dump(data, f, separators=(",", ":"), ensure_ascii=False)

    mp = os.path.join(ROOT, "data", "meta.json")
    meta = json.load(open(mp, encoding="utf-8")) if os.path.exists(mp) else {}
    meta[market] = {"asof": last, "updated": now, "stocks": len(out)}
    with open(mp, "w", encoding="utf-8") as f:
        json.dump(meta, f, indent=1, ensure_ascii=False)
    print(f"{market}: selesai, {len(out)} saham, data per {last}")
    return True


if __name__ == "__main__":
    arg = (sys.argv[1] if len(sys.argv) > 1 else "ALL").upper()
    markets = ["IDX", "US"] if arg == "ALL" else [arg]
    ok = [run(m) for m in markets]
    sys.exit(0 if any(ok) else 1)
