(function () {
    var $ = function (id) { return document.getElementById(id); };
    var WATCH_KEY = 'rsi-watchlist';
    var csvCandles = null, csvName = '';

    var HINTS = {
        upbit: '업비트 마켓 코드 (예: KRW-BTC, KRW-ETH). "BTC"만 입력해도 됩니다.',
        binance: '바이낸스 심볼 (예: BTCUSDT, ETHUSDT). "BTC"만 입력하면 USDT 마켓으로 조회합니다.',
        csv: '주식 등은 날짜·종가가 담긴 일봉 CSV를 올리세요. (예: Yahoo Finance 다운로드 CSV — Date, Close 열 자동 인식)'
    };
    var DEFAULT_SYMBOL = { upbit: 'KRW-BTC', binance: 'BTCUSDT' };

    // ---------- 데이터 ----------
    function normalizeSymbol(source, s) {
        s = s.trim().toUpperCase();
        if (source === 'upbit') return s.indexOf('-') >= 0 ? s : 'KRW-' + s;
        if (source === 'binance') return /USDT$|BUSD$|USDC$|BTC$|ETH$|FDUSD$/.test(s) && s.length > 4 ? s : s + 'USDT';
        return s;
    }

    function getJSON(url) {
        return fetch(url).then(function (res) {
            if (!res.ok) {
                return res.text().then(function (t) {
                    var err = new Error('HTTP ' + res.status);
                    err.status = res.status; err.body = t;
                    throw err;
                });
            }
            return res.json();
        });
    }

    // 업비트: 1회 최대 200개 → 2번 조회해서 약 400일
    function loadUpbit(market) {
        var base = 'https://api.upbit.com/v1/candles/days?market=' + encodeURIComponent(market) + '&count=200';
        return getJSON(base).then(function (first) {
            if (!first.length || first.length < 200) return first;
            var oldest = first[first.length - 1].candle_date_time_utc;
            return getJSON(base + '&to=' + encodeURIComponent(oldest.replace('T', ' ')))
                .then(function (second) { return first.concat(second); })
                .catch(function () { return first; });
        }).then(function (rows) {
            if (!rows.length) throw new Error('데이터가 없습니다.');
            var seen = {};
            return rows.reverse().filter(function (r) {
                if (seen[r.candle_date_time_kst]) return false;
                return (seen[r.candle_date_time_kst] = true);
            }).map(function (r) {
                return { date: r.candle_date_time_kst.slice(0, 10), close: r.trade_price };
            });
        }).catch(function (e) {
            if (e.status === 404 || (e.body && e.body.indexOf('market') >= 0)) throw new Error('업비트에 없는 마켓입니다: ' + market);
            throw e;
        });
    }

    function loadBinance(symbol) {
        var path = '/api/v3/klines?symbol=' + encodeURIComponent(symbol) + '&interval=1d&limit=500';
        return getJSON('https://api.binance.com' + path)
            .catch(function (e) {
                if (e.status === 400) throw e;
                return getJSON('https://data-api.binance.vision' + path); // 지역 차단 시 대체 엔드포인트
            })
            .then(function (rows) {
                return rows.map(function (k) {
                    return { date: new Date(k[0]).toISOString().slice(0, 10), close: parseFloat(k[4]) };
                });
            })
            .catch(function (e) {
                if (e.status === 400) throw new Error('바이낸스에 없는 심볼입니다: ' + symbol);
                throw e;
            });
    }

    function load(source, symbol, closedOnly) {
        var p = source === 'upbit' ? loadUpbit(symbol) : loadBinance(symbol);
        return p.then(function (candles) {
            return closedOnly ? candles.slice(0, -1) : candles;
        }).catch(function (e) {
            if (e instanceof TypeError) throw new Error('네트워크 오류로 시세를 가져오지 못했습니다. 잠시 후 다시 시도하세요.');
            throw e;
        });
    }

    // ---------- 설정 ----------
    function settings() {
        var s = {
            period: parseInt($('period').value, 10) || 14,
            buy: parseFloat($('buy').value),
            sell: parseFloat($('sell').value),
            fee: parseFloat($('fee').value) || 0
        };
        if (!(s.buy < s.sell)) throw new Error('매수 기준은 매도 기준보다 작아야 합니다.');
        return s;
    }

    function analyze(candles, s) {
        var closes = candles.map(function (c) { return c.close; });
        var rsi = RSI.calcRSI(closes, s.period);
        var n = candles.length;
        return {
            candles: candles,
            rsi: rsi,
            now: rsi[n - 1],
            prev: n > 1 ? rsi[n - 2] : null,
            judge: RSI.judge(rsi[n - 1], n > 1 ? rsi[n - 2] : null, s.buy, s.sell),
            bt: RSI.backtest(candles, rsi, s.buy, s.sell, s.fee)
        };
    }

    // ---------- 표시 ----------
    function fmtPrice(v) {
        if (v == null) return '-';
        var digits = v >= 1000 ? 0 : v >= 1 ? 2 : 6;
        return v.toLocaleString('ko-KR', { maximumFractionDigits: digits });
    }
    function fmtAxis(v) { return v.toLocaleString('ko-KR', { notation: 'compact', maximumSignificantDigits: 4 }); }
    function fmtRSI(v) { return v == null ? '-' : v.toFixed(1); }
    function fmtPct(v) { return v == null ? '-' : (v > 0 ? '+' : '') + (v * 100).toFixed(1) + '%'; }
    function cls(v) { return v > 0 ? 'up' : v < 0 ? 'down' : ''; }
    function esc(s) { return String(s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }

    function showError(msg) {
        $('error').textContent = msg;
        $('error').hidden = !msg;
    }

    function render(name, a, s) {
        var last = a.candles[a.candles.length - 1];
        $('name').textContent = name;
        $('asof').textContent = last.date + ' 일봉 기준 · RSI(' + s.period + ') · 매수 ' + s.buy + ' / 매도 ' + s.sell;
        $('price').textContent = fmtPrice(last.close);
        $('rsiNow').textContent = fmtRSI(a.now);
        $('rsiPrev').textContent = fmtRSI(a.prev);
        $('badge').textContent = a.judge.label;
        $('badge').className = 'badge ' + a.judge.action;
        $('detail').textContent = a.judge.detail;

        var bt = a.bt;
        $('btTotal').textContent = fmtPct(bt.totalReturn);
        $('btTotal').className = cls(bt.totalReturn);
        $('btHold').textContent = fmtPct(bt.buyHold);
        $('btCount').textContent = bt.trades.length + (bt.openTrade ? ' (+보유중 1)' : '');
        $('btWin').textContent = bt.winRate == null ? '-' : Math.round(bt.winRate * 100) + '%';

        var rows = bt.trades.concat(bt.openTrade ? [bt.openTrade] : []).reverse();
        $('trades').innerHTML = rows.length ? rows.map(function (t) {
            return '<tr><td>' + esc(t.entryDate) + '</td><td>' + fmtPrice(t.entryPrice) + '</td><td>' +
                (t.open ? '보유중' : esc(t.exitDate)) + '</td><td>' + fmtPrice(t.exitPrice) + '</td><td>' + t.days +
                '</td><td class="' + cls(t.ret) + '">' + fmtPct(t.ret) + '</td></tr>';
        }).join('') : '<tr><td colspan="6" class="muted">조건을 만족한 거래가 없습니다.</td></tr>';

        $('result').hidden = false;
        drawChart(a, s);
    }

    var lastChart = null;
    window.addEventListener('resize', function () {
        clearTimeout(window.__rsiResize);
        window.__rsiResize = setTimeout(function () { if (lastChart) drawChart(lastChart[0], lastChart[1]); }, 150);
    });

    function drawChart(a, s) {
        lastChart = [a, s];
        var el = $('chart');
        var start = Math.max(0, a.rsi.findIndex(function (v) { return v != null; }));
        var candles = a.candles.slice(start), rsi = a.rsi.slice(start);
        var n = candles.length;
        if (n < 2) { el.innerHTML = ''; return; }

        // 실제 너비에 맞춰 그려서 모바일에서도 글자 크기 유지
        var W = Math.max(300, el.clientWidth || 900), L = 4, R = 52, P1 = 12, H1 = W < 600 ? 180 : 250, GAP = 26, H2 = 120, B = 22;
        var H = P1 + H1 + GAP + H2 + B;
        var cw = W - L - R;
        var closes = candles.map(function (c) { return c.close; });
        var lo = Math.min.apply(null, closes), hi = Math.max.apply(null, closes);
        var pad = (hi - lo) * 0.06 || hi * 0.01 || 1;
        lo -= pad; hi += pad;
        var x = function (i) { return L + (i / (n - 1)) * cw; };
        var yP = function (v) { return P1 + (1 - (v - lo) / (hi - lo)) * H1; };
        var top2 = P1 + H1 + GAP;
        var yR = function (v) { return top2 + (1 - v / 100) * H2; };

        var path = function (vals, y) {
            return vals.map(function (v, i) { return (i ? 'L' : 'M') + x(i).toFixed(1) + ' ' + y(v).toFixed(1); }).join('');
        };

        var svg = [];
        svg.push('<svg viewBox="0 0 ' + W + ' ' + H + '" font-size="11" fill="var(--muted)">');
        // 가격 축
        for (var g = 0; g <= 4; g++) {
            var v = lo + (hi - lo) * g / 4;
            svg.push('<line x1="' + L + '" x2="' + (W - R) + '" y1="' + yP(v) + '" y2="' + yP(v) + '" stroke="var(--line)"/>');
            svg.push('<text x="' + (W - R + 6) + '" y="' + (yP(v) + 4) + '">' + fmtAxis(v) + '</text>');
        }
        svg.push('<path d="' + path(closes, yP) + '" fill="none" stroke="var(--accent)" stroke-width="1.6"/>');

        // 백테스트 신호 마커
        a.bt.signals.forEach(function (sg) {
            var i = sg.index - start;
            if (i < 0) return;
            var cx = x(i), cy = yP(candles[i].close);
            if (sg.type === 'BUY') {
                svg.push('<path d="M' + cx + ' ' + (cy + 4) + 'l-5 9h10z" fill="var(--buy)"/>');
            } else {
                svg.push('<path d="M' + cx + ' ' + (cy - 4) + 'l-5 -9h10z" fill="var(--sell)"/>');
            }
        });

        // RSI 패널
        svg.push('<rect x="' + L + '" y="' + yR(s.sell) + '" width="' + cw + '" height="' + (yR(s.buy) - yR(s.sell)) + '" fill="var(--line)" opacity=".35"/>');
        [0, s.buy, 50, s.sell, 100].forEach(function (lv) {
            var dash = (lv === s.buy || lv === s.sell) ? ' stroke-dasharray="4 3"' : '';
            var col = lv === s.buy ? 'var(--buy)' : lv === s.sell ? 'var(--sell)' : 'var(--line)';
            svg.push('<line x1="' + L + '" x2="' + (W - R) + '" y1="' + yR(lv) + '" y2="' + yR(lv) + '" stroke="' + col + '"' + dash + '/>');
            svg.push('<text x="' + (W - R + 6) + '" y="' + (yR(lv) + 4) + '">' + lv + '</text>');
        });
        svg.push('<path d="' + path(rsi, yR) + '" fill="none" stroke="#a855f7" stroke-width="1.4"/>');
        svg.push('<text x="' + (L + 2) + '" y="' + (top2 - 8) + '">RSI(' + s.period + ')</text>');

        // 날짜 축
        var ticks = W < 600 ? 2 : 4;
        for (var k = 0; k <= ticks; k++) {
            var di = Math.round((n - 1) * k / ticks);
            var anchor = k === 0 ? 'start' : k === ticks ? 'end' : 'middle';
            svg.push('<text x="' + x(di) + '" y="' + (H - 6) + '" text-anchor="' + anchor + '">' + esc(candles[di].date) + '</text>');
        }
        svg.push('<line id="cross" y1="' + P1 + '" y2="' + (top2 + H2) + '" stroke="var(--muted)" stroke-dasharray="2 2" visibility="hidden"/>');
        svg.push('<rect id="hit" x="' + L + '" y="0" width="' + cw + '" height="' + H + '" fill="transparent"/>');
        svg.push('</svg><div class="tip" hidden></div>');
        el.innerHTML = svg.join('');

        // 마우스 오버 툴팁
        var svgEl = el.querySelector('svg'), cross = el.querySelector('#cross'), tip = el.querySelector('.tip');
        function move(ev) {
            var rect = svgEl.getBoundingClientRect();
            var px = ((ev.touches ? ev.touches[0].clientX : ev.clientX) - rect.left) * W / rect.width;
            var i = Math.min(n - 1, Math.max(0, Math.round((px - L) / cw * (n - 1))));
            cross.setAttribute('x1', x(i)); cross.setAttribute('x2', x(i));
            cross.setAttribute('visibility', 'visible');
            tip.hidden = false;
            tip.textContent = candles[i].date + '  종가 ' + fmtPrice(candles[i].close) + '  RSI ' + fmtRSI(rsi[i]);
        }
        svgEl.addEventListener('mousemove', move);
        svgEl.addEventListener('touchmove', move, { passive: true });
        svgEl.addEventListener('mouseleave', function () { cross.setAttribute('visibility', 'hidden'); tip.hidden = true; });
    }

    // ---------- 분석 실행 ----------
    function run() {
        showError('');
        var s;
        try { s = settings(); } catch (e) { return showError(e.message); }
        var source = $('source').value;

        if (source === 'csv') {
            if (!csvCandles) return showError('CSV 파일을 선택하세요.');
            if (csvCandles.length <= s.period) return showError('CSV 데이터가 부족합니다. (' + csvCandles.length + '행)');
            return render(csvName, analyze(csvCandles, s), s);
        }

        var symbol = normalizeSymbol(source, $('symbol').value);
        if (!symbol) return showError('종목을 입력하세요.');
        $('symbol').value = symbol;
        var btn = document.querySelector('#form button[type=submit]');
        btn.disabled = true; btn.textContent = '불러오는 중…';
        load(source, symbol, $('closedOnly').checked).then(function (candles) {
            if (candles.length <= s.period) throw new Error('일봉 데이터가 부족합니다. (' + candles.length + '개)');
            render(symbol + (source === 'upbit' ? ' · 업비트' : ' · 바이낸스'), analyze(candles, s), s);
        }).catch(function (e) {
            showError(e.message);
        }).then(function () {
            btn.disabled = false; btn.textContent = '분석';
        });
    }

    // ---------- 관심목록 ----------
    function getWatch() {
        try { return JSON.parse(localStorage.getItem(WATCH_KEY)) || []; } catch (e) { return []; }
    }
    function setWatch(list) {
        try { localStorage.setItem(WATCH_KEY, JSON.stringify(list)); } catch (e) { /* 저장 불가 환경 */ }
    }

    function renderWatch(results) {
        var list = getWatch();
        results = results || {};
        $('watchEmpty').hidden = list.length > 0;
        $('watch').innerHTML = list.map(function (w, i) {
            var key = w.source + ':' + w.symbol, r = results[key];
            var cells = r === undefined ? '<td>-</td><td>-</td><td>-</td>'
                : r.error ? '<td colspan="3" class="down">' + esc(r.error) + '</td>'
                : '<td>' + fmtPrice(r.price) + '</td><td>' + fmtRSI(r.rsi) + '</td><td><span class="pill ' + r.judge.action + '">' + r.judge.label + '</span></td>';
            return '<tr><td class="link" data-i="' + i + '">' + esc(w.symbol) + ' <span class="muted">' + (w.source === 'upbit' ? '업비트' : '바이낸스') + '</span></td>' +
                cells + '<td><button class="x" data-del="' + i + '" title="삭제">×</button></td></tr>';
        }).join('');
    }

    function scanWatch() {
        var s;
        try { s = settings(); } catch (e) { return showError(e.message); }
        var list = getWatch(), results = {}, closedOnly = $('closedOnly').checked;
        renderWatch(results);
        // 요청 제한을 피하려고 순차 조회
        return list.reduce(function (p, w) {
            return p.then(function () {
                return load(w.source, w.symbol, closedOnly).then(function (candles) {
                    var a = analyze(candles, s);
                    results[w.source + ':' + w.symbol] = { price: candles[candles.length - 1].close, rsi: a.now, judge: a.judge };
                }).catch(function (e) {
                    results[w.source + ':' + w.symbol] = { error: e.message };
                }).then(function () { renderWatch(results); });
            });
        }, Promise.resolve());
    }

    // ---------- 이벤트 ----------
    function onSource() {
        var src = $('source').value;
        $('symbolWrap').hidden = src === 'csv';
        $('csvWrap').hidden = src !== 'csv';
        $('addWatch').hidden = src === 'csv';
        $('hint').textContent = HINTS[src];
        // 다른 거래소 형식의 심볼이 남아 있으면 기본값으로 교체
        var isUpbitSymbol = /^KRW-/.test($('symbol').value);
        if ((src === 'upbit' && !isUpbitSymbol) || (src === 'binance' && isUpbitSymbol)) {
            $('symbol').value = DEFAULT_SYMBOL[src];
        }
    }

    $('source').addEventListener('change', onSource);
    $('form').addEventListener('submit', function (e) { e.preventDefault(); run(); });

    $('csv').addEventListener('change', function () {
        var file = this.files[0];
        if (!file) return;
        var reader = new FileReader();
        reader.onload = function () {
            csvCandles = RSI.parseCSV(reader.result);
            csvName = file.name.replace(/\.[^.]+$/, '');
            if (!csvCandles.length) return showError('CSV에서 종가를 찾지 못했습니다. Date, Close 열이 있는지 확인하세요.');
            run();
        };
        reader.readAsText(file);
    });

    $('addWatch').addEventListener('click', function () {
        var source = $('source').value;
        var symbol = normalizeSymbol(source, $('symbol').value);
        if (!symbol) return;
        var list = getWatch();
        if (!list.some(function (w) { return w.source === source && w.symbol === symbol; })) {
            list.push({ source: source, symbol: symbol });
            setWatch(list);
        }
        scanWatch();
    });

    $('scan').addEventListener('click', scanWatch);

    $('watch').addEventListener('click', function (e) {
        var del = e.target.closest('[data-del]');
        if (del) {
            var list = getWatch();
            list.splice(+del.dataset.del, 1);
            setWatch(list);
            return renderWatch();
        }
        var link = e.target.closest('[data-i]');
        if (link) {
            var w = getWatch()[+link.dataset.i];
            $('source').value = w.source;
            onSource();
            $('symbol').value = w.symbol;
            run();
            window.scrollTo({ top: 0, behavior: 'smooth' });
        }
    });

    onSource();
    renderWatch();
    if (getWatch().length) scanWatch();
    run();
})();
