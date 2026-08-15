// ─────────────────────────────────────────────────────────────
//  우리집 다이어리 — AI 부탁 처리 도구 (VS코드 담당 전용)
//
//  가족이 앱에서 걸어둔 부탁(캡처 정리)을 읽고,
//  처리한 결과를 앱 데이터에 넣는다. 클로드가 이 파일을 통해 일한다.
//
//    node tools/jobs.mjs list                  대기 중인 부탁 보기 (사진도 내려받음)
//    node tools/jobs.mjs apply <번호> <결과.json>   결과를 앱에 반영하고 완료 처리
//    node tools/jobs.mjs fail  <번호> "이유"        처리 못 한 이유 남기기
//
//  접속 정보: config.js(주소·공개키) + .env.local(가족 계정 이메일·비밀번호)
//  .env.local 은 git에 올라가지 않는다.
// ─────────────────────────────────────────────────────────────
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const INBOX = path.join(ROOT, 'tools', '_inbox');

function die(msg) { console.error('\n[막힘] ' + msg + '\n'); process.exit(1); }

function readConfig() {
  const src = fs.readFileSync(path.join(ROOT, 'config.js'), 'utf8');
  const url = (src.match(/url:\s*'([^']*)'/) || [])[1];
  const key = (src.match(/anonKey:\s*'([^']*)'/) || [])[1];
  if (!url || !key) die('config.js 에 Supabase 주소와 키가 아직 비어 있습니다.');

  const envPath = path.join(ROOT, '.env.local');
  if (!fs.existsSync(envPath)) {
    die('.env.local 파일이 없습니다.\n     .env.local.example 를 복사해 가족 계정 이메일·비밀번호를 적어주세요.');
  }
  const env = {};
  for (const line of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z_]+)\s*=\s*(.*?)\s*$/);
    if (m) env[m[1]] = m[2].replace(/^['"]|['"]$/g, '');
  }
  if (!env.FAMILY_EMAIL || !env.FAMILY_PASSWORD) die('.env.local 에 FAMILY_EMAIL / FAMILY_PASSWORD 가 필요합니다.');
  return { url, key, email: env.FAMILY_EMAIL, password: env.FAMILY_PASSWORD };
}

async function signIn(cfg) {
  const r = await fetch(`${cfg.url}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { apikey: cfg.key, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: cfg.email, password: cfg.password })
  });
  if (!r.ok) die('가족 계정 로그인 실패 (' + r.status + '). .env.local 의 이메일·비밀번호를 확인해 주세요.');
  return (await r.json()).access_token;
}

function api(cfg, token) {
  const H = { apikey: cfg.key, Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' };
  return {
    async get(q) {
      const r = await fetch(`${cfg.url}/rest/v1/${q}`, { headers: H });
      if (!r.ok) die('읽기 실패 (' + r.status + '): ' + (await r.text()));
      return r.json();
    },
    async patch(q, body, prefer) {
      const r = await fetch(`${cfg.url}/rest/v1/${q}`, {
        method: 'PATCH',
        headers: { ...H, Prefer: prefer || 'return=representation' },
        body: JSON.stringify(body)
      });
      if (!r.ok) die('쓰기 실패 (' + r.status + '): ' + (await r.text()));
      return r.json();
    },
    async download(bucketPath, dest) {
      const r = await fetch(`${cfg.url}/storage/v1/object/family-photos/${bucketPath}`, {
        headers: { apikey: cfg.key, Authorization: 'Bearer ' + token }
      });
      if (!r.ok) return false;
      fs.writeFileSync(dest, Buffer.from(await r.arrayBuffer()));
      return true;
    }
  };
}

const uid = () => Date.now() + '-' + Math.random().toString(36).slice(2, 7);
const today = () => { const d = new Date(); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); };
const W = n => Number(n || 0).toLocaleString('ko-KR');

// 상호명 비교용 — 공백·꼬리표를 지우고 소문자로 맞춘다.
//   "SK텔레콤 " ≡ "sk텔레콤(고정비)"
//   할부 회차는 달마다 바뀌므로 지운다 — 안 지우면 "하이마트 할부 (35/36)"과 "(36/36)"이 남남이 되어
//   되풀이 탐지가 죽고 매달 새 고정비가 생긴다.
const norm = s => String(s || '')
  .replace(/\(고정비\)/g, '')
  .replace(/\(\s*\d{1,3}\s*\/\s*\d{1,3}\s*\)/g, '')
  .replace(/\s+/g, '').toLowerCase();

// 할부는 「무엇을 샀는지」를 꼭 남긴다 (사장님 지시 2026-08-15).
// 명세서에는 가게 이름만 찍히므로, 산 물건은 doc.installBuys 에 한 번만 적어 두고
// 아래 열쇠로 이어 매달 내역에 저절로 따라붙게 한다. 열쇠에 총 회차를 남겨
// 같은 가게에서 두 번 할부해도 서로 다른 물건으로 갈라지게 한다.
// ⚠ 이 규칙은 money/index.html 의 buyKey 와 똑같아야 한다 — 한쪽만 고치면 물건 이름이 사라진다.
const isInstall = s => /할부/.test(String(s || ''));
const buyKey = s => {
  const v = String(s || ''); if (!isInstall(v)) return '';
  const m = v.match(/\(\s*\d{1,3}\s*\/\s*(\d{1,3})\s*\)/);
  return norm(v) + (m ? '#' + m[1] : '');
};

// 되풀이 후보 — 같은 상호가 서로 다른 달에 2번 이상 나간 것 중, 아직 고정비로 등록 안 된 것
function repeatCandidates(D) {
  const known = new Set((D.fixed || []).map(f => norm(f.name)));
  const g = {};
  for (const x of (D.tx || [])) {
    if (x.ty !== 'out') continue;
    const k = norm(x.memo);
    if (!k || k === '-' || known.has(k)) continue;
    (g[k] = g[k] || []).push(x);
  }
  return Object.values(g).map(list => {
    const months = [...new Set(list.map(x => x.d.slice(0, 7)))].sort();
    const amts = list.map(x => Number(x.a) || 0);
    const days = list.map(x => Number(x.d.slice(8, 10)) || 1);
    const last = list.slice().sort((a, b) => a.d.localeCompare(b.d)).pop();
    return {
      name: last.memo, months, n: list.length,
      avg: Math.round(amts.reduce((s, v) => s + v, 0) / amts.length),
      min: Math.min(...amts), max: Math.max(...amts),
      day: Math.round(days.reduce((s, v) => s + v, 0) / days.length),
      c: last.c, pay: last.pay || 'card'
    };
  }).filter(r => r.months.length >= 2).sort((a, b) => b.months.length - a.months.length || b.avg - a.avg);
}

// 앱 데이터는 한 행에 통째로 있다. 다른 가족이 그 사이에 저장했으면
// rev 가 어긋나므로, 최신 문서를 다시 읽어 같은 변경을 얹어 재시도한다.
async function editDoc(db, change) {
  for (let i = 0; i < 4; i++) {
    const rows = await db.get('family_state?id=eq.main&select=doc,rev');
    if (!rows.length) die('앱 데이터가 아직 없습니다. 가족 중 한 명이 앱에 먼저 한 번 들어와야 합니다.');
    const { doc, rev } = rows[0];
    const summary = change(doc);
    const out = await db.patch(
      `family_state?id=eq.main&rev=eq.${rev}`,
      { doc, rev: rev + 1, updated_at: new Date().toISOString() }
    );
    if (out.length) return summary;
    console.log('  (다른 가족이 방금 저장했어요 — 최신 내용에 다시 얹습니다)');
  }
  die('저장이 계속 밀렸습니다. 잠시 뒤 다시 시도해 주세요.');
}

// ── 명령 ─────────────────────────────────────────────────────
async function cmdList(db) {
  const jobs = await db.get(`family_jobs?status=eq.${encodeURIComponent('대기')}&order=created_at.asc&select=*`);
  if (!jobs.length) { console.log('\n대기 중인 부탁이 없습니다.\n'); return; }

  // 캡처 정리에는 「지금 우리집 상태」가 필요하다 — 어느 통장·카드인지, 이미 등록된 고정비가 뭔지,
  // 되풀이되는 지출이 뭔지 모르면 계정별 구분도 고정비 판정도 못 한다. 부탁에 담긴 옛 값 대신 최신 문서를 읽는다.
  let D = null;
  if (jobs.some(j => j.kind === 'receipt')) {
    const rows = await db.get('family_state?id=eq.main&select=doc');
    D = rows.length ? rows[0].doc : null;
  }

  console.log('\n대기 중인 부탁 ' + jobs.length + '건');
  if (D) printLedgerContext(D);

  const seen = new Map(), dupJobs = [];
  for (const j of jobs) {
    const when = new Date(j.created_at).toLocaleString('ko-KR');
    console.log('─'.repeat(58));
    const KINDL = { receipt: '가계부 캡처 정리', report: '가계부 보고서 자세히' };
    console.log(`[${j.id}] ${KINDL[j.kind] || j.kind}  ·  ${j.asked_by || '가족'}  ·  ${when}`);

    const p = j.payload || {};
    if (j.kind === 'report') {
      console.log(`     ${p.kind === 'now' ? '현재' : '월'} 보고서 · ${p.ym || ''} · ${p.title || ''}`);
      console.log(`     앱이 계산한 요약: ${p.summary || '(없음)'}`);
      console.log(`     ※ 앱 계산본은 payload.blocks 에 그대로 들어 있습니다 — 숫자는 그걸 쓰고 해석만 새로 쓰세요.`);
    }
    const shots = p.photos || [];
    if (shots.length) {
      const dir = path.join(INBOX, String(j.id));
      fs.mkdirSync(dir, { recursive: true });
      let n = 0, dupOf = null;
      for (const sp of shots) {
        const dest = path.join(dir, String(++n) + '.jpg');
        const ok = await db.download(sp, dest);
        if (!ok) { console.log(`     사진 ${n}: (내려받기 실패)`); continue; }
        // 같은 사진을 여러 번 맡기면 가계부에 없는 지출이 부풀어 들어간다 — 여기서 막는다
        const sig = crypto.createHash('md5').update(fs.readFileSync(dest)).digest('hex');
        const first = seen.get(sig);
        if (first) { dupOf = dupOf || first; console.log(`     사진 ${n}: ${path.relative(ROOT, dest)}  ⚠ ${first}번과 같은 사진`); }
        else { seen.set(sig, j.id); console.log(`     사진 ${n}: ${path.relative(ROOT, dest)}`); }
      }
      if (dupOf) {
        dupJobs.push(j.id);
        console.log(`     ⚠ 이 부탁은 ${dupOf}번과 겹칩니다 — 정리하지 말고 아래 명령으로 닫으세요:`);
        console.log(`        node tools/jobs.mjs done ${j.id} "${dupOf}번과 같은 사진이라 함께 정리했어요"`);
      }
    }
  }
  console.log('─'.repeat(58));
  if (dupJobs.length) {
    console.log(`\n⚠ 겹치는 부탁 ${dupJobs.length}건: ${dupJobs.join(', ')}번`);
    console.log('  같은 사진이라 그대로 정리하면 없는 지출이 부풀어 들어갑니다. 위 done 명령으로 닫으세요.');
  }
  console.log('');
}

// 캡처를 읽는 담당이 「계정별 구분」과 「고정비 판정」을 할 수 있게 지금 상태를 붙여 준다.
function printLedgerContext(D) {
  const PURPL = { salary: '급여', living: '생활비', saving: '저축', emergency: '비상금', invest: '투자', custom: '' };
  const accs = D.accounts || [];
  const banks = accs.filter(a => a.kind === 'bank'), cards = accs.filter(a => a.kind === 'card');

  console.log('\n     ── 우리집 계정 (거래마다 acc 에 이 이름을 그대로 적어라) ──');
  if (!accs.length) console.log('     (등록된 통장·카드가 없습니다 — acc 는 비워 두세요)');
  banks.forEach(a => console.log(`     🏦 ${a.name}${a.org ? ' · ' + a.org : ''}${a.purp ? ' · ' + (a.purp === 'custom' ? (a.purpTxt || '') : PURPL[a.purp] || '') : ''}`));
  cards.forEach(a => console.log(`     💳 ${a.name}${a.org ? ' · ' + a.org : ''}${a.day ? ' · 매월 ' + a.day + '일 결제' : ''}`));

  const fx = D.fixed || [];
  const FQ = { w: '매주', m: '매월', q: '분기', h: '반년', y: '매년' };
  console.log('\n     ── 이미 등록된 고정비 (이 상호가 나오면 tx 에 fx:"이름" 을 붙여라) ──');
  if (!fx.length) console.log('     (아직 없습니다)');
  fx.forEach(f => console.log(`     🔁 ${f.name} · ${FQ[f.freq] || '매월'}${f.day ? ' ' + f.day + '일' : ''} · 보통 ${W(f.a)}원${f.vary ? '(변동)' : ''} · ${f.c} · ${f.pay}`));

  // 할부는 산 물건이 명세서 어디에도 없다 — 한 번 적어 두면 매달 내역에 함께 붙는다.
  const buys = D.installBuys || {}, byBuy = {}, buyOrder = [];
  for (const x of [...(D.tx || [])].sort((a, b) => String(a.d).localeCompare(String(b.d)))) {
    const k = buyKey(x.memo); if (!k) continue;
    if (!byBuy[k]) { byBuy[k] = { name: x.memo, months: [] }; buyOrder.push(k); }
    byBuy[k].name = x.memo; byBuy[k].months.push(String(x.d).slice(0, 7));
  }
  console.log('\n     ── 할부 (tx 에 buy:"산 물건" 을 붙여라 · 한 번 붙이면 매달 저절로 따라붙는다) ──');
  if (!buyOrder.length) console.log('     (할부 거래가 없습니다)');
  buyOrder.forEach(k => {
    const v = byBuy[k], ms = [...new Set(v.months)].sort().join(',');
    console.log(buys[k]
      ? `     📦 ${v.name} — ${buys[k]} · ${ms}`
      : `     ⚠ ${v.name} — 산 물건이 안 적혀 있음 (가족에게 물어보고 buy 로 넣어라) · ${ms}`);
  });

  const rc = repeatCandidates(D).slice(0, 12);
  console.log('\n     ── 되풀이 후보 (아직 고정비 아님 · 이번 캡처에도 또 나오면 fixed 로 등록해라) ──');
  if (!rc.length) console.log('     (되풀이로 보이는 지출이 아직 없습니다)');
  rc.forEach(r => console.log(`     · ${r.name} — ${r.months.length}개월(${r.months.join(',')}) · 보통 ${W(r.avg)}원${r.min !== r.max ? `(${W(r.min)}~${W(r.max)})` : ''} · 보통 ${r.day}일 · ${r.c} · ${r.pay}`));
  console.log('');
}

async function cmdApply(db, id, file) {
  if (!fs.existsSync(file)) die('결과 파일을 찾을 수 없습니다: ' + file);
  const result = JSON.parse(fs.readFileSync(file, 'utf8'));
  const rows = await db.get(`family_jobs?id=eq.${id}&select=*`);
  if (!rows.length) die(id + '번 부탁을 찾을 수 없습니다.');
  const job = rows[0];

  let note = '';
  if (job.kind === 'receipt') {
    // 결과 형식: { tx:[{d,a,ty,c,memo,pay,acc,fx,buy}], fixed:[{...}], accounts:[{name,kind,org,day,purp}] }
    //   acc = 어느 통장·카드인지 (list 가 알려준 이름) · fx = 이 거래가 갚은 고정비 이름
    //   buy = 할부로 산 물건 (할부 거래에만. 한 번 넣으면 다음 달부터는 안 넣어도 앱이 이어 붙인다)
    const list = result.tx || [];
    const newFixed = result.fixed || [];
    const newAccs = result.accounts || [];
    if (!list.length && !newFixed.length && !newAccs.length) die('결과에 tx 항목이 없습니다.');
    note = await editDoc(db, doc => {
      doc.tx = doc.tx || []; doc.fixed = doc.fixed || [];
      doc.fixedPaid = doc.fixedPaid || {}; doc.accounts = doc.accounts || [];

      // ⓪ 캡처에서 새로 찾은 통장·카드 등록 (이름이 같은 게 이미 있으면 건너뛴다)
      let addedAcc = 0;
      for (const a of newAccs) {
        const nm = String(a.name || '').trim();
        if (!nm || doc.accounts.some(z => norm(z.name) === norm(nm))) continue;
        doc.accounts.push({
          id: uid(), kind: a.kind === 'card' ? 'card' : 'bank', name: nm,
          org: String(a.org || '').trim(), amt: Math.abs(Number(a.amt) || 0),
          day: a.kind === 'card' ? String(a.day || '') : '',
          purp: a.kind === 'card' ? '' : (['salary', 'living', 'saving', 'emergency', 'invest', 'custom'].includes(a.purp) ? a.purp : 'living'),
          purpTxt: a.purp === 'custom' ? String(a.purpTxt || '').trim() : ''
        });
        addedAcc++;
      }

      // ① 새로 찾은 되풀이 지출을 고정비로 등록 (이름이 같은 게 이미 있으면 건너뛴다)
      let addedFx = 0;
      for (const f of newFixed) {
        const nm = String(f.name || '').trim();
        if (!nm || doc.fixed.some(z => norm(z.name) === norm(nm))) continue;
        const q = ['w', 'm', 'q', 'h', 'y'].includes(f.freq) ? f.freq : 'm';
        doc.fixed.push({
          id: uid(), name: nm, a: Math.abs(Number(f.a) || 0), freq: q,
          day: q === 'w' ? null : Math.min(31, Math.max(1, Number(f.day) || 1)),
          wd: q === 'w' ? (Number(f.wd) || 0) : null,
          mo: ['q', 'h', 'y'].includes(q) ? Math.min(12, Math.max(1, Number(f.mo) || 1)) : null,
          c: f.c || '기타', pay: ['bank', 'card', 'cash'].includes(f.pay) ? f.pay : 'card',
          vary: f.vary ? 1 : 0
        });
        addedFx++;
      }

      // ② 거래 넣기 — acc 는 등록된 통장·카드 이름으로 맞춰 붙인다
      const findAcc = v => {
        const k = norm(v); if (!k) return null;
        return doc.accounts.find(a => a.id === v)
          || doc.accounts.find(a => norm(a.name) === k)
          || doc.accounts.find(a => norm(a.name).includes(k) || k.includes(norm(a.name)))
          || null;
      };
      let paidN = 0, accN = 0, buyN = 0;
      for (const x of list) {
        const id = uid(), d = x.d || today();
        const acc = findAcc(x.acc);
        const rec = {
          id, d,
          ty: x.ty === 'in' ? 'in' : (x.ty === 'tr' ? 'tr' : 'out'),
          a: Math.abs(Number(x.a) || 0),
          c: x.c || '기타', memo: x.memo || '-',
          pay: ['bank', 'card', 'cash'].includes(x.pay) ? x.pay : (acc ? acc.kind : 'bank')
        };
        if (acc) { rec.acc = acc.name; accN++; }
        doc.tx.push(rec);

        // ②-1 할부로 산 물건 — 앱이 매달 이 이름을 내역에 이어 붙인다
        const bk = buyKey(rec.memo), buy = String(x.buy || '').trim();
        if (bk && buy) { doc.installBuys = doc.installBuys || {}; doc.installBuys[bk] = buy; buyN++; }

        // ③ 고정비를 갚은 거래면 그 달 납부로 표시 (앱 🔁 고정비 화면이 「납부 완료」로 바뀐다)
        if (x.fx && rec.ty === 'out') {
          const f = doc.fixed.find(z => norm(z.name) === norm(x.fx));
          const ym = d.slice(0, 7);
          if (f) {
            doc.fixedPaid[ym] = doc.fixedPaid[ym] || {};
            if (!doc.fixedPaid[ym][f.id]) { doc.fixedPaid[ym][f.id] = { a: rec.a, txId: id }; paidN++; }
          }
        }
      }
      // 할부인데 산 물건을 아직 모르는 건은 숨기지 말고 티를 낸다 (가족에게 물어 앱에서 채우면 된다)
      const noBuy = list.filter(x => isInstall(x.memo) && !(doc.installBuys || {})[buyKey(x.memo)]).length;
      return `가계부 ${list.length}건 넣음`
        + (addedAcc ? ` · 통장/카드 ${addedAcc}개 등록` : '')
        + (accN ? ` · ${accN}건 계정 구분` : '')
        + (addedFx ? ` · 고정비 ${addedFx}건 새로 등록` : '')
        + (paidN ? ` · 고정비 납부 ${paidN}건 표시` : '')
        + (buyN ? ` · 할부 산 물건 ${buyN}건 기록` : '')
        + (noBuy ? ` · ⚠ 할부 ${noBuy}건은 산 물건이 비어 있음(가족에게 물어보세요)` : '');
    });
  } else if (job.kind === 'report') {
    // 결과 형식: { title, stars, summary, blocks:[{t,v,h1,h2,h3,rows}] }
    // t 는 h(소제목) · p(문단) · stat(※수치) · cmp(◐비교) · judge(→판단) · table · do(▶실행)
    if (!Array.isArray(result.blocks) || !result.blocks.length) die('결과에 blocks 항목이 없습니다.');
    const p = job.payload || {};
    note = await editDoc(db, doc => {
      doc.moneyReports = doc.moneyReports || [];
      const no = doc.moneyReports.reduce((mx, r) => Math.max(mx, Number(r.no) || 0), 0) + 1;
      doc.moneyReports.unshift({
        id: uid(), no, kind: p.kind === 'now' ? 'now' : 'month', ym: p.ym || today().slice(0, 7),
        date: today(), title: result.title || p.title || '가계부 보고서',
        stars: Math.min(5, Math.max(1, Number(result.stars) || 3)),
        summary: result.summary || p.summary || '', blocks: result.blocks, by: '담당'
      });
      return `보고서 #${no} 올림 · ${result.title || p.title || ''}`;
    });
  } else {
    die('모르는 부탁 종류입니다: ' + job.kind);
  }

  await db.patch(`family_jobs?id=eq.${id}`, { status: '완료', note, done_at: new Date().toISOString() });
  const dir = path.join(INBOX, String(id));
  if (fs.existsSync(dir)) fs.rmSync(dir, { recursive: true, force: true });
  console.log('\n[완료] ' + id + '번 · ' + note + '\n');
}

// 대기 부탁이 없어도 지금 가계부 상태를 본다 (담당이 확인용으로, 그리고 도구 점검용으로)
async function cmdState(db) {
  const rows = await db.get('family_state?id=eq.main&select=doc');
  if (!rows.length) die('앱 데이터가 아직 없습니다.');
  const D = rows[0].doc;
  console.log('\n거래 ' + (D.tx || []).length + '건 · 통장/카드 ' + (D.accounts || []).length
    + '개 · 고정비 ' + (D.fixed || []).length + '건');
  printLedgerContext(D);
}

// 데이터를 바꾸지 않고 부탁만 닫는다 (같은 사진이 여러 번 올라온 경우 등)
async function cmdDone(db, id, note) {
  await db.patch(`family_jobs?id=eq.${id}`, { status: '완료', note: note || '따로 정리했어요', done_at: new Date().toISOString() });
  const dir = path.join(INBOX, String(id));
  if (fs.existsSync(dir)) fs.rmSync(dir, { recursive: true, force: true });
  console.log('[닫음] ' + id + '번 · ' + (note || ''));
}

async function cmdFail(db, id, reason) {
  await db.patch(`family_jobs?id=eq.${id}`, { status: '실패', note: reason || '처리하지 못했습니다', done_at: new Date().toISOString() });
  console.log('\n[실패로 표시] ' + id + '번 · ' + (reason || '') + '\n');
}

// ── 시작 ─────────────────────────────────────────────────────
const [cmd, a1, a2] = process.argv.slice(2);
const cfg = readConfig();
const db = api(cfg, await signIn(cfg));

if (cmd === 'list') await cmdList(db);
else if (cmd === 'state') await cmdState(db);
else if (cmd === 'apply') { if (!a1 || !a2) die('사용법: node tools/jobs.mjs apply <번호> <결과.json>'); await cmdApply(db, a1, a2); }
else if (cmd === 'done') { if (!a1) die('사용법: node tools/jobs.mjs done <번호> "메모"'); await cmdDone(db, a1, a2); }
else if (cmd === 'fail') { if (!a1) die('사용법: node tools/jobs.mjs fail <번호> "이유"'); await cmdFail(db, a1, a2); }
else console.log('\n사용법:\n  node tools/jobs.mjs list\n  node tools/jobs.mjs state                    (지금 가계부 상태만 보기)\n  node tools/jobs.mjs apply <번호> <결과.json>\n  node tools/jobs.mjs done  <번호> "메모"   (데이터 변경 없이 닫기 — 겹친 사진 등)\n  node tools/jobs.mjs fail  <번호> "이유"\n');
