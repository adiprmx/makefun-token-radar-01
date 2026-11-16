// Token Radar's dashboard, model radar-2. It reads window.RADAR (written
// beside dashboard/ by main.ts) and renders the ranked board, a filterable
// table, and a per-protocol detail drawer with the model's own inputs and
// the protocol's farm plan. No network: every byte it shows is in data.js.
(() => {
    const DATASET = window.RADAR;
    if (!DATASET) return;
    const root = document.getElementById('board');
    const view = {
        q: '',
        category: 'all',
        chain: 'all',
        watchlistOnly: false,
        tab: 'pre-token',
        sort: 'implied',
        dir: -1,
        selected: null,
    };
    const WATCH = {};
    (DATASET.rows || []).forEach((r) => { if (r.rank <= DATASET.watchlist_size) WATCH[r.slug] = true; });
    const usd = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
    function usdShort(n) {
        if (n === null || n === undefined || !isFinite(n)) return 'n/a';
        if (Math.abs(n) >= 1e9) return '$' + (n / 1e9).toFixed(2) + 'B';
        if (Math.abs(n) >= 1e6) return '$' + (n / 1e6).toFixed(1) + 'M';
        if (Math.abs(n) >= 1e3) return '$' + Math.round(n / 1e3) + 'K';
        return usd.format(n);
    }
    function pctShort(n) {
        if (n === null || n === undefined || !isFinite(n)) return 'n/a';
        return (n > 0 ? '+' : '') + n.toFixed(2) + '%';
    }
    function ageShort(days) {
        if (days === null || days === undefined) return 'unknown';
        if (days >= 365) return (days / 365).toFixed(1) + 'y';
        return Math.max(0, Math.round(days)) + 'd';
    }
    // The model in one function: the page recomputes a row from the snapshot
    // figures and checks the number board.json carries, so the page's code
    // and the board's data are visibly the same arithmetic.
    function recomputeImplied(row, model) {
        let mult = DATASET.category_multiples[row.category || 'Other'];
        if (mult === undefined) mult = DATASET.global_multiple;
        const growth = Math.min(model.growth_cap, Math.max(model.growth_floor, row.change_7d === null || row.change_7d === undefined ? 0 : row.change_7d));
        const growthMult = 1 + (growth / 100) * model.growth_weight;
        const age = row.age_days === null || row.age_days === undefined ? model.unknown_age_days : row.age_days;
        const maturity = model.maturity_floor + (Math.min(Math.max(age, 0), model.maturity_days) / model.maturity_days) * model.maturity_range;
        const extra = Math.min(Math.max((row.chains || []).length - 1, 0), model.breadth_max_chains);
        const breadth = 1 + extra * model.breadth_per_chain;
        return Math.max(1, Math.round(row.tvl_usd * mult * growthMult * maturity * breadth));
    }
    function h(tag, attrs, ...kids) {
        const node = document.createElement(tag);
        if (attrs) {
            for (const [key, value] of Object.entries(attrs)) {
                if (key === 'class') node.className = value;
                else if (key === 'text') node.textContent = value;
                else if (key === 'html') node.innerHTML = value;
                else if (key.startsWith('on')) node.addEventListener(key.slice(2), value);
                else if (value !== null && value !== undefined) node.setAttribute(key, value);
            }
        }
        for (const kid of kids) {
            if (kid === null || kid === undefined) continue;
            if (Array.isArray(kid)) {
                for (const c of kid) if (c) node.appendChild(c);
            } else if (typeof kid === 'string') node.appendChild(document.createTextNode(kid));
            else node.appendChild(kid);
        }
        return node;
    }
    // The farm plan is the same derivation main.ts writes to board.json:
    // category, chains, TVL and age decide the action, the capital, the
    // hold and every cost and time. No name is special-cased.
    function planChain(p) { return p.chains && p.chains.length > 0 ? p.chains[0] : 'its main chain'; }
    function planCapital(p) {
        if (p.tvl_usd >= 5e9) return 250;
        if (p.tvl_usd >= 1e9) return 150;
        if (p.tvl_usd >= 1e8) return 100;
        return 50;
    }
    function planHold(age) {
        if (age === null || age === undefined) return 30;
        if (age < 180) return 60;
        if (age < 365) return 45;
        return 30;
    }
    const PLAN_ACTIONS = [
        { keys: ['lend', 'cdp', 'collateral'], text: (capital, name, chain) => 'Supply $' + capital + ' of USDC to ' + name + ' on ' + chain + ' and keep the position open.' },
        { keys: ['dex', 'yield', 'leveraged farm'], text: (capital, name, chain) => 'Provide $' + capital + ' of liquidity to ' + name + "'s main pool on " + chain + ' and keep the position open.' },
        { keys: ['bridge'], text: (capital, name, chain) => 'Bridge $' + capital + ' of USDC to ' + chain + ' through ' + name + ' and use the bridged funds in its app.' },
        { keys: ['staking', 'restak'], text: (capital, name, chain) => "Stake $" + capital + " of the chain's staking asset through " + name + ' and keep the receipt.' },
        { keys: ['perpetual', 'derivative', 'basis'], text: (capital, name, chain) => 'Deposit $' + capital + ' of USDC as margin on ' + name + ' and open one small hedge.' },
        { keys: ['prediction'], text: (capital, name, chain) => 'Fund $' + capital + ' and place one market position on ' + name + '.' },
        { keys: ['curator', 'allocator', 'risk'], text: (capital, name, chain) => 'Deposit $' + capital + ' into a ' + name + ' vault on ' + chain + ' and keep the shares.' },
        { keys: ['stable'], text: (capital, name, chain) => 'Mint or deposit $' + capital + ' of the stable asset through ' + name + ' on ' + chain + '.' },
        { keys: ['rwa'], text: (capital, name, chain) => "Mint $" + capital + " of the protocol's yield asset on " + chain + ' and hold it.' },
        { keys: ['insurance'], text: (capital, name, chain) => 'Buy $' + capital + ' of cover from ' + name + ' on ' + chain + ' and keep the policy.' },
        { keys: ['index'], text: (capital, name, chain) => 'Buy $' + capital + ' of the ' + name + ' index on ' + chain + ' and hold the shares.' },
        { keys: ['privacy'], text: (capital, name, chain) => 'Deposit $' + capital + " into " + name + "'s private pool on " + chain + ' and keep the receipt.' },
        { keys: ['farm'], text: (capital, name, chain) => 'Provide $' + capital + " of liquidity to " + name + "'s farm on " + chain + ' and keep the position open.' },
        { keys: ['otc'], text: (capital, name, chain) => 'Place $' + capital + " through " + name + "'s desk on " + chain + ' and keep the trade receipt.' },
    ];
    function planAction(p, capital, chain) {
        const c = (p.category || '').toLowerCase();
        for (const rule of PLAN_ACTIONS) {
            if (rule.keys.some((key) => c.indexOf(key) >= 0)) return rule.text(capital, p.name, chain);
        }
        return 'Deposit $' + capital + ' of USDC into ' + p.name + ' on ' + chain + ' and keep the position open.';
    }
    function planStepText(step) {
        let s = step.text + ' Cost: ' + step.cost + '. Time: ' + step.time + '.';
        if (s.length > 600) s = s.slice(0, 596) + '...';
        if (s.length < 20) s = s + " Hold the position and check the protocol's own page.";
        return s;
    }
    function planSteps(p) {
        const chain = planChain(p);
        const capital = planCapital(p);
        const hold = planHold(p.age_days);
        return [
            { text: 'Use a fresh wallet that holds only the funds you plan to farm, and keep its seed phrase offline.', cost: 'under $3 of gas for the first transaction', time: '5 minutes' },
            { text: planAction(p, capital, chain), cost: '$' + capital + ' of capital and about $' + (capital >= 150 ? 8 : 4) + ' of gas', time: '15 minutes to set up' },
            { text: 'Make one qualifying action each week, such as a deposit, a borrow, a swap or a vote.', cost: 'about $2 of gas a week', time: '10 minutes a week' },
            { text: 'Hold the position for at least ' + hold + ' days so the activity is counted in more than one snapshot.', cost: 'the $' + capital + ' stays in the position', time: hold + ' days' },
            { text: "Open the protocol's own points, quests or leaderboard page once a week and finish one listed task.", cost: 'no fee for the check, gas only for on-chain tasks', time: '10 minutes a week' },
            { text: "Read the protocol's own announcements for any snapshot or eligibility notice, and trust only the link it publishes.", cost: 'nothing', time: '10 minutes' },
            { text: "Before you withdraw, open the protocol's own points or rewards page and claim only from the link it publishes.", cost: 'no fee to check, and never pay to claim', time: '10 minutes' },
            { text: 'Write the wallet, the dates and every transaction in a farm log so you can repeat the position or unwind it.', cost: 'nothing but the log', time: '5 minutes' },
        ].map(planStepText);
    }
    function readHash() {
        const hash = window.location.hash.replace(/^#/, '');
        if (!hash) return;
        const params = new URLSearchParams(hash);
        if (params.get('q')) view.q = params.get('q');
        if (params.get('p')) view.selected = params.get('p');
        if (params.get('category')) view.category = params.get('category');
        if (params.get('chain')) view.chain = params.get('chain');
        if (params.get('w') === '1') view.watchlistOnly = true;
    }
    function writeHash() {
        const params = new URLSearchParams();
        if (view.q) params.set('q', view.q);
        if (view.category !== 'all') params.set('category', view.category);
        if (view.chain !== 'all') params.set('chain', view.chain);
        if (view.watchlistOnly) params.set('w', '1');
        if (view.selected) params.set('p', view.selected);
        const next = params.toString();
        if (next) window.history.replaceState(null, '', '#' + next);
        else window.history.replaceState(null, '', window.location.pathname + window.location.search);
    }
    function visibleRows() {
        const q = view.q.trim().toLowerCase();
        return DATASET.rows.filter((r) => {
            if (view.watchlistOnly && !WATCH[r.slug]) return false;
            if (view.category !== 'all' && r.category !== view.category) return false;
            if (view.chain !== 'all' && (r.chains || []).indexOf(view.chain) < 0) return false;
            if (!q) return true;
            const hay = [r.name, r.slug, r.category, (r.chains || []).join(' ')].join(' ').toLowerCase();
            return hay.indexOf(q) >= 0;
        });
    }
    function orderedRows(list) {
        const key = view.sort;
        return list.slice().sort((a, b) => {
            let av;
            let bv;
            if (key === 'name') { av = a.name.toLowerCase(); bv = b.name.toLowerCase(); }
            else if (key === 'tvl') { av = a.tvl_usd; bv = b.tvl_usd; }
            else if (key === 'growth') { av = a.change_7d === null ? -Infinity : a.change_7d; bv = b.change_7d === null ? -Infinity : b.change_7d; }
            else if (key === 'age') { av = a.age_days === null ? Infinity : a.age_days; bv = b.age_days === null ? Infinity : b.age_days; }
            else { av = a.implied_value_usd; bv = b.implied_value_usd; }
            if (av < bv) return -view.dir;
            if (av > bv) return view.dir;
            return a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0;
        });
    }
    function pageHeader() {
        return h('header', { class: 'top' },
            h('div', { class: 'brand' }, h('span', { class: 'mark' }), h('span', { class: 'brand-name', text: 'Token Radar' })),
            h('div', { class: 'top-meta' },
                h('span', { text: 'Snapshot ' + DATASET.as_of }),
                h('span', { text: 'DefiLlama protocol index' }),
                h('span', { text: DATASET.model_version + ' model' })
            )
        );
    }
    function lede() {
        return h('section', { class: 'lede' },
            h('div', null,
                h('h1', { text: DATASET.watchlist_size + ' watchlist protocols, ranked by implied value' }),
                h('p', null,
                    'The watchlist is the floor: every protocol with at least $' + Math.round(DATASET.floor_usd / 1e6) + 'M of TVL and no token on record. The early radar adds ' + DATASET.early_size + ' pre-token protocols the watchlist leaves out, above and below that floor, and sets aside ' + DATASET.set_aside_size + ' wrapped, staked or bridged products of tokens that already trade. Implied value is a model, not a promise.'
                )
            ),
            h('div', { class: 'facts' },
                h('div', { class: 'fact' }, h('span', { text: 'Watchlist covered' }), h('b', { text: DATASET.watchlist_size + ' / ' + DATASET.watchlist_size })),
                h('div', { class: 'fact' }, h('span', { text: 'Pre-token rows scored' }), h('b', { text: String(DATASET.board_size) })),
                h('div', { class: 'fact' }, h('span', { text: 'Early rows below the floor' }), h('b', { text: String(DATASET.early_size) })),
                h('div', { class: 'fact' }, h('span', { text: 'Live-token protocols set aside' }), h('b', { text: String(DATASET.live_size) }))
            )
        );
    }
    function controls() {
        const categories = Array.from(new Set(DATASET.rows.map((r) => r.category || 'Other'))).sort();
        const chains = Array.from(new Set(DATASET.rows.reduce((acc, r) => acc.concat(r.chains || []), []))).sort();
        const search = h('input', { type: 'search', id: 'q', placeholder: 'Search name, category or chain', value: view.q, 'aria-label': 'Search the board' });
        search.addEventListener('input', () => { view.q = search.value; writeHash(); render(); });
        const catSelect = h('select', { id: 'category', 'aria-label': 'Filter by category' },
            h('option', { value: 'all', text: 'All categories' }),
            categories.map((c) => h('option', { value: c, text: c, selected: c === view.category ? 'selected' : null }))
        );
        catSelect.addEventListener('change', () => { view.category = catSelect.value; writeHash(); render(); });
        const chainSelect = h('select', { id: 'chain', 'aria-label': 'Filter by chain' },
            h('option', { value: 'all', text: 'All chains' }),
            chains.map((c) => h('option', { value: c, text: c, selected: c === view.chain ? 'selected' : null }))
        );
        chainSelect.addEventListener('change', () => { view.chain = chainSelect.value; writeHash(); render(); });
        const watchBox = h('input', { type: 'checkbox', id: 'watchonly', checked: view.watchlistOnly ? 'checked' : null, 'aria-label': 'Watchlist only' });
        watchBox.addEventListener('change', () => { view.watchlistOnly = watchBox.checked; writeHash(); render(); });
        const pre = h('button', { type: 'button', 'aria-pressed': view.tab === 'pre-token' ? 'true' : 'false', text: 'Pre-token', onclick: () => { view.tab = 'pre-token'; render(); } });
        const live = h('button', { type: 'button', 'aria-pressed': view.tab === 'live' ? 'true' : 'false', text: 'Live token', onclick: () => { view.tab = 'live'; render(); } });
        return h('div', { class: 'controls' },
            h('div', { class: 'field' }, h('label', { for: 'q', text: 'Search' }), search),
            h('div', { class: 'field' }, h('label', { for: 'category', text: 'Category' }), catSelect),
            h('div', { class: 'field' }, h('label', { for: 'chain', text: 'Chain' }), chainSelect),
            h('label', { class: 'check', for: 'watchonly' }, watchBox, 'Watchlist only'),
            h('div', { class: 'field' }, h('span', { class: 'sub', text: 'Token status' }), h('div', { class: 'tabs' }, pre, live)),
            h('span', { class: 'count', text: view.tab === 'pre-token' ? visibleRows().length + ' rows shown' : DATASET.live.length + ' live-token protocols' })
        );
    }
    function sortHeader(key, label) {
        return h('th', { scope: 'col' },
            h('button', { type: 'button', onclick: () => { if (view.sort === key) view.dir = -view.dir; else { view.sort = key; view.dir = -1; } render(); } },
                label,
                view.sort === key ? h('span', { 'aria-hidden': 'true', text: view.dir < 0 ? ' v' : ' ^' }) : null
            )
        );
    }
    function boardTable() {
        const list = orderedRows(visibleRows());
        if (list.length === 0) {
            return h('div', { class: 'panel' }, h('div', { class: 'empty' },
                h('h2', { text: 'No protocol matches that filter' }),
                h('p', { text: 'Clear the search or pick another category to see the board again.' }),
                h('button', { class: 'button primary', type: 'button', text: 'Clear filters', onclick: () => { view.q = ''; view.category = 'all'; view.chain = 'all'; view.watchlistOnly = false; writeHash(); render(); } })
            ));
        }
        const max = list[0].implied_value_usd || 1;
        const tbody = h('tbody');
        list.forEach((r) => {
            const growth = r.change_7d === null ? 'n/a' : pctShort(r.change_7d);
            const growthClass = r.change_7d === null ? '' : r.change_7d >= 0 ? 'pos' : 'neg';
            const nameCell = h('div', { class: 'name' },
                h('span', null, h('b', { text: r.name }), WATCH[r.slug] ? h('span', { class: 'watch', text: 'WATCH' }) : null),
                h('span', { class: 'sub', text: (r.category || 'Other') + ' on ' + (r.chains && r.chains.length ? r.chains.slice(0, 2).join(', ') : 'an unnamed chain') })
            );
            const tr = h('tr', {
                'data-selected': view.selected === r.slug ? 'true' : 'false',
                tabindex: '0',
                onclick: () => { openDetail(r.slug); },
                onkeydown: (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openDetail(r.slug); } },
            },
                h('td', { class: 'num', text: String(r.rank) }),
                h('td', null, nameCell),
                h('td', { class: 'num', text: usdShort(r.tvl_usd) }),
                h('td', { class: 'num ' + growthClass, text: growth }),
                h('td', { class: 'num', text: ageShort(r.age_days) }),
                h('td', null, h('div', { class: 'implied' },
                    h('div', { class: 'bar', 'aria-hidden': 'true' }, h('i', { style: 'width:' + Math.max(3, Math.round((r.implied_value_usd / max) * 100)) + '%' })),
                    h('span', { class: 'num', text: usdShort(r.implied_value_usd) })
                )),
                h('td', null, h('span', { class: 'status', text: 'no token' }))
            );
            tbody.appendChild(tr);
        });
        return h('div', { class: 'panel' },
            h('div', { class: 'table-wrap' },
                h('table', null,
                    h('caption', { class: 'sub', text: 'Pre-token protocols, strongest implied value first. Select a row for its model and farm plan.' }),
                    h('thead', null, h('tr', null,
                        sortHeader('implied', 'Rank'),
                        sortHeader('name', 'Protocol'),
                        sortHeader('tvl', 'TVL'),
                        sortHeader('growth', '7d'),
                        sortHeader('age', 'Age'),
                        sortHeader('implied', 'Implied value'),
                        h('th', { scope: 'col', text: 'Token' })
                    )),
                    tbody
                )
            )
        );
    }
    function liveTable() {
        const tbody = h('tbody');
        DATASET.live.forEach((r) => {
            tbody.appendChild(h('tr', null,
                h('td', { class: 'num', text: 'live' }),
                h('td', null, h('div', { class: 'name' }, h('b', { text: r.name }), h('span', { class: 'sub', text: (r.category || 'Other') + ' on ' + (r.chains && r.chains.length ? r.chains.slice(0, 2).join(', ') : 'an unnamed chain') }))),
                h('td', { class: 'num', text: usdShort(r.tvl_usd) }),
                h('td', { class: 'num ' + (r.change_7d !== null && r.change_7d >= 0 ? 'pos' : 'neg'), text: pctShort(r.change_7d) }),
                h('td', { class: 'num', text: usdShort(r.mcap_usd) }),
                h('td', null, h('span', { class: 'status', text: 'already trades' }))
            ));
        });
        return h('div', { class: 'panel' },
            h('div', { class: 'table-wrap' },
                h('table', null,
                    h('caption', { class: 'sub', text: 'Token live: these protocols already trade, so their market cap is a fact, not a model. They are set aside from the pre-token ranking.' }),
                    h('thead', null, h('tr', null, h('th', { scope: 'col', text: 'Status' }), h('th', { scope: 'col', text: 'Protocol' }), h('th', { scope: 'col', text: 'TVL' }), h('th', { scope: 'col', text: '7d' }), h('th', { scope: 'col', text: 'Market cap' }), h('th', { scope: 'col', text: 'Token' }))),
                    tbody
                )
            )
        );
    }
    function modelPanel() {
        const m = DATASET.model;
        const mults = Object.keys(DATASET.category_multiples).sort((a, b) => DATASET.category_multiples[b] - DATASET.category_multiples[a]);
        return h('section', { class: 'panel model' },
            h('h2', { text: 'How implied value is computed' }),
            h('p', { class: 'sub', text: 'Every row is scored by one function of the snapshot figures. No protocol name is special-cased, and no row is hand-picked.' }),
            h('div', { class: 'formula' },
                'implied = round( tvl_usd x ',
                h('b', { text: 'category multiple' }),
                ' x (1 + clamp(change_7d, ' + m.growth_floor + ', ' + m.growth_cap + ') / 100 x ' + m.growth_weight + ') x (' + m.maturity_floor + ' + min(age_days, ' + m.maturity_days + ') / ' + m.maturity_days + ' x ' + m.maturity_range + ') x (1 + 0.02 x min(chains - 1, 5)) )'
            ),
            h('p', { class: 'sub', text: 'The category multiple is the median market-cap-per-TVL-dollar of the live protocols in that category (at least 3 of them), else the global median of ' + DATASET.global_multiple + '. It is recomputed from this snapshot on every run: the market itself prices each category. TVL and seven-day growth come from the snapshot. Age is the time since the protocol was first listed, the best record of how long it has run with no token; an unlisted age uses ' + m.unknown_age_days + ' days. The early radar is every pre-token protocol the watchlist leaves out that is not a wrapped, staked or bridged product of a token that already trades, and the live-token protocols are set aside with their market caps shown.' }),
            h('h3', { text: 'Category multiples, from the snapshot' }),
            h('div', { class: 'mult-grid' }, mults.map((c) => h('div', { class: 'mult' }, h('span', { text: c }), h('b', { text: 'x' + DATASET.category_multiples[c].toFixed(3) }))))
        );
    }
    const dialog = h('dialog', { class: 'detail', id: 'detail', 'aria-labelledby': 'detail-title' });
    dialog.addEventListener('close', () => { view.selected = null; writeHash(); });
    function openDetail(slug) {
        const row = DATASET.rows.filter((r) => r.slug === slug)[0];
        if (!row) return;
        view.selected = slug;
        writeHash();
        dialog.textContent = '';
        const steps = planSteps(row);
        const recomputed = recomputeImplied(row, DATASET.model);
        dialog.appendChild(h('div', { class: 'detail-head' },
            h('div', null,
                h('span', { class: 'brand-name', text: 'Rank ' + row.rank + ' of ' + DATASET.board_size + (WATCH[row.slug] ? ' - watchlist' : ' - early radar') }),
                h('h2', { id: 'detail-title', text: row.name }),
                h('p', { class: 'sub', text: (row.category || 'Other') + ' on ' + (row.chains && row.chains.length ? row.chains.join(', ') : 'an unnamed chain') })
            ),
            h('button', { class: 'close', type: 'button', 'aria-label': 'Close details', text: 'Close', onclick: () => { dialog.close(); } })
        ));
        dialog.appendChild(h('section', { class: 'detail-section' },
            h('h3', { text: 'Implied value' }),
            h('div', { class: 'equation' },
                h('div', null, h('span', { text: 'TVL' }), h('b', { class: 'num', text: usdShort(row.tvl_usd) })),
                h('div', null, h('span', { text: 'Category multiple (' + (row.category || 'Other') + ')' }), h('b', { class: 'num', text: 'x' + row.category_multiple })),
                h('div', null, h('span', { text: 'Seven-day growth' }), h('b', { class: 'num', text: pctShort(row.change_7d) })),
                h('div', null, h('span', { text: 'Growth multiplier' }), h('b', { class: 'num', text: String(row.growth_multiplier) })),
                h('div', null, h('span', { text: 'Age with no token' }), h('b', { class: 'num', text: ageShort(row.age_days) })),
                h('div', null, h('span', { text: 'Maturity multiplier' }), h('b', { class: 'num', text: String(row.maturity_multiplier) })),
                h('div', null, h('span', { text: 'Chain breadth (' + (row.chains || []).length + ' chains)' }), h('b', { class: 'num', text: 'x' + row.breadth_multiplier })),
                h('div', null, h('span', { text: 'Implied value' }), h('b', { class: 'num', text: usdShort(row.implied_value_usd) }))
            ),
            h('p', { class: 'sub', text: 'Model ' + DATASET.model_version + ': the same function scores every protocol. The page recomputes this row as ' + usdShort(recomputed) + (recomputed === row.implied_value_usd ? ', the same number board.json carries.' : ', which differs from the board: the data would be stale.') + ' This is an estimate, not a price.' })
        ));
        dialog.appendChild(h('section', { class: 'detail-section' },
            h('h3', { text: 'Farm plan' }),
            h('ol', { class: 'steps' }, steps.map((s) => {
                const at = s.indexOf(' Cost: ');
                const action = at >= 0 ? s.slice(0, at) : s;
                const tail = at >= 0 ? s.slice(at + 1) : '';
                return h('li', null, h('b', { text: action }), h('span', { class: 'cost', text: tail }));
            }))
        ));
        if (typeof dialog.showModal === 'function') {
            if (!dialog.open) dialog.showModal();
        } else {
            dialog.setAttribute('open', '');
        }
    }
    function render() {
        root.textContent = '';
        const shell = h('div', { class: 'shell' });
        shell.appendChild(pageHeader());
        shell.appendChild(lede());
        shell.appendChild(controls());
        shell.appendChild(view.tab === 'pre-token' ? boardTable() : liveTable());
        if (view.tab === 'pre-token') shell.appendChild(modelPanel());
        root.appendChild(shell);
        root.setAttribute('aria-busy', 'false');
        if (!dialog.isConnected) root.appendChild(dialog);
        if (view.selected) openDetail(view.selected);
    }
    readHash();
    render();
    window.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && dialog.open) dialog.close();
    });
})();
