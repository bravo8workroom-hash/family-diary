// ─────────────────────────────────────────────────────────────
//  우리집 다이어리 — AI 부탁 처리 도구 (VS코드 담당 전용)
//
//  가족이 앱에서 걸어둔 부탁(캡처 정리)을 읽고,
//  처리한 결과를 앱 데이터에 넣는다. 클로드가 이 파일을 통해 일한다.
//
//    node tools/jobs.mjs list                  대기 중인 부탁 보기 (사진도 내려받음)
//    node tools/jobs.mjs apply <번호> <결과.json>   결과를 앱에 반영하고 완료 처리
//    node tools/jobs.mjs import <결과.json>         부탁 없이 바로 반영 (은행 거래내역 파일 등)
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
    },
    async remove(bucketPath) {
      const r = await fetch(`${cfg.url}/storage/v1/object/family-photos/${bucketPath}`, {
        method: 'DELETE',
        headers: { apikey: cfg.key, Authorization: 'Bearer ' + token }
      });
      return r.ok;
    }
  };
}

// Processed captures are deleted for good — both the photo store and the local copy.
// Two reasons: the owner's standing rule (source material is thrown away once applied),
// and double-entry protection — a capture left behind gets downloaded and applied twice.
// Failed jobs keep their photos (cmdFail) because they still have to be redone.
async function burnShots(db, job, id) {
  const shots = (job && job.payload && job.payload.photos) || [];
  let gone = 0;
  for (const sp of shots) if (await db.remove(sp)) gone++;
  const dir = path.join(INBOX, String(id));
  if (fs.existsSync(dir)) fs.rmSync(dir, { recursive: true, force: true });
  if (shots.length) {
    console.log(`  🔥 캡처 ${gone}/${shots.length}장 지웠습니다 (두 번 처리되지 않게)`);
    if (gone < shots.length) console.log('     ⚠ 못 지운 사진이 있습니다 — 다음 list 에 안 뜨지만 창고에는 남아 있습니다');
  }
  return gone;
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
// 앱의 고정비 「납부」가 만드는 줄은 memo 가 "롯데하이마트 할부 (고정비)" 라 회차가 없다.
// 이미 적어 둔 열쇠에 맞춰 준다 — 회차 없는 쪽은 후보가 딱 하나일 때만 잇는다.
const buyKeyFor = (s, B) => {
  const k = buyKey(s); if (!k) return '';
  const box = B || {};
  if (box[k]) return k;
  const bare = k.split('#')[0];
  if (k !== bare) return box[bare] ? bare : k;
  const hits = Object.keys(box).filter(x => x.indexOf(bare + '#') === 0);
  return hits.length === 1 ? hits[0] : k;
};

// 🏷️ 같은 구매처는 늘 같은 항목으로 (사장님 지시 2026-08-15).
// 가족이 앱에서 내역의 항목을 고치면 doc.catRules 에 「구매처 → 항목」이 적힌다.
// 반입하는 거래도 그 규칙을 따라야 한 건씩 다시 고치는 일이 안 생긴다.
// ⚠ 이 규칙은 money/index.html 의 catKey/catOf 와 똑같아야 한다 — 한쪽만 고치면 규칙을 비켜간다.
const catKey = s => String(s || '')
  .replace(/\(\s*\d{1,3}\s*\/\s*\d{1,3}\s*\)/g, '')
  .replace(/\([^)]*\)?/g, '')
  .replace(/[·\-_.,/\\]/g, '')
  .replace(/\s+/g, '').toLowerCase();
const catOf = (s, R) => {
  const box = R || {}, k = catKey(s);
  if (!k || k === '-') return '';
  if (box[k]) return box[k];
  // 비슷한 구매처: 한쪽 이름이 다른 쪽으로 시작하면 같은 가게로 본다 (gs25강남점 ≈ gs25).
  // 짧은 이름은 우연히 겹치므로 세 글자부터만 본다. 여럿이면 가장 긴(구체적인) 규칙이 이긴다.
  let best = '';
  for (const x of Object.keys(box)) {
    if (Math.min(x.length, k.length) < 3) continue;
    if ((k.indexOf(x) === 0 || x.indexOf(k) === 0) && x.length > best.length) best = x;
  }
  return best ? box[best] : '';
};

// 🧩 소분류 — 큰 분류를 먼저 잡고 그 안에서 가른다 (사장님 지시 2026-08-15).
// ⚠ 이름은 money/index.html 의 SUBS 와 글자까지 똑같아야 한다. 여기 없는 이름을 넣으면 앱이 버린다.
const SUBS = {
  '식비': ['외식비', '식재료비', '카페·간식', '배달'],
  '생활/마트': ['생활용품', '편의점', '통신비', '공과금', '미용·이발'],
  '교육': ['학원비', '교재·문구', '등록금', '체험·활동'],
  '교통': ['차량유지비', '대중교통', '택시', '통행료·주차'],
  '의료': ['병원', '약국', '보험', '건강검진'],
  '쇼핑': ['온라인쇼핑', '옷·신발', '가전·가구', '선물'],
  '문화/여가': ['구독·멤버십', '영화·공연', '취미', '운동'],
  '여행': ['숙박', '교통편', '현지경비'],
  '이체': [],
  '기타': ['경조사', '세금·수수료', '그 밖']
};
// 사장님이 앱에서 손수 더한 소분류(doc.subsAdd)도 정식 이름이다 — 버리면 방금 만든 항목이 사라진다.
// 문서를 읽는 자리에서 useDoc(doc) 을 부르고 나서 fitSub 을 써라 (사장님 지시 2026-08-15).
let SUBS_ADD = {};
const useDoc = doc => { const a = (doc || {}).subsAdd; SUBS_ADD = (a && typeof a === 'object') ? a : {}; };
const subsOf = c => (SUBS[c] || []).concat(
  (Array.isArray(SUBS_ADD[c]) ? SUBS_ADD[c] : []).filter(x => !(SUBS[c] || []).includes(x)));
const fitSub = (c, s) => (s && subsOf(c).includes(s)) ? s : '';
// 소분류도 구매처 규칙을 탄다 (앱에서 가족이 고른 것 = doc.subRules)
const subOf = (s, R) => catOf(s, R);

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
  if (jobs.some(j => j.kind === 'receipt' || j.kind === 'ledger')) {
    const rows = await db.get('family_state?id=eq.main&select=doc');
    D = rows.length ? rows[0].doc : null;
  }

  console.log('\n대기 중인 부탁 ' + jobs.length + '건');
  if (D) printLedgerContext(D);

  const seen = new Map(), dupJobs = [];
  for (const j of jobs) {
    const when = new Date(j.created_at).toLocaleString('ko-KR');
    console.log('─'.repeat(58));
    const KINDL = { receipt: '가계부 캡처 정리', report: '가계부 보고서 자세히', ledger: '🧑‍🏫 가계부 관리자 호출' };
    console.log(`[${j.id}] ${KINDL[j.kind] || j.kind}  ·  ${j.asked_by || '가족'}  ·  ${when}`);

    const p = j.payload || {};
    // 🧑‍🏫 관리자 호출 — 가족이 앱에서 부른 것. 답은 보고서(blocks)로 올린다.
    if (j.kind === 'ledger') {
      console.log(`     ${p.ym || ''} · ${p.summary || ''}`);
      console.log(`     물어본 것: ${p.ask ? p.ask : '(따로 없음 — 이번 달 살림을 훑어 달라는 뜻)'}`);
      if ((p.asks || []).length) console.log(`     아직 못 받은 자료: ${p.asks.map(z => z.label).join(' · ')}`);
      console.log(`     ※ 답은 report 와 같은 형식({title,stars,summary,blocks})으로 apply 하면 보고서함에 올라갑니다.`);
    }
    // 🧾 요청한 자료를 받은 캡처면 어느 요청 건인지 여기 찍힌다
    if ((p.reqs || []).length) {
      p.reqs.forEach(q => console.log(`     🧾 요청 답변: ${q.label}  (사진 ${(q.shots || []).join(',')}번)`));
    }
    // 📷 앱 「고치는 칸」에서 그 거래에 붙여 담은 캡처 — 어느 거래의 증빙인지 여기 찍힌다
    if ((p.tags || []).length) {
      p.tags.forEach(t => console.log(`     📷 사진 ${t.shot}번 = ${t.label}`));
    }
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
  const loans = accs.filter(a => a.kind === 'loan');

  console.log('\n     ── 우리집 계정 (거래마다 acc 에 이 이름을 그대로 적어라) ──');
  if (!accs.length) console.log('     (등록된 통장·카드가 없습니다 — acc 는 비워 두세요)');
  banks.forEach(a => console.log(`     🏦 ${a.name}${a.org ? ' · ' + a.org : ''}${a.purp ? ' · ' + (a.purp === 'custom' ? (a.purpTxt || '') : PURPL[a.purp] || '') : ''}`));
  cards.forEach(a => console.log(`     💳 ${a.name}${a.org ? ' · ' + a.org : ''}${a.day ? ' · 매월 ' + a.day + '일 결제' : ''}`));
  // 대출은 「빌린 돈은 수입이 아니다」의 짝이다 — 안 보여주면 담당이 또 수입으로 넣는다.
  loans.forEach(a => console.log(`     📉 ${a.name}${a.org ? ' · ' + a.org : ''} · 남은 원금 ${W(a.amt)}원${a.due ? ' · 만기 ' + a.due : ''}`));

  const all = D.fixed || [];
  const fx = all.filter(f => !f.stop), fxOff = all.filter(f => f.stop);
  const FQ = { w: '매주', m: '매월', q: '분기', h: '반년', y: '매년' };
  console.log('\n     ── 이미 등록된 고정비 (이 상호가 나오면 tx 에 fx:"이름" 을 붙여라) ──');
  if (!fx.length) console.log('     (아직 없습니다)');
  fx.forEach(f => console.log(`     🔁 ${f.name} · ${FQ[f.freq] || '매월'}${f.day ? ' ' + f.day + '일' : ''} · 보통 ${W(f.a)}원${f.vary ? '(변동)' : ''} · ${f.c} · ${f.pay}`));

  // 안 나가게 돼서 빠진 것들 — 새로 등록하지 마라. fx 로 납부만 찍으면 저절로 되살아난다.
  if (fxOff.length) {
    console.log('\n     ── ⏸ 그만 나가는 고정비 (이 상호가 또 나오면 새로 만들지 말고 fx 로 납부만 찍어라) ──');
    fxOff.forEach(f => console.log(`     ⏸ ${f.name} · ${f.stop}부터 안 나감 · 보통 ${W(f.a)}원 · ${f.c} · ${f.pay}`));
  }

  // 가족이 앱에서 직접 정한 「이 구매처는 이 항목」. 반입할 때 이게 c 를 이기므로 미리 보여 준다.
  const CR = D.catRules || {}, crK = Object.keys(CR), SR = D.subRules || {};
  if (crK.length) {
    console.log('\n     ── 🏷️ 구매처 항목 규칙 (가족이 직접 정함 · 반입 때 c 보다 이게 이긴다) ──');
    crK.sort().forEach(k => console.log(`     🏷️ ${k} → ${CR[k]}${SR[k] ? ' · ' + SR[k] : ''}`));
  }

  // 🧩 소분류 — 큰 분류를 먼저 잡고 그 안에서 가른다. 여기 없는 이름을 tx.sub 에 넣으면 앱이 버린다.
  console.log('\n     ── 🧩 쓸 수 있는 소분류 (tx 에 sub:"이름" · 대분류 c 와 짝이 맞아야 한다) ──');
  useDoc(D);
  Object.keys(SUBS).forEach(c => { if (subsOf(c).length) console.log(`     ${c} → ${subsOf(c).join(' · ')}`); });
  console.log('     예) 외식은 식비·외식비 · 마트 장보기는 식비·식재료비 · 주유와 차량용품은 교통·차량유지비');

  // 🧾 앱에 걸어 둔 자료 요청 — 아직 못 받은 것만. 받은·넘긴 것은 done 으로 빠져 여기 안 뜬다.
  const AK = (D.ledgerAsks || {}).items || [];
  if (AK.length) {
    console.log('\n     ── 🧾 가족에게 부탁해 둔 자료 (아직 못 받음) ──');
    AK.forEach(q => console.log(`     🧾 ${q.label}${q.why ? ' — ' + q.why : ''} · ${q.at || ''}`));
  }

  // 할부는 산 물건이 명세서 어디에도 없다 — 한 번 적어 두면 매달 내역에 함께 붙는다.
  const buys = D.installBuys || {}, byBuy = {}, buyOrder = [];
  for (const x of [...(D.tx || [])].sort((a, b) => String(a.d).localeCompare(String(b.d)))) {
    const k = buyKeyFor(x.memo, buys); if (!k) continue;
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

// 가계부 결과(JSON)를 앱 데이터에 얹는다. 가족이 건 부탁을 거치든, 통장 파일에서 바로 넣든 길은 이거 하나다.
//   { tx:[{d,a,ty,c,memo,pay,acc,fx,buy}], fixed:[{...}], accounts:[{name,kind,org,amt,day,purp}] }
//   acc = 어느 통장·카드인지 (list 가 알려준 이름) · fx = 이 거래가 갚은 고정비 이름
//   buy = 할부로 산 물건 (할부 거래에만. 한 번 넣으면 다음 달부터는 안 넣어도 앱이 이어 붙인다)
async function putLedger(db, result) {
  const list = result.tx || [];
  const newFixed = result.fixed || [];
  const newAccs = result.accounts || [];
  const newAsks = result.asks || [];
  if (!list.length && !newFixed.length && !newAccs.length && !newAsks.length) die('결과에 tx 항목이 없습니다.');
  return editDoc(db, doc => {
      doc.tx = doc.tx || []; doc.fixed = doc.fixed || [];
      doc.fixedPaid = doc.fixedPaid || {}; doc.accounts = doc.accounts || [];

      // ⓪ 새로 찾은 통장·카드 등록. 이름이 같은 게 이미 있으면 「잔액만」 최신으로 갈아끼운다 —
      //    통장 잔액은 언제나 방금 읽은 거래내역 쪽이 최신이다 (사장님 지시 2026-08-15 "현 통장 잔액에 맞출 것").
      let addedAcc = 0, updAcc = 0;
      for (const a of newAccs) {
        const nm = String(a.name || '').trim();
        if (!nm) continue;
        const had = doc.accounts.find(z => norm(z.name) === norm(nm));
        if (had) {
          if (a.amt !== undefined && a.amt !== null && a.amt !== '') {
            const v = Math.abs(Number(a.amt) || 0);
            if (v !== (Number(had.amt) || 0)) { had.amt = v; updAcc++; }
          }
          continue;
        }
        // 통장(bank) · 카드(card) 말고 대출(loan)도 있다 — 앱 🏦 자산이 순자산에서 빼는 칸이다.
        // 빌린 돈은 수입이 아니므로 거래로 넣지 말고 여기 「남은 원금」으로 올린다 (사장님 지시 2026-08-15).
        const K = ['bank', 'card', 'loan'].includes(a.kind) ? a.kind : 'bank';
        doc.accounts.push({
          id: uid(), kind: K, name: nm,
          org: String(a.org || '').trim(), amt: Math.abs(Number(a.amt) || 0),
          day: K === 'card' ? String(a.day || '') : '',
          due: K === 'loan' ? String(a.due || '') : '',
          purp: K === 'bank' ? (['salary', 'living', 'saving', 'emergency', 'invest', 'custom'].includes(a.purp) ? a.purp : 'living') : '',
          purpTxt: (K === 'bank' && a.purp === 'custom') ? String(a.purpTxt || '').trim() : ''
        });
        addedAcc++;
      }

      // ① 새로 찾은 되풀이 지출을 고정비로 등록 (이름이 같은 게 이미 있으면 건너뛴다)
      //    안 나가서 빠졌던 것(stop)이 다시 나오면 새로 만들지 않고 그 항목을 되살린다 — 안 그러면 같은 게 두 줄이 된다.
      let addedFx = 0, backFx = 0;
      for (const f of newFixed) {
        const nm = String(f.name || '').trim();
        if (!nm) continue;
        const same = doc.fixed.find(z => norm(z.name) === norm(nm));
        if (same) { if (same.stop) { delete same.stop; delete same.keepM; backFx++; } continue; }
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
      let paidN = 0, accN = 0, buyN = 0, ruleN = 0, subN = 0;
      useDoc(doc);   // 사장님이 앱에서 더한 소분류를 정식 이름으로 인정한다
      for (const x of list) {
        const id = uid(), d = x.d || today();
        const acc = findAcc(x.acc);
        // 가족이 앱에서 정해 둔 구매처 규칙이 있으면 그게 이긴다 — 사람이 직접 고친 뜻이라 짐작보다 세다
        const ruled = x.ty === 'tr' ? '' : catOf(x.memo, doc.catRules);
        if (ruled && ruled !== x.c) ruleN++;
        const cc = ruled || x.c || '기타';
        // 🧩 소분류: 가족이 정해 둔 규칙이 먼저, 없으면 결과 JSON 의 sub. 그 대분류에 없는 이름은 버린다.
        const ss = x.ty === 'tr' ? '' : (fitSub(cc, subOf(x.memo, doc.subRules)) || fitSub(cc, String(x.sub || '').trim()));
        if (ss) subN++;
        const rec = {
          id, d,
          ty: x.ty === 'in' ? 'in' : (x.ty === 'tr' ? 'tr' : 'out'),
          a: Math.abs(Number(x.a) || 0),
          c: cc, sub: ss, memo: x.memo || '-',
          pay: ['bank', 'card', 'cash'].includes(x.pay) ? x.pay : (acc ? acc.kind : 'bank')
        };
        if (acc) { rec.acc = acc.name; accN++; }
        doc.tx.push(rec);

        // ②-1 할부로 산 물건 — 앱이 매달 이 이름을 내역에 이어 붙인다
        const bk = buyKeyFor(rec.memo, doc.installBuys), buy = String(x.buy || '').trim();
        if (bk && buy) { doc.installBuys = doc.installBuys || {}; doc.installBuys[bk] = buy; buyN++; }

        // ③ 고정비를 갚은 거래면 그 달 납부로 표시 (앱 🔁 고정비 화면이 「납부 완료」로 바뀐다)
        if (x.fx && rec.ty === 'out') {
          const f = doc.fixed.find(z => norm(z.name) === norm(x.fx));
          const ym = d.slice(0, 7);
          if (f) {
            doc.fixedPaid[ym] = doc.fixedPaid[ym] || {};
            if (!doc.fixedPaid[ym][f.id]) { doc.fixedPaid[ym][f.id] = { a: rec.a, txId: id }; paidN++; }
            // 빠졌던 달의 납부가 뒤늦게 올라왔다 = 잘못 뺐던 것이다. 되살린다.
            if (f.stop && ym >= f.stop) { delete f.stop; delete f.keepM; backFx++; }
          }
        }
      }
      // 🧾 앱 「이 자료를 보내 주세요」 칸에 요청 올리기 — 무엇을 샀는지 모르는 결제의 캡처를 가족에게 부탁한다.
      //    items = 아직 안 받은 것만. 가족이 자료를 맡기거나 넘기면 앱이 done 으로 옮긴다 (여기서 다시 안 뜬다).
      let askN = 0;
      for (const q of (result.asks || [])) {
        const label = String(q.label || '').trim();
        if (!label) continue;
        doc.ledgerAsks = doc.ledgerAsks || { items: [], done: [] };
        doc.ledgerAsks.items = doc.ledgerAsks.items || [];
        doc.ledgerAsks.done = doc.ledgerAsks.done || [];
        const key = 'clerk|' + catKey(label);
        if (doc.ledgerAsks.items.some(z => z.key === key)) continue;
        if (doc.ledgerAsks.done.some(z => z.key === key)) continue;   // 이미 받았거나 넘긴 건 다시 묻지 않는다
        doc.ledgerAsks.items.push({ key, label, why: String(q.why || '').trim(), at: today() });
        askN++;
      }

      // 할부인데 산 물건을 아직 모르는 건은 숨기지 말고 티를 낸다 (가족에게 물어 앱에서 채우면 된다)
      const noBuy = list.filter(x => isInstall(x.memo)
        && !(doc.installBuys || {})[buyKeyFor(x.memo, doc.installBuys)]).length;
      return `가계부 ${list.length}건 넣음`
        + (subN ? ` · 🧩 소분류 ${subN}건` : '')
        + (askN ? ` · 🧾 자료 요청 ${askN}건 올림` : '')
        + (addedAcc ? ` · 통장/카드 ${addedAcc}개 등록` : '')
        + (updAcc ? ` · 통장 잔액 ${updAcc}개 갱신` : '')
        + (accN ? ` · ${accN}건 계정 구분` : '')
        + (addedFx ? ` · 고정비 ${addedFx}건 새로 등록` : '')
        + (backFx ? ` · ⏸ 빠졌던 고정비 ${backFx}건 되살림` : '')
        + (paidN ? ` · 고정비 납부 ${paidN}건 표시` : '')
        + (buyN ? ` · 할부 산 물건 ${buyN}건 기록` : '')
        + (ruleN ? ` · 🏷️ 구매처 규칙대로 항목 ${ruleN}건 고침` : '')
        + (noBuy ? ` · ⚠ 할부 ${noBuy}건은 산 물건이 비어 있음(가족에게 물어보세요)` : '');
  });
}

async function cmdApply(db, id, file) {
  if (!fs.existsSync(file)) die('결과 파일을 찾을 수 없습니다: ' + file);
  const result = JSON.parse(fs.readFileSync(file, 'utf8'));
  const rows = await db.get(`family_jobs?id=eq.${id}&select=*`);
  if (!rows.length) die(id + '번 부탁을 찾을 수 없습니다.');
  const job = rows[0];

  let note = '';
  // 🧑‍🏫 관리자 호출은 두 길 다 열려 있다 — 답만 올리면 보고서로, 자료도 함께 고쳤으면 가계부에도 반영한다.
  if (job.kind === 'ledger' && !Array.isArray(result.blocks)) {
    note = await putLedger(db, result);
  } else if (job.kind === 'receipt') {
    note = await putLedger(db, result);
  } else if (job.kind === 'report' || job.kind === 'ledger') {
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
  await burnShots(db, job, id);
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

// 가족이 앱에 부탁을 걸지 않고 자료를 바로 건네준 경우 (은행에서 내려받은 거래내역 파일 등).
// 부탁 번호 없이 결과 JSON 하나만 앱에 얹는다 — 형식은 apply 와 똑같다.
async function cmdImport(db, file) {
  if (!fs.existsSync(file)) die('결과 파일을 찾을 수 없습니다: ' + file);
  const note = await putLedger(db, JSON.parse(fs.readFileSync(file, 'utf8')));
  console.log('\n[넣음] ' + note + '\n');
}

// 데이터를 바꾸지 않고 부탁만 닫는다 (같은 사진이 여러 번 올라온 경우 등)
async function cmdDone(db, id, note) {
  const rows = await db.get(`family_jobs?id=eq.${id}&select=*`);
  await db.patch(`family_jobs?id=eq.${id}`, { status: '완료', note: note || '따로 정리했어요', done_at: new Date().toISOString() });
  await burnShots(db, rows[0], id);
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
else if (cmd === 'import') { if (!a1) die('사용법: node tools/jobs.mjs import <결과.json>'); await cmdImport(db, a1); }
else if (cmd === 'done') { if (!a1) die('사용법: node tools/jobs.mjs done <번호> "메모"'); await cmdDone(db, a1, a2); }
else if (cmd === 'fail') { if (!a1) die('사용법: node tools/jobs.mjs fail <번호> "이유"'); await cmdFail(db, a1, a2); }
else console.log('\n사용법:\n  node tools/jobs.mjs list\n  node tools/jobs.mjs state                    (지금 가계부 상태만 보기)\n  node tools/jobs.mjs apply <번호> <결과.json>\n  node tools/jobs.mjs import <결과.json>       (부탁 번호 없이 바로 넣기 — 은행 거래내역 파일 등)\n  node tools/jobs.mjs done  <번호> "메모"   (데이터 변경 없이 닫기 — 겹친 사진 등)\n  node tools/jobs.mjs fail  <번호> "이유"\n');
