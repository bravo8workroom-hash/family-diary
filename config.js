// ─────────────────────────────────────────────────────────────
//  우리집 다이어리 — 접속 설정
//
//  Supabase 대시보드 → Project Settings → Data API 에서 두 값을 복사해
//  아래 따옴표 안에 붙여넣으세요. (이 두 값은 공개되어도 안전합니다.
//   실제 데이터는 로그인한 가족만 볼 수 있게 서버에서 막아둡니다.)
// ─────────────────────────────────────────────────────────────
window.FAMILY_CONFIG = {
  url: 'https://bpwuyrhnntlbjgkqilho.supabase.co',      // 예: https://abcdefghijk.supabase.co
  anonKey: 'sb_publishable_ULOt_kHQlZhQ8f13PA9-0g_Wnb85ocQ',   // 예: sb_publishable_xxxxxxxxxxxxxxxxxxxx

  // ── 가족 계정 이메일 (비워두면 그대로 두세요) ────────────────
  //  여기에 이메일을 넣으면 로그인 화면에 이메일 칸이 사라지고
  //  「가족 비밀번호」 한 칸만 나옵니다. 새 폰에서도 처음부터 그렇습니다.
  //
  //  ⚠ 이 파일은 공개 저장소(github.com/bravo8workroom-hash/family-diary)에
  //     그대로 올라갑니다. 이메일을 넣으면 자물쇠가 비밀번호 하나만 남으니,
  //     넣으실 거면 비밀번호를 길게(영문+숫자 12자 이상) 바꿔 주세요.
  //
  //  비워두어도 됩니다 — 폰마다 처음 한 번만 이메일을 넣으면
  //  그 뒤로는 그 폰에서도 「가족 비밀번호」 한 칸만 나옵니다.
  familyEmail: ''
};
