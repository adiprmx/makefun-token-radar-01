// Token Radar, the entry program (Node 22, standard library only).
//
// It reads the sealed snapshot from /input/snapshot.json (or --input
// <file|dir>), scores every rankable pre-token protocol with the radar-2
// model in lib/model.ts, writes the ranked board to /output/board.json,
// writes the dashboard's data beside the page as /output/data.js, copies
// this repository's dashboard/ and screenshots/ to /output, and writes
// /output/dossier.json with the vendored make.fun library, as the scorer
// rebuilds it. The program runs twice and both runs must write the same
// bytes.
//
// Outside the grader's container, MAKEFUN_OUTPUT_DIR stands in for /output:
//   mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input ../input/snapshot.json

import {
    copyFileSync,
    existsSync,
    mkdirSync,
    readFileSync,
    readdirSync,
    writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
    boardIssue,
    buildRadar,
    dataScript,
    parseSnapshot,
} from './lib/model.ts';
import { buildDossier } from './vendor/makefun-board.ts';

/** The repository's own directory: dashboard/ and screenshots/ live beside this file. */
const ROOT = fileURLToPath(new URL('.', import.meta.url));

/** The scorer's own caps: the text cap shapes the bytes, the rest refuse. */
const TEXT_CAP_BYTES = 65_536;
const SHOT_LIMIT = { max: 4, max_bytes: 524_288 };
const SHOT_NAME = /^[A-Za-z0-9_][A-Za-z0-9._-]{0,127}$/;

/** --name <value> out of the arguments, or the fallback. An exact `--name` wins over `--name=value`. */
function flagValue(flag: string, fallback: string): string {
    const marker = `--${flag}`;
    const exact = process.argv.indexOf(marker);
    if (exact >= 0 && exact + 1 < process.argv.length) {
        return process.argv[exact + 1]!;
    }
    const joined = process.argv.find((a) => a.startsWith(`${marker}=`));
    return joined === undefined ? fallback : joined.slice(marker.length + 1);
}

/** Stop with a message on stderr and an exit code. */
function fail(message: string, code: number): never {
    process.stderr.write(message);
    process.exit(code);
}

/** Copy one directory's regular files into `to`, skipping names that start with a dot. */
function copyTree(from: string, to: string): string[] {
    if (!existsSync(from)) return [];
    mkdirSync(to, { recursive: true });
    const copied: string[] = [];
    for (const entry of readdirSync(from, { withFileTypes: true })) {
        if (entry.name.startsWith('.')) continue;
        if (!entry.isFile()) continue;
        copyFileSync(join(from, entry.name), join(to, entry.name));
        copied.push(entry.name);
    }
    return copied;
}

function run(): void {
    const inputArg = flagValue('input', '/input');
    const inputFile = inputArg.endsWith('.json') ? inputArg : join(inputArg, 'snapshot.json');
    if (!existsSync(inputFile)) {
        fail(`token radar: no snapshot at ${inputFile}: pass --input <snapshot.json|directory> or mount the sealed /input\n`, 2);
    }
    const out = flagValue('output', process.env.MAKEFUN_OUTPUT_DIR ?? '/output');
    const snapshot = parseSnapshot(readFileSync(inputFile, 'utf8'));
    const { board, radar } = buildRadar(snapshot);
    const issue = boardIssue(board, snapshot);
    if (issue !== null) {
        fail(`token radar: the model wrote a board the gate refuses: ${issue}\n`, 1);
    }
    mkdirSync(out, { recursive: true });
    writeFileSync(join(out, 'board.json'), `${JSON.stringify({ rows: board })}\n`);
    writeFileSync(join(out, 'data.js'), dataScript(radar));
    copyTree(join(ROOT, 'dashboard'), join(out, 'dashboard'));
    const shots = copyTree(join(ROOT, 'screenshots'), join(out, 'screenshots'));
    if (shots.length < 3) {
        fail(`token radar: screenshots/ holds ${shots.length} image${shots.length === 1 ? '' : 's'}: hand in 3, the board, a detail view and a filtered view\n`, 1);
    }
    for (const name of shots) {
        if (!SHOT_NAME.test(name)) {
            fail(`token radar: screenshots/${name}: a name is letters, digits and . _ -, 1 to 128 characters\n`, 1);
        }
    }
    // The dossier is written last: the scorer rebuilds it from this /output and compares bytes.
    writeFileSync(join(out, 'dossier.json'), buildDossier(out, { text_max_bytes: TEXT_CAP_BYTES, screenshots: SHOT_LIMIT, dashboard: { max_files: 400, max_bytes: 4_194_304 } }));
    process.stdout.write(
        `token radar: ${snapshot.protocols.length} protocols, ${snapshot.watchlist.length} on the watchlist, ${board.length} rows scored (${radar.early_size} early, ${radar.live_size} live set aside, ${radar.set_aside_size} pre-token products set aside)\n` +
        `token radar: wrote ${join(out, 'board.json')}, ${join(out, 'data.js')}, ${join(out, 'dashboard')} (3 files), ${join(out, 'screenshots')} (${shots.length} images) and ${join(out, 'dossier.json')}\n`,
    );
}

run();
