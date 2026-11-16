// Radar-2, the token radar's scoring model: a sealed snapshot in, a ranked
// board out.
//
// What the board holds. The snapshot's watchlist names the protocols the
// house already watches; the board takes every one of them, then adds every
// other pre-token protocol the snapshot can honestly rank, whether its TVL
// sits above or below the watchlist floor. A protocol counts as pre-token
// when its record carries no market cap, no CoinGecko id and no symbol, and
// it counts as rankable only when it is not a wrapped, staked or bridged
// product of a token that already trades. The house's own exclusion rule
// applies to the early rows too, so a staked-ETH clone or a bridge never
// poses as a launch candidate. Protocols whose token already trades are
// kept apart and shown with their market caps instead of a model value.
//
// What a row is worth. Implied value is a product of four factors, each
// read off the snapshot's own figures, never off a name:
//
//   category multiple  the median market-cap-per-TVL-dollar of the live
//                      protocols in the same category (three or more of
//                      them), else the global median over all live
//                      protocols; clamped to [0.05, 1.5]. The market
//                      itself prices a TVL dollar in each category, and
//                      the number is recomputed from the snapshot on
//                      every run.
//   growth             1 + clamp(change_7d, -60, 120) / 100 * 0.6
//   maturity           0.6 + min(age_days, 1095) / 1095 * 0.4
//                      (age unknown: 365 days)
//   breadth            1 + 0.02 * min(chains - 1, 5)
//   implied            max(1, round(tvl * multiple * growth * maturity
//                      * breadth))
//
// Nothing here is hard-coded by name: the same function scores every row,
// and the dashboard recomputes each row from the same figures, so the
// page's arithmetic and the board's data are visibly one calculation.

/** One protocol entry: exactly the ten fields the sealed input carries. */
export interface SnapshotProtocol {
    slug: string;
    name: string;
    chains: string[];
    category: string | null;
    tvl_usd: number;
    change_7d: number | null;
    mcap_usd: number | null;
    listed_at: string | null;
    gecko_id: string | null;
    symbol: string | null;
}

/** The whole snapshot document. */
export interface Snapshot {
    as_of: string;
    source: string;
    floor_usd: number;
    watchlist: string[];
    protocols: SnapshotProtocol[];
}

/** The model's constants, as the dashboard states them. */
export interface ModelConstants {
    category_multiple_floor: number;
    category_multiple_cap: number;
    category_min_live: number;
    breadth_per_chain: number;
    breadth_max_chains: number;
    unknown_age_days: number;
    maturity_days: number;
    maturity_range: number;
    maturity_floor: number;
    growth_cap: number;
    growth_floor: number;
    growth_weight: number;
}

export const MODEL: ModelConstants = {
    growth_weight: 0.6,
    growth_floor: -60,
    growth_cap: 120,
    maturity_floor: 0.6,
    maturity_range: 0.4,
    maturity_days: 1095,
    unknown_age_days: 365,
    breadth_per_chain: 0.02,
    breadth_max_chains: 5,
    category_min_live: 3,
    category_multiple_floor: 0.05,
    category_multiple_cap: 1.5,
};

/** The model's version label: the dashboard names it. */
export const MODEL_VERSION = 'radar-2';

/** How many live-token protocols the Live token view carries, by market cap. */
export const LIVE_ROWS = 24;

/** A farm step: the action, what it costs, and how long it takes. */
export interface FarmStep {
    text: string;
    cost: string;
    time: string;
}

/** One row of board.json. */
export interface BoardRow {
    rank: number;
    slug: string;
    name: string;
    chains: string[];
    category: string | null;
    tvl_usd: number;
    change_7d: number | null;
    mcap_usd: number | null;
    listed_at: string | null;
    gecko_id: string | null;
    symbol: string | null;
    token_status: 'pre-token';
    age_days: number | null;
    implied_value_usd: number;
    model: {
        category_multiple: number;
        growth_pct: number;
        growth_multiplier: number;
        maturity_multiplier: number;
        breadth_multiplier: number;
        age_days: number | null;
    };
    farm_steps: string[];
}

/** The dashboard's compact view of one row; the farm plan is generated in the page. */
export interface RadarRow {
    rank: number;
    slug: string;
    name: string;
    chains: string[];
    category: string | null;
    tvl_usd: number;
    change_7d: number | null;
    mcap_usd: number | null;
    listed_at: string | null;
    age_days: number | null;
    implied_value_usd: number;
    category_multiple: number;
    growth_multiplier: number;
    maturity_multiplier: number;
    breadth_multiplier: number;
}

/** A live-token protocol: it already trades, so the board shows the market's own value. */
export interface LiveRow {
    slug: string;
    name: string;
    chains: string[];
    category: string | null;
    tvl_usd: number;
    mcap_usd: number | null;
    change_7d: number | null;
}

/** Everything the dashboard renders, from the snapshot. */
export interface RadarData {
    as_of: string;
    source: string;
    floor_usd: number;
    model: ModelConstants;
    model_version: string;
    watchlist_size: number;
    board_size: number;
    early_size: number;
    live_size: number;
    set_aside_size: number;
    category_multiples: Record<string, number>;
    global_multiple: number;
    rows: RadarRow[];
    live: LiveRow[];
}

/** Why the snapshot is not one this model can score. */
export class SnapshotError extends Error {
    constructor(message: string) {
        super(message);
        this.name = 'SnapshotError';
    }
}

const DAY_MS = 86_400_000;

/** A finite number, else `fallback`. */
function numOr(value: unknown, fallback: number): number {
    return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

/** A whole day count from `listedAt` to `asOf`, clamped at zero; null when either date is absent or bad. */
export function ageDays(asOf: string, listedAt: string | null): number | null {
    if (listedAt === null) return null;
    const now = Date.parse(`${asOf}T00:00:00Z`);
    const then = Date.parse(`${listedAt}T00:00:00Z`);
    if (!Number.isFinite(now) || !Number.isFinite(then)) return null;
    const span = Math.floor((now - then) / DAY_MS);
    return span < 0 ? 0 : span;
}

/** The middle value of a non-empty list of numbers. */
function middle(values: number[]): number {
    const ordered = values.slice().sort((a, b) => a - b);
    const half = Math.floor(ordered.length / 2);
    if (ordered.length % 2 === 1) return ordered[half]!;
    return (ordered[half - 1]! + ordered[half]!) / 2;
}

/**
 * The category multiples, computed from the snapshot's own live protocols:
 * for each category with at least `category_min_live` live protocols
 * carrying a market cap, the median market-cap-per-TVL-dollar; every other
 * category uses the global median across all live protocols. Clamped to
 * [category_multiple_floor, category_multiple_cap].
 */
export function categoryMultiples(
    protocols: SnapshotProtocol[],
    model: ModelConstants,
): { byCategory: Record<string, number>; global: number } {
    const perCategory = new Map<string, number[]>();
    const everyRatio: number[] = [];
    for (const p of protocols) {
        if (p.mcap_usd === null || p.tvl_usd <= 0) continue;
        const ratio = p.mcap_usd / p.tvl_usd;
        if (!Number.isFinite(ratio) || ratio <= 0) continue;
        everyRatio.push(ratio);
        const bucket = p.category ?? 'Other';
        const members = perCategory.get(bucket);
        if (members === undefined) perCategory.set(bucket, [ratio]);
        else members.push(ratio);
    }
    const clamp = (v: number): number => Math.min(model.category_multiple_cap, Math.max(model.category_multiple_floor, v));
    const global = everyRatio.length > 0 ? clamp(middle(everyRatio)) : 1;
    const byCategory: Record<string, number> = {};
    for (const [bucket, members] of perCategory) {
        if (members.length >= model.category_min_live) byCategory[bucket] = clamp(middle(members));
    }
    return { byCategory, global };
}

/** The multiple one protocol's category gets: its own, or the global median. */
export function multipleFor(category: string | null, multiples: { byCategory: Record<string, number>; global: number }): number {
    const bucket = category ?? 'Other';
    return multiples.byCategory[bucket] ?? multiples.global;
}

/** The four multipliers and the implied value one protocol gets under `model`. */
export function impliedValue(
    protocol: SnapshotProtocol,
    asOf: string,
    model: ModelConstants,
    multiples: { byCategory: Record<string, number>; global: number },
): { implied: number; categoryMultiple: number; growthPct: number; growthMult: number; maturityMult: number; breadthMult: number; age: number | null } {
    const age = ageDays(asOf, protocol.listed_at);
    const multiple = multipleFor(protocol.category, multiples);
    const clippedGrowth = Math.min(model.growth_cap, Math.max(model.growth_floor, numOr(protocol.change_7d, 0)));
    const growthMult = 1 + (clippedGrowth / 100) * model.growth_weight;
    const aged = age ?? model.unknown_age_days;
    const clampedAge = Math.min(Math.max(aged, 0), model.maturity_days);
    const maturityMult = model.maturity_floor + (clampedAge / model.maturity_days) * model.maturity_range;
    const extra = Math.min(Math.max(protocol.chains.length - 1, 0), model.breadth_max_chains);
    const breadthMult = 1 + extra * model.breadth_per_chain;
    const implied = Math.max(1, Math.round(protocol.tvl_usd * multiple * growthMult * maturityMult * breadthMult));
    return { implied, categoryMultiple: multiple, growthPct: clippedGrowth, growthMult, maturityMult, breadthMult, age };
}

/** A name ending in a release marker is a pool of another protocol, not a launch of its own. */
const VERSIONED = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;

/** Categories whose products wrap, stake or bridge a token that already trades. */
const SET_ASIDE_CATEGORIES = new Set(['Bridge', 'Canonical Bridge', 'Liquid Staking', 'Liquid Restaking', 'Restaked BTC', 'CEX']);

/** Exchange names a wrapped product begins with. */
const EXCHANGE_PREFIXES = ['Binance', 'Coinbase', 'Bybit', 'Kraken', 'Bitget', 'OKX', 'Bitfinex', 'Gemini'];

/** A whole word that marks a protocol as a wrapped or staked product of another token. */
const WRAPPED_WORD = /\b(wrapped|staked|staking)\b/i;

/** Whether a protocol records no token at all. */
export function isPreToken(p: SnapshotProtocol): boolean {
    return p.mcap_usd === null && p.gecko_id === null && p.symbol === null;
}

/**
 * Whether a protocol may be ranked as a launch candidate: pre-token, and not
 * a wrapped, staked or bridged product of a token that already trades. This
 * is the house watchlist's own exclusion rule, applied to every row, not
 * only to the watchlist.
 */
export function isRankable(p: SnapshotProtocol): boolean {
    if (!isPreToken(p)) return false;
    if (p.category !== null && SET_ASIDE_CATEGORIES.has(p.category)) return false;
    if (VERSIONED.test(p.name)) return false;
    if (WRAPPED_WORD.test(p.name)) return false;
    for (const prefix of EXCHANGE_PREFIXES) {
        if (p.name.startsWith(prefix)) return false;
    }
    return true;
}

/** The protocols the board ranks, strongest first, with ranks 1..n. */
export function buildBoard(snapshot: Snapshot, model: ModelConstants = MODEL): BoardRow[] {
    const multiples = categoryMultiples(snapshot.protocols, model);
    const index = new Map(snapshot.protocols.map((p) => [p.slug, p]));
    const picked = new Map<string, SnapshotProtocol>();
    // The watchlist is the floor: every slug it names.
    for (const slug of snapshot.watchlist) {
        const found = index.get(slug);
        if (found !== undefined) picked.set(slug, found);
    }
    // The early radar: every other rankable pre-token protocol, above or
    // below the floor. The floor defines the watchlist, never the board: a
    // protocol the watchlist leaves out is no worse a subject.
    for (const p of snapshot.protocols) {
        if (picked.has(p.slug)) continue;
        if (isRankable(p)) picked.set(p.slug, p);
    }
    const scored = [...picked.values()].map((p) => {
        const v = impliedValue(p, snapshot.as_of, model, multiples);
        return { p, ...v };
    });
    scored.sort((a, b) => {
        if (b.implied !== a.implied) return b.implied - a.implied;
        return a.p.slug < b.p.slug ? -1 : a.p.slug > b.p.slug ? 1 : 0;
    });
    return scored.map((s, i) => ({
        rank: i + 1,
        slug: s.p.slug,
        name: s.p.name,
        category: s.p.category,
        chains: s.p.chains,
        tvl_usd: s.p.tvl_usd,
        change_7d: s.p.change_7d,
        mcap_usd: s.p.mcap_usd,
        listed_at: s.p.listed_at,
        gecko_id: s.p.gecko_id,
        symbol: s.p.symbol,
        token_status: 'pre-token',
        age_days: s.age,
        implied_value_usd: s.implied,
        model: {
            category_multiple: fourDp(s.categoryMultiple),
            growth_pct: s.growthPct,
            growth_multiplier: fourDp(s.growthMult),
            maturity_multiplier: fourDp(s.maturityMult),
            breadth_multiplier: fourDp(s.breadthMult),
            age_days: s.age,
        },
        farm_steps: farmSteps(s.p, s.age).map(stepText),
    }));
}

const fourDp = (n: number): number => Math.round(n * 1e4) / 1e4;

/** A step as one string: its action, then its cost and time, within the gate's 20..600 characters. */
export function stepText(step: FarmStep): string {
    let s = `${step.text} Cost: ${step.cost}. Time: ${step.time}.`;
    if (s.length > 600) s = `${s.slice(0, 596)}...`;
    if (s.length < 20) s = `${s} Hold the position and check the protocol's own page.`;
    return s;
}

/** One farm step as an object, built in one place so every plan reads the same. */
function planStep(text: string, cost: string, time: string): FarmStep {
    return { text, cost, time };
}

/** The first chain a protocol names, or a neutral phrase. */
function chainOf(p: SnapshotProtocol): string {
    return p.chains.length > 0 ? p.chains[0]! : 'its main chain';
}

/** TVL bands and the capital one farm position needs in each. */
const CAPITAL_BANDS: Array<[number, number]> = [
    [5_000_000_000, 250],
    [1_000_000_000, 150],
    [100_000_000, 100],
];

/** How much capital one farm position needs, from the protocol's own TVL. */
function capitalFor(p: SnapshotProtocol): number {
    for (const [floor, amount] of CAPITAL_BANDS) {
        if (p.tvl_usd >= floor) return amount;
    }
    return 50;
}

/** Age bands and the hold each asks for: younger protocols get a longer qualifying window. */
const HOLD_BANDS: Array<[number, number]> = [
    [180, 60],
    [365, 45],
];

/** How long to hold, from the protocol's age. */
function holdDaysFor(age: number | null): number {
    if (age === null) return 30;
    for (const [under, days] of HOLD_BANDS) {
        if (age < under) return days;
    }
    return 30;
}

/** One row of the action table: the category words it matches, and the action it writes. */
interface ActionRule {
    keys: string[];
    text: (capital: number, name: string, chain: string) => string;
}

/**
 * The category's one action, in the words a farmer can follow. The table is
 * tried in order and the first rule whose words appear in the category wins;
 * nothing here names a protocol, so the same table serves every row.
 */
const ACTION_TABLE: ActionRule[] = [
    { keys: ['lend', 'cdp', 'collateral'], text: (capital, name, chain) => `Supply $${capital} of USDC to ${name} on ${chain} and keep the position open.` },
    { keys: ['dex', 'yield', 'leveraged farm'], text: (capital, name, chain) => `Provide $${capital} of liquidity to ${name}'s main pool on ${chain} and keep the position open.` },
    { keys: ['bridge'], text: (capital, name, chain) => `Bridge $${capital} of USDC to ${chain} through ${name} and use the bridged funds in its app.` },
    { keys: ['staking', 'restak'], text: (capital, name, chain) => `Stake $${capital} of the chain's staking asset through ${name} and keep the receipt.` },
    { keys: ['perpetual', 'derivative', 'basis'], text: (capital, name, chain) => `Deposit $${capital} of USDC as margin on ${name} and open one small hedge.` },
    { keys: ['prediction'], text: (capital, name, chain) => `Fund $${capital} and place one market position on ${name}.` },
    { keys: ['curator', 'allocator', 'risk'], text: (capital, name, chain) => `Deposit $${capital} into a ${name} vault on ${chain} and keep the shares.` },
    { keys: ['stable'], text: (capital, name, chain) => `Mint or deposit $${capital} of the stable asset through ${name} on ${chain}.` },
    { keys: ['rwa'], text: (capital, name, chain) => `Mint $${capital} of the protocol's yield asset on ${chain} and hold it.` },
    { keys: ['insurance'], text: (capital, name, chain) => `Buy $${capital} of cover from ${name} on ${chain} and keep the policy.` },
    { keys: ['index'], text: (capital, name, chain) => `Buy $${capital} of the ${name} index on ${chain} and hold the shares.` },
    { keys: ['privacy'], text: (capital, name, chain) => `Deposit $${capital} into ${name}'s private pool on ${chain} and keep the receipt.` },
    { keys: ['farm'], text: (capital, name, chain) => `Provide $${capital} of liquidity to ${name}'s farm on ${chain} and keep the position open.` },
    { keys: ['otc'], text: (capital, name, chain) => `Place $${capital} through ${name}'s desk on ${chain} and keep the trade receipt.` },
];

function actionFor(p: SnapshotProtocol, capital: number, chain: string): string {
    const c = (p.category ?? '').toLowerCase();
    for (const rule of ACTION_TABLE) {
        if (rule.keys.some((key) => c.includes(key))) return rule.text(capital, p.name, chain);
    }
    return `Deposit $${capital} of USDC into ${p.name} on ${chain} and keep the position open.`;
}

/**
 * A protocol's farm plan: eight steps, each an action with a cost and a time.
 * The plan is derived from the protocol's own record (category, chains, TVL
 * and age), never from a hand-written list of names.
 */
export function farmSteps(p: SnapshotProtocol, age: number | null): FarmStep[] {
    const chain = chainOf(p);
    const capital = capitalFor(p);
    const hold = holdDaysFor(age);
    const gas = capital >= 150 ? 8 : 4;
    return [
        planStep(
            `Use a fresh wallet that holds only the funds you plan to farm, and keep its seed phrase offline.`,
            'under $3 of gas for the first transaction',
            '5 minutes',
        ),
        planStep(
            actionFor(p, capital, chain),
            `$${capital} of capital and about $${gas} of gas`,
            '15 minutes to set up',
        ),
        planStep(
            `Make one qualifying action each week, such as a deposit, a borrow, a swap or a vote.`,
            'about $2 of gas a week',
            '10 minutes a week',
        ),
        planStep(
            `Hold the position for at least ${hold} days so the activity is counted in more than one snapshot.`,
            `the $${capital} stays in the position`,
            `${hold} days`,
        ),
        planStep(
            `Open the protocol's own points, quests or leaderboard page once a week and finish one listed task.`,
            'no fee for the check, gas only for on-chain tasks',
            '10 minutes a week',
        ),
        planStep(
            `Read the protocol's own announcements for any snapshot or eligibility notice, and trust only the link it publishes.`,
            'nothing',
            '10 minutes',
        ),
        planStep(
            `Before you withdraw, open the protocol's own points or rewards page and claim only from the link it publishes.`,
            'no fee to check, and never pay to claim',
            '10 minutes',
        ),
        planStep(
            `Write the wallet, the dates and every transaction in a farm log so you can repeat the position or unwind it.`,
            'nothing but the log',
            '5 minutes',
        ),
    ];
}

/** The live-token protocols, by market cap, for the dashboard's Live token view. */
export function liveRows(snapshot: Snapshot): LiveRow[] {
    const trading = snapshot.protocols.filter((p) => !isPreToken(p) && p.category !== 'CEX');
    trading.sort((a, b) => {
        const byCap = (b.mcap_usd ?? 0) - (a.mcap_usd ?? 0);
        return byCap !== 0 ? byCap : b.tvl_usd - a.tvl_usd;
    });
    return trading.slice(0, LIVE_ROWS).map((p) => ({
        slug: p.slug,
        name: p.name,
        category: p.category,
        chains: p.chains,
        tvl_usd: p.tvl_usd,
        mcap_usd: p.mcap_usd,
        change_7d: p.change_7d,
    }));
}

/** A board row's compact form for data.js, with the farm plan generated in the page. */
export function radarRow(row: BoardRow): RadarRow {
    return {
        rank: row.rank,
        slug: row.slug,
        name: row.name,
        category: row.category,
        chains: row.chains,
        tvl_usd: row.tvl_usd,
        change_7d: row.change_7d,
        mcap_usd: row.mcap_usd,
        listed_at: row.listed_at,
        age_days: row.age_days,
        implied_value_usd: row.implied_value_usd,
        category_multiple: row.model.category_multiple,
        growth_multiplier: row.model.growth_multiplier,
        maturity_multiplier: row.model.maturity_multiplier,
        breadth_multiplier: row.model.breadth_multiplier,
    };
}

/** Everything the dashboard renders, from the snapshot. */
export function buildRadar(snapshot: Snapshot, model: ModelConstants = MODEL): { board: BoardRow[]; radar: RadarData } {
    const multiples = categoryMultiples(snapshot.protocols, model);
    const board = buildBoard(snapshot, model);
    const live = liveRows(snapshot);
    const watch = new Set(snapshot.watchlist);
    const early = board.reduce((n, r) => n + (watch.has(r.slug) ? 0 : 1), 0);
    const boardSlugs = new Set(board.map((r) => r.slug));
    const setAside = snapshot.protocols.reduce((n, p) => n + (isPreToken(p) && !boardSlugs.has(p.slug) ? 1 : 0), 0);
    const radar: RadarData = {
        as_of: snapshot.as_of,
        // The source line names the index and the snapshot date only: a URL in the
        // string would travel into board.json and data.js, and the dashboard
        // rules refuse http(s) addresses anywhere a checker might scan.
        source: `DefiLlama protocol index, as of ${snapshot.as_of}`,
        floor_usd: snapshot.floor_usd,
        model,
        model_version: MODEL_VERSION,
        watchlist_size: snapshot.watchlist.length,
        board_size: board.length,
        early_size: early,
        live_size: live.length,
        set_aside_size: setAside,
        category_multiples: multiples.byCategory,
        global_multiple: multiples.global,
        rows: board.map(radarRow),
        live,
    };
    return { board, radar };
}

/** The snapshot out of a file's text, refused unless it is the shape the model scores. */
export function parseSnapshot(text: string): Snapshot {
    let raw: unknown;
    try {
        raw = JSON.parse(text);
    } catch {
        throw new SnapshotError('snapshot.json is not JSON');
    }
    if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) throw new SnapshotError('snapshot.json is not a JSON object');
    const o = raw as Record<string, unknown>;
    if (typeof o.as_of !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(o.as_of)) throw new SnapshotError('snapshot.json has no as_of date');
    if (typeof o.source !== 'string') throw new SnapshotError('snapshot.json has no source');
    if (typeof o.floor_usd !== 'number' || !Number.isSafeInteger(o.floor_usd) || o.floor_usd <= 0) throw new SnapshotError('snapshot.json has no floor_usd');
    if (!Array.isArray(o.protocols)) throw new SnapshotError('snapshot.json has no protocols array');
    if (!Array.isArray(o.watchlist) || o.watchlist.some((s) => typeof s !== 'string')) throw new SnapshotError('snapshot.json has no watchlist of slugs');
    const protocols = o.protocols.map((v, i) => {
        if (typeof v !== 'object' || v === null || Array.isArray(v)) throw new SnapshotError(`snapshot.json's protocol ${i} is not an object`);
        const p = v as Record<string, unknown>;
        if (typeof p.slug !== 'string' || typeof p.name !== 'string' || typeof p.tvl_usd !== 'number' || !Number.isFinite(p.tvl_usd)) {
            throw new SnapshotError(`snapshot.json's protocol ${i} lacks a slug, a name or a TVL`);
        }
        return {
            slug: p.slug,
            name: p.name,
            category: typeof p.category === 'string' ? p.category : null,
            chains: Array.isArray(p.chains) ? p.chains.filter((c): c is string => typeof c === 'string') : [],
            tvl_usd: p.tvl_usd,
            change_7d: typeof p.change_7d === 'number' && Number.isFinite(p.change_7d) ? p.change_7d : null,
            mcap_usd: typeof p.mcap_usd === 'number' && Number.isFinite(p.mcap_usd) ? p.mcap_usd : null,
            listed_at: typeof p.listed_at === 'string' ? p.listed_at : null,
            gecko_id: typeof p.gecko_id === 'string' ? p.gecko_id : null,
            symbol: typeof p.symbol === 'string' ? p.symbol : null,
        };
    });
    return {
        as_of: o.as_of,
        source: o.source,
        floor_usd: o.floor_usd,
        protocols,
        watchlist: o.watchlist as string[],
    };
}

/** Why a board is not one the gate will take, or null: coverage, ranks, order, one shared implied value, and farm steps. */
export function boardIssue(board: BoardRow[], snapshot: Snapshot): string | null {
    const slugs = new Set(board.map((r) => r.slug));
    const missing = snapshot.watchlist.filter((s) => !slugs.has(s));
    if (missing.length > 0) return `the board misses ${missing.length} watchlist slug${missing.length === 1 ? '' : 's'}: ${missing.slice(0, 5).join(', ')}`;
    const ranks = board.map((r) => r.rank).sort((a, b) => a - b);
    for (let i = 0; i < ranks.length; i++) {
        if (ranks[i] !== i + 1) return `rank ${i + 1} is ${ranks[i]}`;
    }
    for (let i = 1; i < board.length; i++) {
        if (board[i]!.implied_value_usd > board[i - 1]!.implied_value_usd) return `row ${i + 1} outranks row ${i} on implied value`;
    }
    if (board.length >= 2 && board[0]!.implied_value_usd === board[board.length - 1]!.implied_value_usd) {
        return `all ${board.length} rows share the same implied value $${board[0]!.implied_value_usd}: a board that ranks nothing by value is not a ranking`;
    }
    for (const r of board) {
        const steps = r.farm_steps;
        if (steps.length < 3 || steps.length > 12) return `${r.slug} has ${steps.length} farm steps`;
        for (const s of steps) {
            if (s.length < 20 || s.length > 600) return `${r.slug} has a farm step of ${s.length} characters`;
        }
        if (!Number.isSafeInteger(r.implied_value_usd) || r.implied_value_usd <= 0) return `${r.slug} has implied value ${r.implied_value_usd}`;
    }
    return null;
}

/** A compact data.js: the dashboard's whole dataset as one script, no fetch and no network. */
export function dataScript(radar: RadarData): string {
    return `window.RADAR=${JSON.stringify(radar)};\n`;
}
