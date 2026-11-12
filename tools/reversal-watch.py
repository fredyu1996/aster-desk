#!/usr/bin/env python3
"""Aster Desk — Reversal Watch, one cloud run (stdlib only).

Usage:  python3 reversal_watch.py PREV_WATCH_JSON|- OUT_WATCH_JSON
Reads the previous run's watch file (or "-" for none), pulls Aster's public
futures API, tags the top-5 small-cap gainers/losers, follows every tracked
coin for 24h with the same 8 reversal checks as the desk, and writes a new
watch file: {updated, summary, coins[], checks[], events[], state{}}.
Prints a short plain-text report of trend changes for the run summary.
Exit code 3 = Aster API unreachable.
"""
import calendar, json, sys, time, urllib.request

API = 'https://fapi.asterdex.com'
MIN_VOL = 100_000
TOPN = 5
UA = {'User-Agent': 'aster-desk-reversal-watch/1.0'}


def get(path):
    req = urllib.request.Request(API + path, headers=UA)
    with urllib.request.urlopen(req, timeout=25) as r:
        return json.loads(r.read().decode())


def fin(v):
    return isinstance(v, (int, float)) and v == v and abs(v) != float('inf')


def fpx(v):
    if not fin(v): return '—'
    a = abs(v)
    if a >= 1000: return f'{v:.1f}'
    if a >= 10: return f'{v:.2f}'
    if a >= 1: return f'{v:.4f}'
    if a >= 0.01: return f'{v:.5f}'
    return f'{v:.4g}'


def fpct(v, d=1):
    return '—' if not fin(v) else f'{v:+.{d}f}%'


def fusd(v, sign=False):
    if not fin(v): return '—'
    s = '-' if v < 0 else ('+' if sign and v > 0 else '')
    a = abs(v)
    if a >= 1e9: t = f'{a/1e9:.2f}B'
    elif a >= 1e6: t = f'{a/1e6:.2f}M'
    elif a >= 1e3: t = f'{a/1e3:.0f}K' if a >= 1e5 else f'{a/1e3:.1f}K'
    else: t = f'{a:.0f}'
    return f'{s}${t}'


def ffund(r):
    return '—' if not fin(r) else f'{r*100:+.4f}%'


TAGS = {
    'breakout': 'Fresh breakout', 'run': 'Momentum run', 'bounce': 'Crash bounce', 'squeeze': 'Short squeeze',
    'hot': 'Overheated', 'crowdS': 'Shorts crowded', 'trapped': 'Trapped longs', 'postpump': 'Fading after pump',
    'capit': 'Capitulation', 'bleed': 'Thin bleed', 'down': 'Downtrend',
}
STATES = {
    'up': (0, 'Still rising'), 'dn': (0, 'Still falling'),
    'stallG': (1, 'Losing steam'), 'stallL': (1, 'Losing steam'),
    'revG': (2, 'Reversal forming ↓'), 'revL': (2, 'Reversal forming ↑'),
    'doneG': (3, 'Reversed down'), 'doneL': (3, 'Reversed up'),
}


def bars(k):  # [t, o, h, l, c, quoteVol, takerBuyQuoteVol]
    return [[int(b[0]), float(b[1]), float(b[2]), float(b[3]), float(b[4]), float(b[7]), float(b[10])] for b in k]


def rsi_tail(cl, n=14):
    if len(cl) < n + 2: return []
    g = l = 0.0
    for i in range(1, n + 1):
        d = cl[i] - cl[i - 1]
        if d > 0: g += d
        else: l -= d
    g /= n; l /= n
    out = []
    for i in range(n + 1, len(cl)):
        d = cl[i] - cl[i - 1]
        g = (g * (n - 1) + max(d, 0)) / n
        l = (l * (n - 1) + max(-d, 0)) / n
        out.append(100.0 if l == 0 else 100 - 100 / (1 + g / l))
    return out[-8:]


def ema(a, p):
    k = 2 / (p + 1); e = sum(a[:p]) / min(p, len(a)); out = []
    for i, v in enumerate(a):
        if i >= p: e = v * k + e * (1 - k)
        out.append(e)
    return out


def h1_stats(B, live):
    if len(B) < 30: return None
    d24, p24 = B[-24:], B[-48:-24]
    vol24 = sum(b[5] for b in d24); volp = sum(b[5] for b in p24) or 1
    net24 = 2 * sum(b[6] for b in d24) - vol24
    hi24 = max(b[2] for b in d24); lo24 = min(b[3] for b in d24)
    W = B[:max(1, len(B) - 12)]
    rmax, rmin, dd, dd_low, ru = -1e300, 1e300, 0.0, None, 0.0
    for b in W:
        rmax = max(rmax, b[2]); d = b[3] / rmax - 1
        if d < dd: dd, dd_low = d, b[3]
        rmin = min(rmin, b[3]); u = b[2] / rmin - 1
        if u > ru: ru = u
    upw = max((b[2] - max(b[1], b[4])) / b[4] for b in d24)
    low = max((min(b[1], b[4]) - b[3]) / b[4] for b in d24)
    cl = [b[4] for b in B]; cl[-1] = live
    return dict(vol24=vol24, volX=vol24 / volp, net24=net24, netShare=net24 / (vol24 or 1), hi24=hi24, lo24=lo24,
                fromHi=live / hi24 - 1, fromLo=live / lo24 - 1, rangePos=(live - lo24) / ((hi24 - lo24) or 1),
                dd=dd, ddUp=(live / dd_low - 1) if dd_low else 0.0, ru=ru, upW=upw, loW=low, rsi=rsi_tail(cl))


def tag_for(side, h, f4):
    if not h: return None
    if side == 'G':
        if (fin(f4) and f4 >= 0.0008) or (h['upW'] >= 0.15 and h['fromHi'] <= -0.15 and h['net24'] < 0): return 'hot'
        if fin(f4) and f4 <= -0.0003: return 'squeeze'
        if h['dd'] <= -0.25 and h['ddUp'] >= 0.2: return 'bounce'
        if h['volX'] >= 2.5 and h['net24'] > 0 and h['fromHi'] > -0.12: return 'breakout'
        return 'run'
    if fin(f4) and f4 <= -0.0003: return 'crowdS'
    if fin(f4) and f4 >= 0.0003: return 'trapped'
    if h['ru'] >= 0.3 and h['volX'] <= 0.6: return 'postpump'
    if h['volX'] >= 2.5 and h['net24'] < 0 and h['rangePos'] < 0.2: return 'capit'
    if h['vol24'] < 250e3 and abs(h['netShare']) < 0.15: return 'bleed'
    return 'down'


def regime(oi_hist):
    """OI change between runs (oldest point ≥20 min back, ≤90 min) paired with price change."""
    if not oi_hist or len(oi_hist) < 2: return None
    cur = oi_hist[-1]; ref = None
    for p in reversed(oi_hist[:-1]):
        if cur[0] - p[0] >= 20 * 60:
            ref = p; break
    if not ref or cur[0] - ref[0] > 90 * 60 or not ref[1] or not ref[2]: return None
    oi = (cur[1] / ref[1] - 1) * 100; px = (cur[2] / ref[2] - 1) * 100; mins = round((cur[0] - ref[0]) / 60)
    if abs(oi) < 1.0: k, lab = 'flat', 'OI flat'
    elif px >= 0 and oi > 0: k, lab = 'upup', 'New longs entering'
    elif px >= 0 and oi < 0: k, lab = 'updn', 'Short covering'
    elif px < 0 and oi > 0: k, lab = 'dnup', 'New shorts pressing'
    else: k, lab = 'dndn', 'Longs exiting'
    return dict(k=k, label=lab, oi=oi, px=px, mins=mins)


def trend_read(side, B, live, f4, rg, h):
    n = len(B)
    if n < 24: return None
    hi_of = lambda a: max(b[2] for b in a)
    lo_of = lambda a: min(b[3] for b in a)
    c3, prev, w6 = B[n - 4:], B[n - 12:n - 4], B[n - 24:]
    pk = max(range(len(w6)), key=lambda i: (w6[i][2], -i))
    tr = min(range(len(w6)), key=lambda i: (w6[i][3], i))
    LH = hi_of(c3) < hi_of(prev) * 0.99 and pk < len(w6) - 4
    HL = lo_of(c3) > lo_of(prev) * 1.01 and tr < len(w6) - 4
    cl = [b[4] for b in B]; cl[-1] = live
    E = ema(cl, 20)[-1]; above = live > E
    net = lambda a: sum(2 * b[6] - b[5] for b in a)
    n1, nprev = net(c3), net(B[n - 16:n - 4])
    q = sum(b[5] for b in c3); tb = sum(b[6] for b in c3); bs = tb / (q - tb) if q - tb > 0 else None
    upw = max((b[2] - max(b[1], b[4])) / b[4] for b in B[n - 12:])
    low = max((min(b[1], b[4]) - b[3]) / b[4] for b in B[n - 12:])
    R = h['rsi'] if h else []
    rnow = R[-1] if R else None; rmax = max(R) if R else None; rmin = min(R) if R else None
    from_hi = live / hi_of(B) - 1; from_lo = live / lo_of(B) - 1
    P = lambda ok, label, d: dict(ok=ok, label=label, d=d)
    if side == 'G':
        checks = [
            P(LH, 'Lower high on 15m', f'last 1h high {fpx(hi_of(c3))} vs {fpx(hi_of(prev))}'),
            P(not above, 'Below 15m EMA20', f'EMA {fpx(E)}'),
            P(n1 < 0, 'Net flow negative last 1h', f'{fusd(n1, True)} (prior 3h {fusd(nprev, True)})'),
            P(None if bs is None else bs < 0.9, 'Sellers more aggressive (B/S < 0.9)', '—' if bs is None else f'{bs:.2f}×'),
            P(upw >= 0.05, 'Rejection wick ≥ 5% (last 3h)', f'{upw*100:.1f}% upper wick'),
            P(None if not fin(f4) else f4 >= 0.0005, 'Longs crowded (funding ≥ 0.05%/4h)', '—' if not fin(f4) else ffund(f4) + '/4h'),
            P(None if not rg else rg['k'] in ('updn', 'dnup', 'dndn'), 'OI not backing the rally', f"{rg['label']} (OI {fpct(rg['oi'])} in {rg['mins']}m)" if rg else 'needs 2 runs of OI'),
            P(None if rmax is None else (rmax >= 70 and rnow <= rmax - 8), 'RSI 1h rolling over from > 70', '—' if rnow is None else f'{rnow:.0f} (peak {rmax:.0f})'),
        ]
    else:
        checks = [
            P(HL, 'Higher low on 15m', f'last 1h low {fpx(lo_of(c3))} vs {fpx(lo_of(prev))}'),
            P(above, 'Back above 15m EMA20', f'EMA {fpx(E)}'),
            P(n1 > 0, 'Net flow positive last 1h', f'{fusd(n1, True)} (prior 3h {fusd(nprev, True)})'),
            P(None if bs is None else bs > 1.1, 'Buyers more aggressive (B/S > 1.1)', '—' if bs is None else f'{bs:.2f}×'),
            P(low >= 0.05, 'Lows rejected: wick ≥ 5% (last 3h)', f'{low*100:.1f}% lower wick'),
            P(None if not fin(f4) else f4 <= -0.0003, 'Shorts crowded (funding ≤ −0.03%/4h)', '—' if not fin(f4) else ffund(f4) + '/4h'),
            P(None if not rg else rg['k'] in ('updn', 'upup', 'dndn'), 'OI shows covering or a flush', f"{rg['label']} (OI {fpct(rg['oi'])} in {rg['mins']}m)" if rg else 'needs 2 runs of OI'),
            P(None if rmin is None else (rmin <= 30 and rnow >= rmin + 8), 'RSI 1h turning up from < 30', '—' if rnow is None else f'{rnow:.0f} (low {rmin:.0f})'),
        ]
    score = sum(1 for c in checks if c['ok'] is True)
    known = sum(1 for c in checks if c['ok'] is not None)
    if side == 'G':
        key = 'doneG' if score >= 5 and from_hi <= -0.08 and not above else 'revG' if score >= 5 else 'stallG' if score >= 3 else 'up'
    else:
        key = 'doneL' if score >= 5 and from_lo >= 0.08 and above else 'revL' if score >= 5 else 'stallL' if score >= 3 else 'dn'
    return dict(key=key, code=STATES[key][0], label=STATES[key][1], score=score, known=known, checks=checks,
                fromHi=from_hi, fromLo=from_lo)


def iso(ts):
    return time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime(ts))


def main():
    prev_path, out_path = sys.argv[1], sys.argv[2]
    prev = {}
    if prev_path != '-':
        try:
            with open(prev_path) as f: prev = json.load(f)
        except Exception:
            prev = {}
    state = prev.get('state') or {}
    trk = state.get('trk') or {}
    events = list(reversed(prev.get('events') or []))  # stored newest-first; work oldest-first
    now = time.time()

    try:
        ex = get('/fapi/v1/exchangeInfo')
    except Exception as e:
        print(f'Could not reach the Aster API ({e.__class__.__name__}: {e}). Nothing updated.')
        sys.exit(3)
    meta = {}
    for s in ex['symbols']:
        if s.get('status') != 'TRADING' or s.get('contractType') != 'PERPETUAL' or s.get('quoteAsset') != 'USDT': continue
        sub = s.get('underlyingSubType') or []
        meta[s['symbol']] = dict(base=s['baseAsset'], stock=s.get('symbolType') == 1 or 'STOCK' in sub, top='Top' in sub)
    fint = {}
    try:
        for x in get('/fapi/v1/fundingInfo'): fint[x['symbol']] = float(x.get('fundingIntervalHours') or 8)
    except Exception:
        pass
    tk = {t['symbol']: t for t in get('/fapi/v1/ticker/24hr') if t['symbol'] in meta}
    fund = {}
    for p in get('/fapi/v1/premiumIndex'):
        try: fund[p['symbol']] = float(p['lastFundingRate'])
        except Exception: pass
    el = [s for s, t in tk.items() if not meta[s]['stock'] and not meta[s]['top'] and float(t['quoteVolume']) >= MIN_VOL]
    el.sort(key=lambda s: float(tk[s]['priceChangePercent']), reverse=True)
    g5, l5 = el[:TOPN], list(reversed(el[-TOPN:]))

    new_entries = []
    for side, lst in (('G', g5), ('L', l5)):
        for i, s in enumerate(lst):
            e = trk.get(s)
            px = float(tk[s]['lastPrice'])
            if not e or e.get('side') != side:
                e = trk[s] = dict(side=side, t0=now, px0=px, pct0=float(tk[s]['priceChangePercent']), st=None, tag=None, oi=[], hi=px, lo=px)
                new_entries.append(s)
            e['lastTop'] = now; e['rank'] = i + 1; e['best'] = min(e.get('best') or 9, i + 1)
    for s in list(trk):
        if s not in g5 and s not in l5: trk[s]['rank'] = None
        if now - trk[s].get('lastTop', 0) > 24 * 3600 or s not in meta or s not in tk:
            del trk[s]

    coins, checks_rows, changes = [], [], []
    for s, e in trk.items():
        side = e['side']; t = tk[s]; live = float(t['lastPrice']); pct = float(t['priceChangePercent'])
        try:
            k15 = bars(get(f'/fapi/v1/klines?symbol={s}&interval=15m&limit=96'))
            k1h = bars(get(f'/fapi/v1/klines?symbol={s}&interval=1h&limit=72'))
            oi = float(get(f'/fapi/v1/openInterest?symbol={s}')['openInterest'])
        except Exception:
            continue
        e['oi'] = [p for p in (e.get('oi') or []) if now - p[0] < 3 * 3600][-8:] + [[now, oi, live]]
        r = fund.get(s); f4 = r * 4 / fint.get(s, 8) if fin(r) else None
        h = h1_stats(k1h, live)
        tag = tag_for(side, h, f4)
        rg = regime(e['oi'])
        tr = trend_read(side, k15, live, f4, rg, h)
        if not tr: continue
        e['hi'] = max(e.get('hi') or live, live); e['lo'] = min(e.get('lo') or live, live)
        if tag and e.get('tag') and e['tag'] != tag:
            events.append(dict(time=iso(now), coin=meta[s]['base'], side='Gainer' if side == 'G' else 'Loser', kind='Pattern',
                               change=f"{TAGS[e['tag']]} → {TAGS[tag]}", signs=tr['score'], price=fpx(live), why=''))
        e['tag'] = tag
        if e.get('st') and e['st'] != tr['key']:
            why = ', '.join(c['label'].split(' (')[0].lower() for c in tr['checks'] if c['ok'])
            frm = STATES[e['st']][1]
            events.append(dict(time=iso(now), coin=meta[s]['base'], side='Gainer' if side == 'G' else 'Loser', kind='Trend',
                               change=f"{frm} → {tr['label']}", signs=tr['score'], price=fpx(live), why=why))
            changes.append((tr['code'], f"{meta[s]['base']} ({'gainer' if side == 'G' else 'loser'}): {frm} → {tr['label']} — {tr['score']}/8 signs"
                                         + (f" ({why})" if why and tr['code'] >= 2 else '') + f", price {fpx(live)}, {fpct((live / e['px0'] - 1) * 100)} since tagged"))
        e['st'] = tr['key']
        since = (live / e['px0'] - 1) * 100 if e.get('px0') else None
        coins.append(dict(
            coin=meta[s]['base'], side='Gainer' if side == 'G' else 'Loser',
            now=(f"Top-5 #{e['rank']}" if e.get('rank') else f"Was top-5 (best #{e.get('best')})"),
            pattern=TAGS.get(tag, '—'), trend=tr['label'], code=tr['code'], signs=tr['score'], known=tr['known'],
            since_tag=round(since, 2) if fin(since) else None, pct24=round(pct, 2), price=fpx(live),
            off_extreme=round((tr['fromHi'] if side == 'G' else tr['fromLo']) * 100, 2),
            funding_4h=round(f4 * 100, 4) if fin(f4) else None, tagged=iso(e['t0']), tagged_px=fpx(e['px0'])))
        for c in tr['checks']:
            checks_rows.append(dict(coin=meta[s]['base'], side='Gainer' if side == 'G' else 'Loser', check=c['label'],
                                    on='yes' if c['ok'] is True else 'no' if c['ok'] is False else 'n/a', detail=c['d']))

    coins.sort(key=lambda c: (-c['code'], -c['signs'], c['side']))
    events = [ev for ev in events if now - calendar.timegm(time.strptime(ev['time'], '%Y-%m-%dT%H:%M:%SZ')) < 24 * 3600][-200:]
    summary = dict(updated=iso(now), tracked=len(coins),
                   gainers=sum(1 for c in coins if c['side'] == 'Gainer'), losers=sum(1 for c in coins if c['side'] == 'Loser'),
                   reversal=sum(1 for c in coins if c['code'] >= 2), changes=len(changes), new=len(new_entries))
    out = dict(updated=iso(now), summary=[summary], coins=coins, checks=checks_rows, events=list(reversed(events)),
               state=dict(trk=trk, v=1))
    with open(out_path, 'w') as f: json.dump(out, f, separators=(',', ':'))

    lines = []
    big = [c for c in sorted(changes, reverse=True) if c[0] >= 2]
    if big:
        lines.append('REVERSAL WATCH — ' + '; '.join(c[1] for c in big))
    other = [c[1] for c in sorted(changes, reverse=True) if c[0] < 2]
    if other: lines.append('Other trend changes: ' + '; '.join(other))
    if new_entries: lines.append('Newly tracked: ' + ', '.join(f"{meta[s]['base']} ({'gainer' if trk[s]['side'] == 'G' else 'loser'})" for s in new_entries if s in trk))
    if not changes:
        lines.append('No trend changes since the last run.')
    roster = ', '.join(f"{c['coin']} {c['trend'].lower()} {c['signs']}/8" for c in coins[:10])
    lines.append(f'Tracking {len(coins)} coins: {roster}.')
    print('\n'.join(lines))


if __name__ == '__main__':
    main()
