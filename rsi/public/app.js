(function () {
    'use strict';

    var $ = function (id) { return document.getElementById(id); };
    var SETTINGS_KEY = 'rsi-settings', WATCH_KEY = 'rsi-watch';
    var DEFAULTS = { period: 14, buy: 30, sell: 70, fee: 0.25, closedOnly: false };
    var DEFAULT_WATCH = [
        { symbol: '005930.KS', name: '삼성전자' }, { symbol: '000660.KS', name: 'SK하이닉스' },
        { symbol: '005380.KS', name: '현대차' }, { symbol: '035420.KS', name: 'NAVER' },
        { symbol: '035720.KS', name: '카카오' }, { symbol: 'AAPL', name: '애플' },
        { symbol: 'NVDA', name: '엔비디아' }, { symbol: 'TSLA', name: '테슬라' }
    ];

    var settings = load(SETTINGS_KEY, DEFAULTS);
    var watch = load(WATCH_KEY, DEFAULT_WATCH);
    var charts = {};      // symbol → 서버 응답 (또는 { error })
    var current = null;   // 선택된 종목 심볼
    var filter = 'ALL';
    var rangeDays = 126;

    // ---------- 저장 ----------
    function load(key, fallback) {
        try {
            var v = JSON.parse(localStorage.getItem(key));
            if (v == null) return fallback;
            return Array.isArray(fallback) ? v : Object.assign({}, fallback, v);
        } catch (e) { return fallback; }
    }
    function save(key, value) {
        try { localStorage.setItem(key, JSON.stringify(value)); } catch (e) { /* 저장 불가 환경 */ }
    }

    // ---------- 데이터 ----------
    function api(path) {
        return fetch(path).then(function (res) {
            return res.json().catch(function () { return {}; }).then(function (body) {
                if (!res.ok) throw new Error(body.error || '서버 오류 (' + res.status + ')');
                return body;
            });
        }, function () {
            throw new Error('서버에 연결할 수 없습니다. node server.js 로 실행했는지 확인하세요.');
        });
    }

    function fetchChart(symbol, force) {
        if (!force && charts[symbol] && !charts[symbol].error) return Promise.resolve(charts[symbol]);
        return api('api/chart?symbol=' + encodeURIComponent(symbol)).then(function (data) {
            charts[symbol] = data;
            if (data.symbol !== symbol) charts[data.symbol] = data;
            return data;
        }, function (e) {
            charts[symbol] = { error: e.message };
            throw e;
        });
    }

    function analyze(data) {
        var candles = data.candles;
        if (settings.closedOnly && !data.lastClosed) candles = candles.slice(0, -1);
        var closes = candles.map(function (c) { return c.close; });
        var rsi = RSI.calcRSI(closes, settings.period);
        var n = candles.length;
        var now = rsi[n - 1], prev = n > 1 ? rsi[n - 2] : null;
        var last = candles[n - 1], prevClose = n > 1 ? candles[n - 2].close : null;
        return {
            data: data, candles: candles, rsi: rsi, now: now, prev: prev, last: last,
            change: prevClose ? last.close - prevClose : 0,
            changePct: prevClose ? last.close / prevClose - 1 : 0,
            judge: RSI.judge(now, prev, settings.buy, settings.sell),
            bt: RSI.backtest(candles, rsi, settings.buy, settings.sell, settings.fee)
        };
    }

    // ---------- 포맷 ----------
    function money(v, cur) {
        if (v == null || !isFinite(v)) return '-';
        if (cur === 'KRW') return Math.round(v).toLocaleString('ko-KR') + '원';
        var s = v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
        return cur === 'USD' ? '$' + s : s + ' ' + (cur || '');
    }
    function axisMoney(v, cur) {
        if (cur === 'KRW') return v >= 1e5 ? v.toLocaleString('ko-KR', { notation: 'compact', maximumSignificantDigits: 4 }) : Math.round(v).toLocaleString('ko-KR');
        return v.toLocaleString('en-US', { maximumFractionDigits: v >= 100 ? 0 : 2 });
    }
    function signed(v, cur) { return (v > 0 ? '+' : v < 0 ? '-' : '') + money(Math.abs(v), cur); }
    function pct(v) { return v == null ? '-' : (v > 0 ? '+' : '') + (v * 100).toFixed(2) + '%'; }
    function rsiText(v) { return v == null ? '-' : v.toFixed(1); }
    function tone(v) { return v > 0 ? 'up' : v < 0 ? 'down' : ''; }
    function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return '&#' + c.charCodeAt(0) + ';'; }); }
    function shortDate(d) { return d.slice(2).replace(/-/g, '.'); }
    function code(symbol) { return symbol.replace(/\.(KS|KQ)$/, ''); }
    function chip(j) { return '<span class="chip ' + j.action + (j.strong ? ' strong' : '') + '">' + j.label + '</span>'; }

    // ---------- 상세 ----------
    function select(symbol, opts) {
        opts = opts || {};
        current = symbol;
        if (!opts.keepHash) history.replaceState(null, '', '#' + encodeURIComponent(symbol));
        renderWatch();
        showError('');
        var cached = charts[symbol];
        if (cached && !cached.error) renderDetail(cached);
        else $('stock').style.opacity = '.5';
        fetchChart(symbol).then(function (data) {
            if (current !== symbol) return;
            // 6자리 코드로 조회하면 005930 → 005930.KS 처럼 정식 심볼로 바뀜
            if (data.symbol !== symbol) {
                current = data.symbol;
                history.replaceState(null, '', '#' + encodeURIComponent(current));
                renderWatch();
            }
            renderDetail(data);
        }).catch(function (e) {
            if (current !== symbol) return;
            showError(e.message);
            $('stock').style.opacity = '';
        });
    }

    function renderDetail(data) {
        var a = analyze(data);
        if (a.candles.length <= settings.period) return showError('일봉 데이터가 부족합니다.');
        var cur = data.currency;
        $('empty').hidden = true;
        $('stock').hidden = false;
        $('stock').style.opacity = '';

        $('sName').textContent = data.name;
        $('sCode').textContent = code(data.symbol) + (data.market ? ' · ' + data.market : '');
        $('sPrice').textContent = money(a.last.close, cur);
        $('sChange').textContent = signed(a.change, cur) + ' (' + pct(a.changePct) + ')';
        $('sChange').className = 'change ' + tone(a.change);
        var live = !data.lastClosed && a.candles === data.candles;
        $('sAsof').textContent = a.last.date + (live ? ' 장중 · 실시간 봉 포함' : ' 종가 기준');
        var starred = watch.some(function (w) { return w.symbol === data.symbol; });
        $('star').setAttribute('aria-pressed', String(starred));

        drawGauge(a.now);
        $('gValue').textContent = rsiText(a.now);
        $('gCaption').textContent = 'RSI(' + settings.period + ')';
        $('vLabel').textContent = a.judge.label;
        $('vLabel').className = 'verdict-label ' + a.judge.action;
        $('vDetail').textContent = a.judge.detail;
        $('fPrev').textContent = rsiText(a.prev);
        $('fBuy').textContent = settings.buy;
        $('fSell').textContent = settings.sell;

        var bt = a.bt;
        setTile('btTotal', pct(bt.totalReturn), bt.totalReturn);
        setTile('btHold', pct(bt.buyHold), bt.buyHold);
        setTile('btCount', bt.trades.length + (bt.openTrade ? '+1' : '') + '회');
        setTile('btWin', bt.winRate == null ? '-' : Math.round(bt.winRate * 100) + '%');
        var rows = bt.trades.concat(bt.openTrade ? [bt.openTrade] : []).reverse();
        $('trades').innerHTML = rows.length ? rows.map(function (t) {
            return '<tr><td>' + money(t.entryPrice, cur) + '<span class="sub">' + esc(t.entryDate) + '</span></td>' +
                '<td>' + money(t.exitPrice, cur) + '<span class="sub">' + (t.open ? '보유 중 (현재가)' : esc(t.exitDate)) + '</span></td>' +
                '<td>' + t.days + '거래일</td>' +
                '<td class="ret ' + tone(t.ret) + '">' + pct(t.ret) + (t.open ? '<span class="badge-open">보유</span>' : '') + '</td></tr>';
        }).join('') : '<tr><td colspan="4" class="muted center">최근 2년 동안 신호가 없었습니다.</td></tr>';

        drawChart(a);
    }

    function setTile(id, text, v) {
        $(id).textContent = text;
        $(id).className = 'tile-value ' + (v == null ? '' : tone(v));
    }

    function showError(msg) {
        $('error').textContent = msg;
        $('error').hidden = !msg;
    }

    // ---------- 게이지 ----------
    function drawGauge(v) {
        var cx = 110, cy = 112, r = 92;
        function pt(val, rad) {
            var ang = Math.PI * (1 - val / 100);
            return [cx + rad * Math.cos(ang), cy - rad * Math.sin(ang)];
        }
        function arc(from, to, color) {
            var p1 = pt(from, r), p2 = pt(to, r);
            return '<path d="M' + p1[0] + ' ' + p1[1] + 'A' + r + ' ' + r + ' 0 0 1 ' + p2[0] + ' ' + p2[1] + '" stroke="' + color + '" stroke-width="14" fill="none" stroke-linecap="butt"/>';
        }
        var s = [];
        s.push(arc(0, settings.buy - 0.6, 'var(--red)'));
        s.push(arc(settings.buy + 0.6, settings.sell - 0.6, 'var(--gray-soft)'));
        s.push(arc(settings.sell + 0.6, 100, 'var(--blue)'));
        [0, settings.buy, settings.sell, 100].forEach(function (t) {
            var p = pt(t, r - 22);
            s.push('<text x="' + p[0] + '" y="' + (p[1] + 4) + '" text-anchor="middle" font-size="11" fill="var(--muted)">' + t + '</text>');
        });
        if (v != null) {
            var p = pt(Math.max(0, Math.min(100, v)), r);
            var col = v < settings.buy ? 'var(--red)' : v > settings.sell ? 'var(--blue)' : 'var(--gray)';
            s.push('<circle cx="' + p[0] + '" cy="' + p[1] + '" r="11" fill="var(--surface)" stroke="' + col + '" stroke-width="5"/>');
        }
        $('gauge').innerHTML = s.join('');
    }

    // ---------- 차트 ----------
    var lastAnalysis = null;

    function drawChart(a) {
        lastAnalysis = a;
        var el = $('chart');
        var start = Math.max(a.candles.length - rangeDays, a.rsi.findIndex(function (v) { return v != null; }));
        var cs = a.candles.slice(start), rs = a.rsi.slice(start);
        var n = cs.length, cur = a.data.currency;
        if (n < 2) { el.innerHTML = ''; return; }

        var W = Math.max(300, el.clientWidth || 800);
        var narrow = W < 600;
        var L = 0, R = narrow ? 46 : 60, T = 10, H1 = narrow ? 200 : 280, GAP = 28, H2 = narrow ? 90 : 110, B = 24;
        var H = T + H1 + GAP + H2 + B, cw = W - L - R, slot = cw / n;
        var lo = Infinity, hi = -Infinity;
        cs.forEach(function (c) { lo = Math.min(lo, c.low != null ? c.low : c.close); hi = Math.max(hi, c.high != null ? c.high : c.close); });
        var pad = (hi - lo) * 0.08 || hi * 0.02 || 1;
        lo -= pad; hi += pad;
        var x = function (i) { return L + slot * (i + 0.5); };
        var yP = function (v) { return T + (1 - (v - lo) / (hi - lo)) * H1; };
        var top2 = T + H1 + GAP;
        var yR = function (v) { return top2 + (1 - v / 100) * H2; };
        var f1 = function (v) { return v.toFixed(1); };

        var s = ['<svg viewBox="0 0 ' + W + ' ' + H + '" font-size="11" fill="var(--muted)" font-family="inherit">'];

        // 가격 격자 (현재가 표시와 겹치는 눈금 글자는 생략)
        var lastY = yP(cs[n - 1].close);
        for (var g = 0; g <= 4; g++) {
            var gv = lo + pad + (hi - lo - 2 * pad) * g / 4;
            s.push('<line x1="0" x2="' + cw + '" y1="' + f1(yP(gv)) + '" y2="' + f1(yP(gv)) + '" stroke="var(--line)" stroke-dasharray="2 3"/>');
            if (Math.abs(yP(gv) - lastY) > 16) s.push('<text x="' + (cw + 8) + '" y="' + f1(yP(gv) + 4) + '">' + axisMoney(gv, cur) + '</text>');
        }

        // 캔들 (상승 빨강, 하락 파랑)
        var bw = Math.max(1, Math.min(12, slot * 0.68));
        cs.forEach(function (c, i) {
            var o = c.open != null ? c.open : c.close;
            var up = c.close >= o;
            var col = up ? 'var(--red)' : 'var(--blue)';
            var xi = x(i);
            if (c.high != null && c.low != null) {
                s.push('<line x1="' + f1(xi) + '" x2="' + f1(xi) + '" y1="' + f1(yP(c.high)) + '" y2="' + f1(yP(c.low)) + '" stroke="' + col + '"/>');
            }
            var y1 = yP(Math.max(o, c.close)), y2 = yP(Math.min(o, c.close));
            s.push('<rect x="' + f1(xi - bw / 2) + '" y="' + f1(y1) + '" width="' + f1(bw) + '" height="' + f1(Math.max(1, y2 - y1)) + '" fill="' + col + '"/>');
        });

        // 신호 표시
        a.bt.signals.forEach(function (sg) {
            var i = sg.index - start;
            if (i < 0) return;
            var c = cs[i], xi = x(i);
            if (sg.type === 'BUY') {
                var yb = yP(c.low != null ? c.low : c.close) + 6;
                s.push('<path d="M' + f1(xi) + ' ' + f1(yb) + 'l-6 10h12z" fill="var(--red)"/>');
            } else {
                var ys = yP(c.high != null ? c.high : c.close) - 6;
                s.push('<path d="M' + f1(xi) + ' ' + f1(ys) + 'l-6 -10h12z" fill="var(--blue)"/>');
            }
        });

        // 현재가 라인
        s.push('<line x1="0" x2="' + cw + '" y1="' + f1(lastY) + '" y2="' + f1(lastY) + '" stroke="var(--text-2)" stroke-dasharray="1 3" opacity=".6"/>');
        s.push('<rect x="' + (cw + 2) + '" y="' + f1(lastY - 9) + '" width="' + (R - 2) + '" height="18" rx="4" fill="var(--text)"/>');
        s.push('<text x="' + (cw + 8) + '" y="' + f1(lastY + 4) + '" fill="var(--surface)" font-weight="700">' + axisMoney(cs[n - 1].close, cur) + '</text>');

        // RSI 패널
        s.push('<rect x="0" y="' + f1(yR(settings.buy)) + '" width="' + cw + '" height="' + f1(yR(0) - yR(settings.buy)) + '" fill="var(--red-soft)"/>');
        s.push('<rect x="0" y="' + f1(yR(100)) + '" width="' + cw + '" height="' + f1(yR(settings.sell) - yR(100)) + '" fill="var(--blue-soft)"/>');
        [settings.buy, 50, settings.sell].forEach(function (lv) {
            var col = lv === settings.buy ? 'var(--red)' : lv === settings.sell ? 'var(--blue)' : 'var(--line)';
            s.push('<line x1="0" x2="' + cw + '" y1="' + f1(yR(lv)) + '" y2="' + f1(yR(lv)) + '" stroke="' + col + '" stroke-dasharray="3 3" opacity=".7"/>');
            s.push('<text x="' + (cw + 8) + '" y="' + f1(yR(lv) + 4) + '">' + lv + '</text>');
        });
        s.push('<path d="' + rs.map(function (v, i) { return (i ? 'L' : 'M') + f1(x(i)) + ' ' + f1(yR(v)); }).join('') + '" fill="none" stroke="var(--purple)" stroke-width="1.8" stroke-linejoin="round"/>');
        s.push('<text x="2" y="' + (top2 - 9) + '" font-weight="600">RSI ' + settings.period + ' · ' + rsiText(rs[n - 1]) + '</text>');

        // 날짜 축
        var ticks = narrow ? 3 : 5;
        for (var k = 0; k < ticks; k++) {
            var di = Math.round((n - 1) * (k + 0.5) / ticks);
            s.push('<text x="' + f1(x(di)) + '" y="' + (H - 6) + '" text-anchor="middle">' + shortDate(cs[di].date) + '</text>');
        }

        s.push('<line id="cx" y1="' + T + '" y2="' + (top2 + H2) + '" stroke="var(--muted)" stroke-dasharray="3 3" visibility="hidden"/>');
        s.push('</svg><div id="tip" class="chart-tip" hidden></div>');
        el.innerHTML = s.join('');

        var svg = el.querySelector('svg'), line = $('cx'), tip = $('tip');
        function move(ev) {
            var p = ev.touches ? ev.touches[0] : ev;
            var rect = svg.getBoundingClientRect();
            var px = (p.clientX - rect.left) * W / rect.width;
            var i = Math.max(0, Math.min(n - 1, Math.floor((px - L) / slot)));
            var c = cs[i], prevC = i > 0 ? cs[i - 1].close : (start > 0 ? a.candles[start - 1].close : null);
            line.setAttribute('x1', x(i)); line.setAttribute('x2', x(i));
            line.setAttribute('visibility', 'visible');
            var chg = prevC ? c.close / prevC - 1 : null;
            tip.innerHTML = '<b>' + esc(c.date) + '</b>' +
                (c.open != null ? '<div class="row"><span>시가</span><span>' + money(c.open, cur) + '</span></div>' +
                    '<div class="row"><span>고가</span><span>' + money(c.high, cur) + '</span></div>' +
                    '<div class="row"><span>저가</span><span>' + money(c.low, cur) + '</span></div>' : '') +
                '<div class="row"><span>종가</span><span class="' + tone(chg) + '">' + money(c.close, cur) + (chg == null ? '' : ' ' + pct(chg)) + '</span></div>' +
                '<div class="row"><span>RSI</span><span>' + rsiText(rs[i]) + '</span></div>';
            tip.hidden = false;
            var tx = x(i) * rect.width / W;
            var tw = tip.offsetWidth;
            tip.style.left = (tx + 14 + tw > rect.width ? tx - 14 - tw : tx + 14) + 'px';
            tip.style.top = '8px';
        }
        function leave() { line.setAttribute('visibility', 'hidden'); tip.hidden = true; }
        svg.addEventListener('mousemove', move);
        svg.addEventListener('mouseleave', leave);
        svg.addEventListener('touchstart', move, { passive: true });
        svg.addEventListener('touchmove', move, { passive: true });
        svg.addEventListener('touchend', leave);
    }

    // ---------- 관심종목 ----------
    function renderWatch() {
        var counts = { ALL: 0, BUY: 0, SELL: 0, HOLD: 0 };
        var html = watch.map(function (w) {
            var d = charts[w.symbol], a = d && !d.error && d.candles ? analyze(d) : null;
            var action = a ? (a.judge.action === 'NONE' ? 'HOLD' : a.judge.action) : null;
            counts.ALL++;
            if (action) counts[action]++;
            if (filter !== 'ALL' && action !== filter) return '';

            var cur = a && a.data.currency;
            var body;
            if (a) {
                var pos = Math.max(0, Math.min(100, a.now || 0));
                body = '<div class="w-price">' + money(a.last.close, cur) + '</div>' +
                    '<div class="w-meta"><span>' + esc(code(w.symbol)) + '</span></div>' +
                    '<div class="w-chg ' + tone(a.change) + '">' + pct(a.changePct) + '</div>' +
                    '<div class="w-rsi"><span class="rsi-num">RSI ' + rsiText(a.now) + '</span>' +
                    '<span class="bar" style="--b:' + settings.buy + '%;--s:' + settings.sell + '%"><i class="' + a.judge.action + '" style="left:' + pos + '%"></i></span>' +
                    chip(a.judge) + '</div>';
            } else if (d && d.error) {
                body = '<div></div><div class="w-meta">' + esc(code(w.symbol)) + '</div><div></div><div class="w-err">' + esc(d.error) + '</div>';
            } else {
                body = '<div class="w-price"><span class="skeleton"></span></div><div class="w-meta">' + esc(code(w.symbol)) + '</div><div></div>' +
                    '<div class="w-rsi"><span class="skeleton" style="width:100%"></span></div>';
            }
            return '<li class="watch-item' + (w.symbol === current ? ' active' : '') + '" data-symbol="' + esc(w.symbol) + '">' +
                '<div class="w-name">' + esc(w.name) + '</div>' + body + '</li>';
        }).join('');

        $('watch').innerHTML = html;
        $('watchEmpty').hidden = !!html;
        $('cAll').textContent = counts.ALL;
        $('cBuy').textContent = counts.BUY;
        $('cSell').textContent = counts.SELL;
        $('cHold').textContent = counts.HOLD;
    }

    // 동시에 4개씩 조회
    function scan(force) {
        var queue = watch.map(function (w) { return w.symbol; });
        if (force) queue.forEach(function (s) { delete charts[s]; });
        renderWatch();
        function worker() {
            var s = queue.shift();
            if (!s) return Promise.resolve();
            return fetchChart(s, force).catch(function () { }).then(function () {
                renderWatch();
                if (s === current && charts[s] && !charts[s].error) renderDetail(charts[s]);
                return worker();
            });
        }
        return Promise.all([worker(), worker(), worker(), worker()]);
    }

    function toggleStar() {
        var data = charts[current];
        if (!data || data.error) return;
        var i = watch.findIndex(function (w) { return w.symbol === data.symbol; });
        if (i >= 0) watch.splice(i, 1);
        else watch.unshift({ symbol: data.symbol, name: data.name });
        save(WATCH_KEY, watch);
        $('star').setAttribute('aria-pressed', String(i < 0));
        renderWatch();
    }

    // ---------- 검색 ----------
    var suggestItems = [], suggestIndex = -1, searchTimer = null, searchSeq = 0;

    function renderSuggest() {
        var ul = $('suggest');
        if (!$('q').value.trim()) { ul.hidden = true; return; }
        ul.innerHTML = suggestItems.length ? suggestItems.map(function (s, i) {
            return '<li data-i="' + i + '" class="' + (i === suggestIndex ? 'active' : '') + '"><span class="s-name">' + esc(s.name) + '</span>' +
                '<span class="s-meta">' + esc(code(s.symbol)) + (s.market ? ' · ' + esc(s.market) : '') + '</span></li>';
        }).join('') : '<li class="s-none">검색 결과가 없습니다. 종목 코드(예: 005930, AAPL)를 입력하고 Enter를 누르세요.</li>';
        ul.hidden = false;
    }

    function pick(item) {
        $('q').value = '';
        $('suggest').hidden = true;
        $('q').blur();
        select(item.symbol);
    }

    var suggestQuery = '';

    function runSearch(q) {
        var seq = ++searchSeq;
        return api('api/search?q=' + encodeURIComponent(q)).then(function (items) {
            if (seq !== searchSeq) return null;
            suggestItems = items; suggestIndex = items.length ? 0 : -1; suggestQuery = q;
            renderSuggest();
            return items;
        }).catch(function () { return []; });
    }

    $('q').addEventListener('input', function () {
        clearTimeout(searchTimer);
        var q = this.value.trim();
        if (!q) { suggestItems = []; suggestQuery = ''; return renderSuggest(); }
        searchTimer = setTimeout(function () { runSearch(q); }, 180);
    });

    $('q').addEventListener('keydown', function (e) {
        var q = this.value.trim();
        if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
            e.preventDefault();
            if (!suggestItems.length || suggestQuery !== q) return;
            suggestIndex = (suggestIndex + (e.key === 'ArrowDown' ? 1 : -1) + suggestItems.length) % suggestItems.length;
            renderSuggest();
        } else if (e.key === 'Enter') {
            e.preventDefault();
            if (!q) return;
            if (suggestQuery === q && suggestItems[suggestIndex]) return pick(suggestItems[suggestIndex]);
            // 검색 결과가 아직 없으면 바로 검색해서 첫 결과, 없으면 입력한 코드 그대로 조회
            clearTimeout(searchTimer);
            runSearch(q).then(function (items) {
                if (items === null) return;
                pick(items && items.length ? items[0] : { symbol: q.toUpperCase() });
            });
        } else if (e.key === 'Escape') {
            $('suggest').hidden = true;
        }
    });

    $('suggest').addEventListener('mousedown', function (e) {
        var li = e.target.closest('[data-i]');
        if (li) { e.preventDefault(); pick(suggestItems[+li.dataset.i]); }
    });
    $('q').addEventListener('blur', function () { $('suggest').hidden = true; });
    $('q').addEventListener('focus', function () { if (this.value.trim()) renderSuggest(); });

    // ---------- 설정 ----------
    function fillSettings(v) {
        var f = $('settingsForm');
        f.period.value = v.period; f.buy.value = v.buy; f.sell.value = v.sell; f.fee.value = v.fee;
        f.closedOnly.checked = v.closedOnly;
        f.buy.setCustomValidity('');
    }

    $('openSettings').addEventListener('click', function () {
        fillSettings(settings);
        $('settings').showModal();
    });
    $('settingsForm').addEventListener('input', function () { this.buy.setCustomValidity(''); });
    $('resetSettings').addEventListener('click', function () { fillSettings(DEFAULTS); });
    $('settingsForm').addEventListener('submit', function (e) {
        if (e.submitter && e.submitter.value !== 'save') return;
        var f = this;
        var next = {
            period: parseInt(f.period.value, 10), buy: parseFloat(f.buy.value), sell: parseFloat(f.sell.value),
            fee: parseFloat(f.fee.value) || 0, closedOnly: f.closedOnly.checked
        };
        if (!(next.buy < next.sell)) {
            e.preventDefault();
            f.buy.setCustomValidity('매수 기준은 매도 기준보다 작아야 합니다.');
            f.buy.reportValidity();
            return;
        }
        settings = next;
        save(SETTINGS_KEY, settings);
        renderWatch();
        if (charts[current] && !charts[current].error) renderDetail(charts[current]);
    });

    // ---------- 기타 이벤트 ----------
    $('star').addEventListener('click', toggleStar);
    $('refresh').addEventListener('click', function () { scan(true); });

    $('watch').addEventListener('click', function (e) {
        var li = e.target.closest('[data-symbol]');
        if (!li) return;
        select(li.dataset.symbol);
        if (window.matchMedia('(max-width: 920px)').matches) window.scrollTo({ top: 0, behavior: 'smooth' });
    });

    $('filters').addEventListener('click', function (e) {
        var b = e.target.closest('[data-f]');
        if (!b) return;
        filter = b.dataset.f;
        Array.prototype.forEach.call(this.children, function (c) { c.classList.toggle('on', c === b); });
        renderWatch();
    });

    $('ranges').addEventListener('click', function (e) {
        var b = e.target.closest('[data-days]');
        if (!b) return;
        rangeDays = +b.dataset.days;
        Array.prototype.forEach.call(this.children, function (c) { c.classList.toggle('on', c === b); });
        if (lastAnalysis) drawChart(lastAnalysis);
    });

    var resizeTimer = null;
    window.addEventListener('resize', function () {
        clearTimeout(resizeTimer);
        resizeTimer = setTimeout(function () { if (lastAnalysis) drawChart(lastAnalysis); }, 120);
    });

    window.addEventListener('hashchange', function () {
        var s = decodeURIComponent(location.hash.slice(1));
        if (s && s !== current) select(s, { keepHash: true });
    });

    // ---------- 시작 ----------
    var initial = decodeURIComponent(location.hash.slice(1)) || (watch[0] && watch[0].symbol);
    if (initial) select(initial, { keepHash: !!location.hash });
    scan(false);
})();
