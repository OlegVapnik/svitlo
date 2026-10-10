#!/usr/bin/env node
/**
 * DEV-ONLY manual CLI bridge for a one-off account API contract check.
 * It is not part of the production schedule flow and never obtains or solves Turnstile tokens.
 * Accept only a short-lived token supplied explicitly by a human with --token=<value>.
 * Production schedule imports use public POST /api/info_schedule (queue + date, no PII).
 * Account numbers and returned personal data are masked; nothing is stored in the database.
 * Run from apps/api: node scripts/operator-account.mjs --account=<account> --token=<manual-token>
 */
import { request } from 'playwright';

const BASE = process.env.OPERATOR_BASE_URL ?? 'https://interruptions.energy.cn.ua';
const UA =
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

/** Аргументи CLI: --key=value і флаги --key. */
function parseArgs(argv) {
  const out = {};
  for (const arg of argv.slice(2)) {
    const match = /^--([^=]+)(?:=(.*))?$/.exec(arg);
    if (!match) continue;
    out[match[1]] = match[2] ?? true;
  }
  return out;
}

/** Маскирует всё, что похоже на ПД: оставляет только буквы, пунктуацию и пробелы. */
function mask(value) {
  return String(value ?? '').replace(/\d/g, '•');
}

/** Маскирует номер рахунку: видны лишь первые две и последние две цифры. */
function maskAccount(account) {
  const s = String(account);
  return s.length <= 4 ? '•'.repeat(s.length) : `${s.slice(0, 2)}${'•'.repeat(s.length - 4)}${s.slice(-2)}`;
}

async function main() {
  const args = parseArgs(process.argv);
  const account = String(args.account ?? '').replace(/[\s\u00a0-]+/gu, '');
  if (!/^\d{9,12}$/.test(account)) {
    console.error('Вкажіть особовий рахунок: --account=<9–12 цифр>');
    process.exit(1);
  }
  const token = typeof args.token === 'string' ? args.token : '';
  if (!token) {
    console.error('Це dev-only ручна перевірка: передайте отриманий людиною токен через --token=<value>.');
    process.exit(1);
  }

  const ctx = await request.newContext({
    baseURL: BASE,
    extraHTTPHeaders: { 'User-Agent': UA, 'Content-Type': 'application/json' },
  });
  const result = { account: maskAccount(account), steps: {} };

  // Single, manual contract probe only; never use account lookup in the production schedule flow.
  const cr = await ctx.post('/api/code_review', { data: { old_account: account } });
  const crJson = await cr.json().catch(() => ({}));
  const aUser = crJson.aUser ?? {};
  result.steps.code_review = {
    http: cr.status(),
    status: crJson.status,
    address: mask(aUser.address),
    type_user: aUser.type_user,
  };
  console.log(`1) code_review (без капчі) → HTTP ${cr.status()} status=${crJson.status}`);
  if (aUser.address) console.log(`   адреса (номер будинку замасковано): ${mask(aUser.address)}`);
  if (crJson.status !== 'ok') console.log('   оператор не подтвердил проверяемую запись (сообщение ответа скрыто)');

  // Використовується лише токен, який людина явно передала через CLI.
  result.steps.turnstile = { token: 'provided-via-cli', length: token.length };
  console.log(`2) Передано ручний Turnstile-токен (довжина ${token.length})`);
  // Крок 2 — черга ГПВ за рахунком.
  const nq = await ctx.post('/api/number_queue/', { data: { search_param: account, token } });
  const nqJson = await nq.json().catch(() => ({}));
  const rows = (nqJson.list_grp ?? []).flat();
  const gpv = rows.filter((row) => Number(row.type_queue) === 4);
  result.steps.number_queue = {
    http: nq.status(),
    status: nqJson.status,
    rows: rows.map((r) => ({ queue: r.queue, type_queue: r.type_queue })),
  };
  console.log(`3) number_queue → HTTP ${nq.status()} status=${nqJson.status}; рядків: ${rows.length}`);
  if (gpv.length > 0) console.log(`   черга ГПВ: ${gpv.map((r) => r.queue).join(', ')}`);

  // Крок 3 — погодинний графік.
  const queue = typeof args.queue === 'string' ? args.queue : gpv[0] ? String(gpv[0].queue) : null;
  if (!queue) {
    console.log('\nЧергу не визначено (немає рядків type_queue=4) — передайте --queue=<код> вручну.');
    if (args.json) console.log(JSON.stringify(result, null, 2));
    await ctx.dispose();
    process.exit(3);
  }

  const date = typeof args.date === 'string' ? args.date : '';
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    console.error('Вкажіть дату перевірки: --date=YYYY-MM-DD');
    await ctx.dispose();
    process.exit(1);
  }
  const sp = await ctx.post('/api/info_schedule_part', { data: { queue, curr_dt: date, token } });
  const spJson = await sp.json().catch(() => ({}));
  result.steps.info_schedule_part = {
    http: sp.status(),
    status: spJson.status,
    intervalCount: Array.isArray(spJson.aData) ? spJson.aData.length : 0,
    stateCodes: spJson.aState && typeof spJson.aState === 'object' ? Object.keys(spJson.aState) : [],
  };
  console.log(`4) info_schedule_part (queue=${queue}, ${date}) → HTTP ${sp.status()} status=${spJson.status}`);
  if (spJson.aState) {
    for (const [code, state] of Object.entries(spJson.aState)) {
      console.log(`   стан ${code}: ${state.name} (${state.color})`);
    }
  }
  if (spJson.aData?.length) {
    for (const slot of spJson.aData) {
      const state = spJson.aState?.[slot.queue];
      console.log(`   ${slot.time_from}–${slot.time_to} → ${state ? state.name : 'стан ' + slot.queue}`);
    }
  } else if (spJson.error) {
    console.log('   оператор сообщил об ошибке (текст ответа скрыт)');
  } else {
    console.log('   оператор не має графіка на цю дату/чергу (aData: null)');
  }

  if (args.json) console.log(JSON.stringify(result, null, 2));
  await ctx.dispose();
}

main().catch((error) => {
  console.error(`Помилка: ${String(error.message)}`);
  process.exit(1);
});
