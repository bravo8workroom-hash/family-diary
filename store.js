// ─────────────────────────────────────────────────────────────
//  우리집 다이어리 — 가족 공유 저장소 (Supabase)
//
//  앱 본체(index.html)는 데이터를 딱 세 곳에서만 다룬다:
//    읽기  componentDidMount → FamilyStore.start()
//    쓰기  save()            → FamilyStore.save()
//    초기화 resetData        → FamilyStore.reset()
//  이 파일이 그 세 지점을 서버에 연결한다.
//
//  가족 데이터는 family_state 테이블의 한 행(JSON)에 통째로 들어간다.
//  사진만 따로 Storage에 올린다 — 사진까지 한 행에 넣으면 할일 체크
//  한 번에 수 MB를 다시 올리게 되기 때문.
// ─────────────────────────────────────────────────────────────
(function () {
  var CFG = window.FAMILY_CONFIG || {};
  var BUCKET = 'family-photos';
  var ROW_ID = 'main';

  var sb = null;
  var rev = 0;              // 내가 마지막으로 본 서버 버전
  var saving = 0;           // 저장 왕복 중이면 >0 (그동안 원격 갱신은 미룬다)
  var pendingRemote = null; // 저장 중 도착한 원격 갱신
  var onRemote = null;      // 앱에 새 데이터를 밀어 넣는 콜백
  var seedFn = null;

  // ── 로그인 기억함 ───────────────────────────────────────────
  //  한 번 들어오면 다시 안 묻는다. 이 폰(브라우저)에만 저장되고
  //  서버로는 나가지 않는다. btoa 는 자물쇠가 아니라 눈에 덜 띄게
  //  하는 정도다 — 폰을 남에게 주지 않는다는 전제다.
  var KEEP = 'family-diary/login';
  var leaving = false;      // 내가 직접 누른 로그아웃인지

  function remember(email, pw) {
    try {
      localStorage.setItem(KEEP, JSON.stringify({
        e: email, p: btoa(unescape(encodeURIComponent(pw)))
      }));
    } catch (e) {}
  }
  function remembered() {
    try {
      var o = JSON.parse(localStorage.getItem(KEEP) || 'null');
      if (!o || !o.e || !o.p) return null;
      return { email: o.e, pw: decodeURIComponent(escape(atob(o.p))) };
    } catch (e) { return null; }
  }
  function forget() {
    try { localStorage.removeItem(KEEP); } catch (e) {}
  }

  // 아는 이메일 — config.js 에 넣어 뒀거나, 전에 이 폰에서 들어온 것
  function knownEmail() {
    var c = (CFG.familyEmail || '').trim();
    if (c) return c;
    var k = remembered();
    return k ? k.email : '';
  }

  // 로그인이 풀렸을 때(토큰 만료 등) 기억해 둔 것으로 조용히 다시 들어간다
  async function autoLogin() {
    var k = remembered();
    if (!k) return false;
    var r = await sb.auth.signInWithPassword({ email: k.email, password: k.pw });
    if (r.error) {
      // 400 = 비밀번호가 바뀐 것. 그 밖(네트워크 등)은 기억을 지우지 않는다.
      if (r.error.status === 400) forget();
      return false;
    }
    return true;
  }

  var urlOf = new Map();    // 'sb://경로' → 서명된 이미지 주소
  var pathOf = new Map();   // 서명된 이미지 주소 → 'sb://경로'

  // ── 사진 주소 변환 ──────────────────────────────────────────
  // 저장할 땐 'sb://경로', 화면에 보일 땐 서명된 임시 주소.
  // 문서 어디에 사진이 들어 있든 상관없게 통째로 훑는다.
  function walk(v, f) {
    if (typeof v === 'string') return f(v);
    if (Array.isArray(v)) return v.map(function (x) { return walk(x, f); });
    if (v && typeof v === 'object') {
      var o = {};
      for (var k in v) o[k] = walk(v[k], f);
      return o;
    }
    return v;
  }

  function collectPaths(doc) {
    var out = [];
    walk(doc, function (s) {
      if (s.indexOf('sb://') === 0 && !urlOf.has(s)) out.push(s.slice(5));
      return s;
    });
    return out;
  }

  async function hydrate(doc) {
    if (!doc) return doc;
    var need = collectPaths(doc);
    if (need.length) {
      try {
        var r = await sb.storage.from(BUCKET).createSignedUrls(need, 60 * 60 * 8);
        (r.data || []).forEach(function (x) {
          if (!x || !x.signedUrl) return;
          var key = 'sb://' + x.path;
          urlOf.set(key, x.signedUrl);
          pathOf.set(x.signedUrl, key);
        });
      } catch (e) { /* 사진만 안 보일 뿐, 나머지는 계속 쓸 수 있게 */ }
    }
    return walk(doc, function (s) { return urlOf.get(s) || s; });
  }

  function dehydrate(doc) {
    return walk(doc, function (s) { return pathOf.get(s) || s; });
  }

  // ── 서버 읽고 쓰기 ──────────────────────────────────────────
  async function fetchRow() {
    var r = await sb.from('family_state').select('doc,rev').eq('id', ROW_ID).maybeSingle();
    if (r.error) throw r.error;
    return r.data;
  }

  async function adopt(row) {
    rev = row.rev;
    var doc = await hydrate(row.doc);
    if (onRemote) onRemote(doc);
  }

  // 바뀌었다는 신호만 받고 본문은 다시 읽는다.
  // (실시간 메시지에는 크기 제한이 있어서 문서를 통째로 실어 보내면
  //  조용히 누락될 수 있다 — 신호만 믿고 본문은 서버에서 가져온다.)
  async function pull() {
    try {
      var fresh = await fetchRow();
      if (fresh && fresh.rev !== rev) await adopt(fresh);
    } catch (e) { /* 다음 신호 때 다시 시도 */ }
  }

  function listen() {
    sb.channel('family_state')
      .on('postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'family_state' },
        function () {
          if (saving) { pendingRemote = true; return; }
          pull();
        })
      .subscribe();
    // 실시간 연결이 끊겼다 돌아온 경우를 위해, 화면을 다시 볼 때 한 번 맞춘다
    document.addEventListener('visibilitychange', function () {
      if (!document.hidden && !saving) pull();
    });
  }

  // 저장. 다른 가족이 먼저 저장해 버전이 어긋나면, 서버의 최신 문서를
  // 다시 받아 같은 변경(replay)을 그 위에 얹어 다시 시도한다.
  // 통째로 덮어써서 남의 변경을 지우는 사고를 막는 지점.
  async function save(doc, replay) {
    if (!sb) return { ok: false };
    saving++;
    try {
      var body = dehydrate(doc);
      for (var i = 0; i < 4; i++) {
        var r = await sb.from('family_state')
          .update({ doc: body, rev: rev + 1, updated_at: new Date().toISOString() })
          .eq('id', ROW_ID).eq('rev', rev).select('rev');
        if (r.error) throw r.error;
        if (r.data && r.data.length) { rev = r.data[0].rev; return { ok: true }; }

        var fresh = await fetchRow();
        if (!fresh) return { ok: false };
        rev = fresh.rev;
        var merged = await hydrate(fresh.doc);
        if (!replay) { if (onRemote) onRemote(merged); return { ok: false, conflict: true }; }
        replay(merged);
        if (onRemote) onRemote(merged);
        doc = merged;
        body = dehydrate(merged);
      }
      return { ok: false };
    } catch (e) {
      flash('저장하지 못했어요. 인터넷 연결을 확인해 주세요');
      return { ok: false, error: e };
    } finally {
      saving--;
      if (!saving && pendingRemote) { pendingRemote = null; pull(); }
    }
  }

  // ── 사진 올리기 ────────────────────────────────────────────
  function dataUrlToBlob(u) {
    var parts = u.split(',');
    var mime = (parts[0].match(/:(.*?);/) || [, 'image/jpeg'])[1];
    var bin = atob(parts[1]);
    var arr = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
    return new Blob([arr], { type: mime });
  }

  async function putPhoto(dataUrl) {
    if (!sb || !dataUrl || dataUrl.indexOf('data:') !== 0) return dataUrl;
    try {
      // 스티커는 배경이 뚫린 PNG 라서 JPEG 로 바꾸면 뚫린 자리가 검게 찬다 — 원래 형식 그대로 올린다
      var mime = (dataUrl.match(/^data:([^;,]+)/) || [, 'image/jpeg'])[1];
      var ext = mime === 'image/png' ? '.png' : (mime === 'image/webp' ? '.webp' : '.jpg');
      var name = Date.now() + '-' + Math.random().toString(36).slice(2, 10) + ext;
      var up = await sb.storage.from(BUCKET).upload(name, dataUrlToBlob(dataUrl), {
        contentType: mime, upsert: false
      });
      if (up.error) throw up.error;
      var s = await sb.storage.from(BUCKET).createSignedUrl(name, 60 * 60 * 8);
      if (s.error || !s.data) throw (s.error || new Error('no url'));
      urlOf.set('sb://' + name, s.data.signedUrl);
      pathOf.set(s.data.signedUrl, 'sb://' + name);
      return s.data.signedUrl;
    } catch (e) {
      flash('사진을 올리지 못했어요. 잠시 뒤 다시 시도해 주세요');
      return dataUrl; // 최악의 경우에도 사진은 남는다 (문서 안에 그대로)
    }
  }

  // 사진 지우기. 문서에서 빼기만 하면 창고에는 파일이 그대로 남는다 —
  // 가계부 캡처는 처리하면 남기지 않기로 했으므로(자료는 반영 후 버린다) 실물까지 지운다.
  async function dropPhoto(url) {
    if (!sb || !url) return false;
    var key = pathOf.get(url) || (url.indexOf('sb://') === 0 ? url : '');
    if (!key) return false;
    try {
      await sb.storage.from(BUCKET).remove([key.slice(5)]);
      urlOf.delete(key);
      pathOf.delete(url);
      return true;
    } catch (e) { return false; }
  }

  // ── AI 부탁 대기열 ─────────────────────────────────────────
  // 앱에서 부탁을 걸어두면, VS코드에서 담당(/family-diary)이 처리해
  // 결과를 데이터에 직접 넣는다. 그래서 여기서는 "맡기기"까지만 한다.
  async function ask(kind, payload, photos, askedBy) {
    if (!sb) return { ok: false };
    try {
      var paths = [];
      for (var i = 0; i < (photos || []).length; i++) {
        var u = await putPhoto(photos[i]);
        var p = pathOf.get(u);
        if (p) paths.push(p.slice(5));
      }
      var r = await sb.from('family_jobs').insert({
        kind: kind,
        payload: Object.assign({}, payload, { photos: paths }),
        asked_by: askedBy || ''
      });
      if (r.error) throw r.error;
      return { ok: true };
    } catch (e) {
      return { ok: false };
    }
  }

  // 아직 처리되지 않은 부탁이 몇 건인지 (화면에 알려주기 위해)
  async function waiting() {
    if (!sb) return 0;
    try {
      var r = await sb.from('family_jobs').select('id', { count: 'exact', head: true }).eq('status', '대기');
      return r.count || 0;
    } catch (e) { return 0; }
  }

  // ── 로그인 화면 ────────────────────────────────────────────
  var gate, gateMsg, resolveReady;
  var ready = new Promise(function (r) { resolveReady = r; });

  function el(tag, css, html) {
    var e = document.createElement(tag);
    if (css) e.setAttribute('style', css);
    if (html != null) e.innerHTML = html;
    return e;
  }

  function flash(msg) {
    var t = el('div', 'position:fixed;left:50%;bottom:26px;transform:translateX(-50%);z-index:9999;' +
      'background:#3F3A33;color:#fff;font-size:13px;font-weight:700;padding:11px 18px;border-radius:99px;' +
      'box-shadow:0 6px 18px rgba(0,0,0,.28);max-width:90vw;text-align:center;word-break:keep-all;', msg);
    document.body.appendChild(t);
    setTimeout(function () { t.remove(); }, 3400);
  }

  function buildGate(first) {
    gate = el('div', 'position:fixed;inset:0;z-index:9998;background:#FAF6EF;color:#3F3A33;' +
      'font-family:Pretendard,-apple-system,"Malgun Gothic",sans-serif;display:flex;align-items:center;' +
      'justify-content:center;padding:24px;box-sizing:border-box;word-break:keep-all;overflow-wrap:break-word;');
    var card = el('div', 'width:100%;max-width:340px;background:#fff;border:1px solid #EFE4CF;border-radius:24px;padding:28px 22px;text-align:center;');
    card.appendChild(el('div', 'font-size:44px;line-height:1;', '🏠'));
    card.appendChild(el('div', 'font-size:22px;font-weight:800;margin-top:8px;', '우리집 다이어리'));
    var known = knownEmail();
    var sub = el('div', 'font-size:13px;color:#8A8177;margin-top:6px;line-height:1.6;',
      known ? '우리 가족만 볼 수 있어요.<br>가족 비밀번호를 넣어 주세요.'
            : '우리 가족만 볼 수 있어요.<br>가족 계정으로 들어와 주세요.');
    card.appendChild(sub);

    var inp = 'width:100%;box-sizing:border-box;padding:12px 14px;border:1px solid #EFE4CF;border-radius:12px;' +
      'background:#FAF6EF;color:#3F3A33;font-size:15px;outline:none;margin-top:10px;font-family:inherit;';
    var email = el('input', inp); email.type = 'email'; email.placeholder = '이메일'; email.autocomplete = 'username';
    var pw = el('input', inp); pw.type = 'password'; pw.autocomplete = 'current-password';
    var btn = el('button', 'width:100%;margin-top:14px;background:#F59E0B;color:#fff;border:none;border-radius:12px;' +
      'padding:14px;font-size:15px;font-weight:800;cursor:pointer;font-family:inherit;min-height:44px;', '들어가기');
    gateMsg = el('div', 'font-size:12px;font-weight:700;color:#E5484D;margin-top:10px;line-height:1.5;min-height:18px;', '');

    // 아는 이메일이 있으면 칸을 숨기고 「가족 비밀번호」 한 칸만 보여준다
    var other = el('button', 'background:none;border:none;color:#B3AA9E;font-size:12px;font-weight:700;' +
      'cursor:pointer;font-family:inherit;padding:10px;margin-top:6px;min-height:44px;', '다른 계정으로 들어가기');
    function useKnown(on) {
      email.style.display = on ? 'none' : '';
      other.style.display = on ? '' : 'none';
      pw.placeholder = on ? '가족 비밀번호' : '비밀번호';
      sub.innerHTML = on ? '우리 가족만 볼 수 있어요.<br>가족 비밀번호를 넣어 주세요.'
                         : '우리 가족만 볼 수 있어요.<br>가족 계정으로 들어와 주세요.';
    }
    email.value = known;
    useKnown(!!known);
    other.onclick = function () { email.value = ''; useKnown(false); email.focus(); };

    card.appendChild(email); card.appendChild(pw); card.appendChild(btn); card.appendChild(gateMsg);
    card.appendChild(other);
    gate.appendChild(card);
    document.body.appendChild(gate);
    setTimeout(function () { (known ? pw : email).focus(); }, 60);
    if (first) gateMsg.textContent = first;

    async function go() {
      var em = (email.value || '').trim();
      var onlyPw = email.style.display === 'none';
      if (!em || !pw.value) {
        gateMsg.textContent = onlyPw ? '가족 비밀번호를 넣어 주세요' : '이메일과 비밀번호를 입력해 주세요';
        return;
      }
      btn.disabled = true; btn.textContent = '확인 중...'; gateMsg.textContent = '';
      var r = await sb.auth.signInWithPassword({ email: em, password: pw.value });
      btn.disabled = false; btn.textContent = '들어가기';
      if (r.error) {
        gateMsg.textContent = onlyPw ? '가족 비밀번호가 맞지 않아요' : '이메일이나 비밀번호가 맞지 않아요';
        return;
      }
      remember(em, pw.value);   // 다음부터는 안 묻는다
      openApp();
    }
    btn.onclick = go;
    pw.onkeydown = function (e) { if (e.key === 'Enter') go(); };
    email.onkeydown = function (e) { if (e.key === 'Enter') pw.focus(); };
  }

  function showSetup(lines) {
    gate = el('div', 'position:fixed;inset:0;z-index:9998;background:#FAF6EF;color:#3F3A33;' +
      'font-family:Pretendard,-apple-system,"Malgun Gothic",sans-serif;display:flex;align-items:center;' +
      'justify-content:center;padding:24px;box-sizing:border-box;word-break:keep-all;overflow-wrap:break-word;');
    var card = el('div', 'width:100%;max-width:380px;background:#fff;border:1px solid #EFE4CF;border-radius:24px;padding:26px 22px;');
    card.appendChild(el('div', 'font-size:17px;font-weight:800;margin-bottom:10px;', '⚙️ 설정이 아직 안 끝났어요'));
    card.appendChild(el('div', 'font-size:13px;line-height:1.75;color:#5C554C;', lines));
    gate.appendChild(card);
    document.body.appendChild(gate);
  }

  function addSignOut() {
    var wrap = el('div', 'max-width:430px;margin:0 auto;padding:6px 16px 26px;text-align:center;');
    var b = el('button', 'background:none;border:none;color:#B3AA9E;font-size:12px;font-weight:700;' +
      'cursor:pointer;font-family:inherit;padding:8px 12px;min-height:44px;', '가족 계정 로그아웃');
    b.onclick = async function () {
      if (!confirm('로그아웃하면 다음에 비밀번호를 다시 넣어야 해요. 나갈까요?')) return;
      leaving = true;
      forget();
      await sb.auth.signOut();
      location.reload();
    };

    // ── 비밀번호 바꾸기 ─────────────────────────────────────
    //  바꾸면 이 폰의 기억함도 새 비밀번호로 갈아둔다. 다른 가족 폰은
    //  다음에 열 때 옛 비밀번호가 안 먹혀 로그인 화면이 한 번 뜨고,
    //  새 비밀번호를 넣으면 그 뒤로는 다시 안 묻는다.
    var pwBtn = el('button', 'background:none;border:none;color:#B3AA9E;font-size:12px;font-weight:700;' +
      'cursor:pointer;font-family:inherit;padding:8px 12px;min-height:44px;', '비밀번호 바꾸기');
    var box = el('div', 'display:none;max-width:300px;margin:4px auto 0;background:#fff;border:1px solid #EFE4CF;' +
      'border-radius:16px;padding:16px 14px;text-align:left;word-break:keep-all;');
    var inp2 = 'width:100%;box-sizing:border-box;padding:11px 13px;border:1px solid #EFE4CF;border-radius:10px;' +
      'background:#FAF6EF;color:#3F3A33;font-size:15px;outline:none;margin-top:8px;font-family:inherit;';
    box.appendChild(el('div', 'font-size:13px;font-weight:800;color:#3F3A33;', '새 가족 비밀번호'));
    box.appendChild(el('div', 'font-size:11px;color:#8A8177;margin-top:4px;line-height:1.6;',
      '6자 이상.<br>바꾸면 다른 가족 폰에서 한 번만 새로 넣으면 돼요.'));
    var n1 = el('input', inp2); n1.type = 'password'; n1.placeholder = '새 비밀번호'; n1.autocomplete = 'new-password';
    var n2 = el('input', inp2); n2.type = 'password'; n2.placeholder = '한 번 더'; n2.autocomplete = 'new-password';
    var save = el('button', 'width:100%;margin-top:10px;background:#F59E0B;color:#fff;border:none;border-radius:10px;' +
      'padding:12px;font-size:14px;font-weight:800;cursor:pointer;font-family:inherit;min-height:44px;', '바꾸기');
    var note = el('div', 'font-size:11px;font-weight:700;color:#E5484D;margin-top:8px;line-height:1.5;min-height:15px;', '');
    box.appendChild(n1); box.appendChild(n2); box.appendChild(save); box.appendChild(note);

    pwBtn.onclick = function () {
      var on = box.style.display === 'none';
      box.style.display = on ? 'block' : 'none';
      if (on) n1.focus();
    };
    save.onclick = async function () {
      note.style.color = '#E5484D';
      if (n1.value.length < 6) { note.textContent = '6자 이상으로 정해 주세요'; return; }
      if (n1.value !== n2.value) { note.textContent = '두 번 넣은 비밀번호가 서로 달라요'; return; }
      save.disabled = true; save.textContent = '바꾸는 중...'; note.textContent = '';
      var r = await sb.auth.updateUser({ password: n1.value });
      save.disabled = false; save.textContent = '바꾸기';
      if (r.error) { note.textContent = '바꾸지 못했어요 — ' + (r.error.message || ''); return; }
      var k = remembered();
      var em = (k && k.email) || (r.data && r.data.user && r.data.user.email) || '';
      if (em) remember(em, n1.value);        // 이 폰은 새 비밀번호로 갈아둔다
      n1.value = ''; n2.value = '';
      box.style.display = 'none';
      flash('비밀번호를 바꿨어요. 다른 가족 폰에서는 한 번만 새로 넣으면 됩니다.');
    };

    wrap.appendChild(b);
    wrap.appendChild(el('span', 'color:#E4DACA;font-size:12px;', '·'));
    wrap.appendChild(pwBtn);
    wrap.appendChild(box);
    document.body.appendChild(wrap);
  }

  // 로그인은 됐는데 더 못 가는 경우 — 로딩 화면에 갇히지 않게 이유를 보여준다
  function stuck(msg) {
    if (gateMsg) { gateMsg.textContent = msg; return; }
    if (gate) gate.remove();
    gate = null;
    showSetup(msg + '<br><br><b>README.md</b> 의 “처음 한 번만 하는 설정” 을 확인해 주세요.');
  }

  async function openApp() {
    var row;
    try {
      row = await fetchRow();
    } catch (e) {
      stuck('데이터를 읽지 못했어요. schema.sql 을 실행했는지 확인해 주세요.');
      return;
    }
    if (!row) {
      // 첫 접속 — 처음 데이터를 만들어 둔다
      var seeded = seedFn ? seedFn() : {};
      var ins = await sb.from('family_state').insert({ id: ROW_ID, doc: seeded, rev: 1 }).select('doc,rev').maybeSingle();
      if (ins.error || !ins.data) {
        stuck('이 계정은 아직 우리 가족 명단에 없어요 (family_allow 표에 이메일 넣기).');
        return;
      }
      row = ins.data;
    }
    if (gate) { gate.remove(); gate = null; }
    rev = row.rev;
    listen();
    addSignOut();
    resolveReady(await hydrate(row.doc));
  }

  // ── 앱이 부르는 창구 ────────────────────────────────────────
  window.FamilyStore = {
    start: function (opt) {
      seedFn = opt.seed;
      onRemote = opt.onRemote;
      return ready;
    },
    save: save,
    putPhoto: putPhoto,
    dropPhoto: dropPhoto,
    ask: ask,
    waiting: waiting,
    reset: async function (doc) {
      if (!sb) return;
      var r = await sb.from('family_state')
        .update({ doc: dehydrate(doc), rev: rev + 1, updated_at: new Date().toISOString() })
        .eq('id', ROW_ID).select('rev');
      if (!r.error && r.data && r.data.length) rev = r.data[0].rev;
    }
  };

  // ── 시작 ───────────────────────────────────────────────────
  document.addEventListener('DOMContentLoaded', async function () {
    if (!CFG.url || !CFG.anonKey) {
      showSetup('<b>config.js</b> 파일에 Supabase 주소와 키를 아직 안 넣었어요.<br><br>' +
        'Supabase 대시보드 → Project Settings → Data API 에서<br>' +
        'Project URL 과 publishable(anon) key 를 복사해<br>' +
        'config.js 의 따옴표 안에 붙여넣고 다시 올려주세요.');
      return;
    }
    if (!window.supabase) {
      showSetup('접속에 필요한 파일을 불러오지 못했어요.<br>인터넷 연결을 확인하고 새로고침해 주세요.');
      return;
    }
    sb = window.supabase.createClient(CFG.url, CFG.anonKey, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false }
    });

    // 쓰는 도중에 로그인이 풀려도(토큰 만료 등) 화면을 안 뺏기게 조용히 다시 들어간다
    sb.auth.onAuthStateChange(function (event) {
      if (event !== 'SIGNED_OUT' || leaving) return;
      setTimeout(function () {            // 콜백 안에서 바로 부르면 안 된다
        autoLogin().then(function (ok) { if (!ok) location.reload(); });
      }, 0);
    });

    var s = await sb.auth.getSession();
    if (s.data && s.data.session) { openApp(); return; }
    if (await autoLogin()) { openApp(); return; }
    buildGate(remembered() ? '다시 들어가지 못했어요. 비밀번호를 넣어 주세요.' : '');
  });
})();
