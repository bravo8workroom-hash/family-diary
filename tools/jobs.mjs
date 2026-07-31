// ─────────────────────────────────────────────────────────────
//  우리집 다이어리 — AI 부탁 처리 도구 (VS코드 담당 전용)
//
//  가족이 앱에서 걸어둔 부탁(캡처 정리 / 퀴즈 만들기)을 읽고,
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

  console.log('\n대기 중인 부탁 ' + jobs.length + '건\n');
  for (const j of jobs) {
    const when = new Date(j.created_at).toLocaleString('ko-KR');
    console.log('─'.repeat(58));
    console.log(`[${j.id}] ${j.kind === 'receipt' ? '가계부 캡처 정리' : '학습 퀴즈 만들기'}  ·  ${j.asked_by || '가족'}  ·  ${when}`);

    const p = j.payload || {};
    if (j.kind === 'quiz') {
      console.log(`     과목 ${p.subjLabel} / 방식 ${p.mode === 'spell' ? '영어 스펠링' : '4지선다'} / 난이도 ${p.lv} / ${p.n}문항`);
      console.log(`     범위: ${p.topic || '(범위 안 적음 — 교과 기본 내용으로)'}`);
      console.log(`     제목: ${p.title || '(비어 있음 — 알아서 지어주세요)'} / 목표 ${p.goal}점 / 아이 ${p.kid}`);
    }
    const shots = p.photos || [];
    if (shots.length) {
      const dir = path.join(INBOX, String(j.id));
      fs.mkdirSync(dir, { recursive: true });
      let n = 0;
      for (const sp of shots) {
        const dest = path.join(dir, String(++n) + '.jpg');
        const ok = await db.download(sp, dest);
        console.log(`     사진 ${n}: ${ok ? path.relative(ROOT, dest) : '(내려받기 실패)'}`);
      }
      if (p.accounts && p.accounts.length) {
        console.log('     우리 통장: ' + p.accounts.map(a => `${a.name}(${a.purp || '일반'}${a.org ? ', ' + a.org : ''})`).join(', '));
      }
    }
  }
  console.log('─'.repeat(58) + '\n');
}

async function cmdApply(db, id, file) {
  if (!fs.existsSync(file)) die('결과 파일을 찾을 수 없습니다: ' + file);
  const result = JSON.parse(fs.readFileSync(file, 'utf8'));
  const rows = await db.get(`family_jobs?id=eq.${id}&select=*`);
  if (!rows.length) die(id + '번 부탁을 찾을 수 없습니다.');
  const job = rows[0];

  let note = '';
  if (job.kind === 'receipt') {
    const list = result.tx || [];
    if (!list.length) die('결과에 tx 항목이 없습니다.');
    note = await editDoc(db, doc => {
      doc.tx = doc.tx || [];
      for (const x of list) {
        doc.tx.push({
          id: uid(), d: x.d || today(),
          ty: x.ty === 'in' ? 'in' : (x.ty === 'tr' ? 'tr' : 'out'),
          a: Math.abs(Number(x.a) || 0),
          c: x.c || '기타', memo: x.memo || '-',
          pay: ['bank', 'card', 'cash'].includes(x.pay) ? x.pay : 'bank'
        });
      }
      return `가계부 ${list.length}건 넣음`;
    });
  } else if (job.kind === 'quiz') {
    const q = result.quiz;
    if (!q || !(q.items || []).length) die('결과에 quiz.items 가 없습니다.');
    const p = job.payload || {};
    note = await editDoc(db, doc => {
      const rec = {
        id: uid(), k: q.k || p.kid, subj: q.subj || p.subj, mode: q.mode || p.mode,
        lv: q.lv || p.lv, title: q.title || p.title || (p.subjLabel + ' 퀴즈'),
        goal: q.goal || p.goal || 80, tries: q.tries || p.tries || 3,
        think: q.think || p.think || 25, cool: q.cool != null ? q.cool : (p.cool != null ? p.cool : 10),
        rw: q.rw || p.rw || { e: '🌟', n: 1 }, fee: q.fee || p.fee || { e: '🌟', n: 1 },
        d: q.d || p.date || today(),
        items: q.items.map(x => {
          const it = { id: uid(), q: String(x.q || '').trim(), a: String(x.a || '').trim(), ex: String(x.ex || '').trim(), note: String(x.note || '').trim() };
          if ((q.mode || p.mode) !== 'spell') it.opts = (x.opts || []).map(String).slice(0, 3);
          return it;
        })
      };
      doc.quizzes = doc.quizzes || [];
      doc.quizzes.push(rec);
      doc.events = doc.events || [];
      doc.events.push({
        id: uid(), d: rec.d, t: '📝 퀴즈: ' + rec.title, m: rec.k, time: '', qid: rec.id,
        memo: '목표 ' + rec.goal + '점 · 성공하면 ' + rec.rw.e + '×' + rec.rw.n + ' 자동 지급'
      });
      return `퀴즈 "${rec.title}" ${rec.items.length}문항 올림`;
    });
  } else {
    die('모르는 부탁 종류입니다: ' + job.kind);
  }

  await db.patch(`family_jobs?id=eq.${id}`, { status: '완료', note, done_at: new Date().toISOString() });
  const dir = path.join(INBOX, String(id));
  if (fs.existsSync(dir)) fs.rmSync(dir, { recursive: true, force: true });
  console.log('\n[완료] ' + id + '번 · ' + note + '\n');
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
else if (cmd === 'apply') { if (!a1 || !a2) die('사용법: node tools/jobs.mjs apply <번호> <결과.json>'); await cmdApply(db, a1, a2); }
else if (cmd === 'fail') { if (!a1) die('사용법: node tools/jobs.mjs fail <번호> "이유"'); await cmdFail(db, a1, a2); }
else console.log('\n사용법:\n  node tools/jobs.mjs list\n  node tools/jobs.mjs apply <번호> <결과.json>\n  node tools/jobs.mjs fail  <번호> "이유"\n');
