/* ================= BACKEND CONFIG (Supabase) =================
   1) https://supabase.com da bepul loyiha yarating.
   2) Project Settings → API bo'limidan Project URL va anon public key ni oling.
   3) Pastdagi ikki qatorga shularni qo'ying.
   4) Supabase SQL Editor'da supabase-setup.sql faylini ishga tushiring.
================================================================= */
const SUPABASE_URL = "https://eztiqzjnvmuqjauqfpkt.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImV6dGlxempudm11cWphdXFmcGt0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODY3NzAyMjMsImV4cCI6MjEwMjM0NjIyM30.d7qmH7m-PbfMdA7VFWphlwm_QUFdLZLSTCEQaCTHrM4";

/* Sozlanganmi yoki hali placeholder qiymatlardami — shuni tekshiramiz.
   Bu tekshiruv bo'lmasa, noto'g'ri URL bilan supabase.createClient()
   darhol xato tashlaydi va butun <script> to'xtab, sayt "buzilib" ko'rinadi. */
const isSupabaseConfigured =
  /^https?:\/\//.test(SUPABASE_URL) &&
  !!SUPABASE_ANON_KEY && SUPABASE_ANON_KEY !== "YOUR_SUPABASE_ANON_KEY";

let sb = null;
if (isSupabaseConfigured) {
  try {
    sb = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
  } catch (e) {
    console.error("Supabase mijozini yaratib bo'lmadi:", e);
  }
}

/* window.storage o'rnini bosuvchi, Supabase'ga asoslangan xotira qatlami.
   Original window.storage.get/set/list bilan bir xil natija shaklini qaytaradi,
   shuning uchun pastdagi kod deyarli o'zgarishsiz ishlayveradi.
   Sozlanmagan holatda metodlar xato bilan reject bo'ladi (chaqirilgan joyda
   try/catch bor), butun scriptni to'xtatmaydi. */
const storage = {
  async get(key){
    if(!sb) throw new Error("Supabase sozlanmagan");
    const { data, error } = await sb.from('kv_store').select('value').eq('key', key).maybeSingle();
    if(error) throw error;
    if(!data) throw new Error('key not found');
    return { key, value: data.value };
  },
  async set(key, value){
    if(!sb) throw new Error("Supabase sozlanmagan");
    const { error } = await sb.from('kv_store').upsert({ key, value, updated_at: new Date().toISOString() });
    if(error) throw error;
    return { key, value };
  },
  async delete(key){
    if(!sb) throw new Error("Supabase sozlanmagan");
    const { error } = await sb.from('kv_store').delete().eq('key', key);
    if(error) throw error;
    return { key, deleted: true };
  },
  async list(prefix){
    if(!sb) throw new Error("Supabase sozlanmagan");
    const { data, error } = await sb.from('kv_store').select('key').like('key', `${(prefix||'')}%`);
    if(error) throw error;
    return { keys: (data||[]).map(d=>d.key) };
  }
};

if(!isSupabaseConfigured){
  console.warn("⚠️ Supabase sozlanmagan: index.html faylidagi SUPABASE_URL va SUPABASE_ANON_KEY ni to'ldiring.");
  window.addEventListener('DOMContentLoaded', () => {
    const banner = document.createElement('div');
    banner.style.cssText = 'position:fixed;bottom:16px;right:16px;z-index:9999;max-width:300px;background:#12213B;color:#FBF7EF;padding:14px 18px;border-radius:14px;font-family:Manrope,sans-serif;font-size:13px;line-height:1.45;box-shadow:0 12px 30px rgba(0,0,0,.3);';
    banner.innerHTML = '⚠️ <b>Backend ulanmagan.</b> Ustozlar, reyting va AI funksiyalari hozircha ishlamaydi. index.html faylidagi SUPABASE_URL / SUPABASE_ANON_KEY ni to\'ldiring.<br><span style="cursor:pointer;text-decoration:underline;opacity:.85;">Yopish</span>';
    banner.querySelector('span').addEventListener('click', () => banner.remove());
    document.body.appendChild(banner);
  });
}

/* AI (Groq) so'rovlari uchun proxy manzili.
   To'g'ridan-to'g'ri api.groq.com'ga brauzerdan so'rov yuborib bo'lmaydi
   (API kalit talab qilinadi va CORS bloklaydi), shuning uchun so'rovlar
   siz deploy qilgan Supabase Edge Function (groq-proxy) orqali o'tadi.
   Sozlash: Supabase Dashboard -> Edge Functions -> groq-proxy -> Secrets ->
   GROQ_API_KEY = console.groq.com dan olingan API kalitingiz. */
const AI_PROXY_URL = `${SUPABASE_URL}/functions/v1/groq-proxy`;
const AI_MODEL = "openai/gpt-oss-120b";
/* Groq'da har bir modelning DAQIQALIK TOKEN LIMITI alohida hisoblanadi.
   Shu sababli, muhim bo'lmagan/yengil vazifalarni (tarjima, kod natijasini
   simulyatsiya qilish) tezkor kichik modelga ajratamiz — shunda ular asosiy
   chat va maqola yozish uchun ishlatiladigan AI_MODEL ning limitini
   "yemaydi" va sayt umuman tezroq, kam "band" bo'ladigan bo'ladi. */
const AI_MODEL_FAST = "llama-3.1-8b-instant";
const AI_PROXY_HEADERS = {
  "Content-Type": "application/json",
  "apikey": SUPABASE_ANON_KEY,
  "Authorization": "Bearer " + SUPABASE_ANON_KEY
};

/* Groq bepul tarifida daqiqalik token chegarasi bor (TPM). Chegaraga tegib
   qolinsa, Groq "Rate limit reached ... try again in Xs" xatosini qaytaradi.
   Shu funksiya bunday holatda avtomatik ravishda ko'rsatilgan vaqtcha kutib,
   so'rovni BITTA marta qayta yuboradi — foydalanuvchi xato ko'rmaydi. */
async function fetchAIProxy(body){
  let response, data;
  const MAX_ATTEMPTS = 3;
  for(let attempt = 0; attempt < MAX_ATTEMPTS; attempt++){
    response = await fetch(AI_PROXY_URL, {
      method: "POST",
      headers: AI_PROXY_HEADERS,
      body: JSON.stringify(body)
    });
    try{ data = await response.json(); }catch(parseErr){ throw new Error("JSON parse xatosi"); }
    if(response.ok) return { response, data };
    const errMsg = (data && data.error && data.error.message) ? data.error.message : ("HTTP " + response.status);
    const isRateLimit = response.status === 429 || /rate limit/i.test(errMsg);
    if(isRateLimit && attempt < MAX_ATTEMPTS - 1){
      const m = errMsg.match(/try again in ([\d.]+)s/i);
      const waitMs = m ? Math.min(Math.ceil(parseFloat(m[1]) * 1000) + 600, 12000) : 6000 * (attempt + 1);
      await new Promise(r => setTimeout(r, waitMs));
      continue;
    }
    return { response, data, isRateLimit };
  }
  return { response, data };
}

/* Telegram xabarnomalari uchun manzil (Supabase Edge Function orqali).
   Ishlashi uchun Supabase loyihangizda quyidagi ikki secret sozlangan bo'lishi kerak:
   TELEGRAM_BOT_TOKEN va TELEGRAM_OWNER_CHAT_ID
   (Dashboard -> Edge Functions -> telegram-notify -> Secrets). */
const TELEGRAM_NOTIFY_URL = `${SUPABASE_URL}/functions/v1/telegram-notify`;
/* Ustozlar botni "Xabarnomalarni yoqish" tugmasi orqali ishga tushirishi uchun
   bot foydalanuvchi nomini shu yerga yozing (masalan: "ilmnur_bot"). */
const TELEGRAM_BOT_USERNAME = "YOUR_BOT_USERNAME";

async function sendTelegramNotify(text, teacherKey){
  try{
    await fetch(TELEGRAM_NOTIFY_URL, {
      method: "POST",
      headers: AI_PROXY_HEADERS,
      body: JSON.stringify({ text, teacher_key: teacherKey || undefined })
    });
  }catch(e){
    console.warn("Telegram xabarnomasi yuborilmadi:", e);
  }
}

/* ================= AUTH (Supabase Auth): Kirish / Ro'yxatdan o'tish =================
   Email + parol asosidagi professional login/registratsiya tizimi.
   Supabase Auth seansni brauzerda o'zi saqlaydi (avtomatik), shuning uchun
   sahifa qayta yuklanganda foydalanuvchi qaytadan kirishi shart emas. */
let currentUser = null;

function authDisplayName(user){
  if(!user) return '';
  const meta = user.user_metadata || {};
  if(meta.full_name) return meta.full_name;
  return (user.email || '').split('@')[0];
}
function authInitial(user){
  const name = authDisplayName(user).trim();
  return (name[0] || '?').toUpperCase();
}
function escapeHtmlSafe(str){
  return String(str==null ? '' : str)
    .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
    .replace(/"/g,'&quot;').replace(/'/g,'&#39;');
}
/* Supabase'ning inglizcha xato xabarlarini foydalanuvchiga tushunarli
   o'zbekcha xabarga aylantiradi. */
function mapAuthError(msg){
  const m = (msg || '').toLowerCase();
  if(m.includes('invalid login credentials')) return "Email yoki parol noto'g'ri.";
  if(m.includes('already registered')) return "Bu email bilan hisob allaqachon mavjud. \"Kirish\" bo'limidan foydalaning.";
  if(m.includes('email not confirmed')) return "Email hali tasdiqlanmagan. Pochtangizni tekshiring.";
  if(m.includes('password') && (m.includes('least') || m.includes('6'))) return "Parol kamida 6 ta belgidan iborat bo'lishi kerak.";
  if(m.includes('rate limit') || m.includes('too many')) return "Juda ko'p urinish. Birozdan so'ng qayta urinib ko'ring.";
  if(m.includes('valid email') || m.includes('invalid email')) return "Email manzili noto'g'ri formatda.";
  if(m.includes('failed to fetch') || m.includes('network')) return "Internet aloqasida muammo. Qayta urinib ko'ring.";
  return msg || "Noma'lum xatolik yuz berdi.";
}
function setBtnLoading(btn, loading){
  if(!btn) return;
  btn.disabled = loading;
  btn.classList.toggle('loading', loading);
}

function renderAuthUI(){
  const wrap = document.getElementById('navAccount');
  if(!wrap) return;
  if(currentUser){
    wrap.innerHTML = `
      <div class="nav-user" id="navUser">
        <button class="nav-user-btn" id="navUserBtn" type="button">
          <span class="nav-user-avatar">${escapeHtmlSafe(authInitial(currentUser))}</span>
          <span class="nav-user-name">${escapeHtmlSafe(authDisplayName(currentUser))}</span>
          <svg class="nav-user-chevron" viewBox="0 0 12 8" width="12" height="8" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M1 1.5l5 5 5-5"/></svg>
        </button>
        <div class="nav-user-dropdown" id="navUserDropdown">
          <button type="button" id="navLogoutBtn">Chiqish</button>
        </div>
      </div>`;
    const userBtn = document.getElementById('navUserBtn');
    const dropdown = document.getElementById('navUserDropdown');
    userBtn.addEventListener('click', (e)=>{
      e.stopPropagation();
      userBtn.classList.toggle('open');
      dropdown.classList.toggle('open');
    });
    document.getElementById('navLogoutBtn').addEventListener('click', async ()=>{
      if(sb) await sb.auth.signOut();
      dropdown.classList.remove('open');
      userBtn.classList.remove('open');
    });
  }else{
    wrap.innerHTML = `<button class="btn ghost nav-account-btn" id="navLoginBtn" type="button">Kirish</button>`;
    document.getElementById('navLoginBtn').addEventListener('click', ()=>{
      closeSidebar();
      openAuthModal('login');
    });
  }
}
document.addEventListener('click', (e)=>{
  const dropdown = document.getElementById('navUserDropdown');
  const btn = document.getElementById('navUserBtn');
  if(dropdown && dropdown.classList.contains('open') && !e.target.closest('#navUser')){
    dropdown.classList.remove('open');
    if(btn) btn.classList.remove('open');
  }
});

const authModal = document.getElementById('authModal');
const authTabLogin = document.getElementById('authTabLogin');
const authTabRegister = document.getElementById('authTabRegister');
const authPanelLogin = document.getElementById('authPanelLogin');
const authPanelRegister = document.getElementById('authPanelRegister');

function openAuthModal(tab){
  switchAuthTab(tab || 'login');
  authModal.classList.add('open');
}
function closeAuthModal(){
  authModal.classList.remove('open');
}
function switchAuthTab(tab){
  const isLogin = tab === 'login';
  authTabLogin.classList.toggle('active', isLogin);
  authTabRegister.classList.toggle('active', !isLogin);
  authPanelLogin.style.display = isLogin ? 'block' : 'none';
  authPanelRegister.style.display = isLogin ? 'none' : 'block';
  document.getElementById('loginError').style.display='none';
  document.getElementById('loginSuccess').style.display='none';
  document.getElementById('registerError').style.display='none';
  document.getElementById('registerSuccess').style.display='none';
}
document.getElementById('authModalClose').addEventListener('click', closeAuthModal);
authModal.addEventListener('click', (e)=>{ if(e.target===authModal) closeAuthModal(); });
authTabLogin.addEventListener('click', ()=>switchAuthTab('login'));
authTabRegister.addEventListener('click', ()=>switchAuthTab('register'));

document.querySelectorAll('.password-toggle').forEach(btn=>{
  btn.addEventListener('click', ()=>{
    const input = document.getElementById(btn.dataset.target);
    if(!input) return;
    const showing = input.type === 'text';
    input.type = showing ? 'password' : 'text';
    btn.textContent = showing ? '👁' : '🙈';
  });
});

/* ---- Kirish: real-vaqtda tekshirish ---- */
function validateLoginEmail(){
  const v = document.getElementById('loginEmail').value.trim();
  if(!v){ setHint('loginEmail', false, null); return false; }
  const ok = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);
  setHint('loginEmail', ok, ok ? "To'g'ri" : "Email manzilini to'g'ri kiriting");
  return ok;
}
function validateLoginPassword(){
  const v = document.getElementById('loginPassword').value;
  if(!v){ setHint('loginPassword', false, null); return false; }
  const ok = v.length>=6;
  setHint('loginPassword', ok, ok ? "To'g'ri" : "Kamida 6 ta belgi");
  return ok;
}
document.getElementById('loginEmail').addEventListener('input', validateLoginEmail);
document.getElementById('loginPassword').addEventListener('input', validateLoginPassword);

/* ---- Ro'yxatdan o'tish: real-vaqtda tekshirish ---- */
function validateRegName(){
  const v = document.getElementById('regName').value.trim();
  if(!v){ setHint('regName', false, null); return false; }
  const ok = v.length>=2;
  setHint('regName', ok, ok ? "To'g'ri" : "Kamida 2 harf kiriting");
  return ok;
}
function validateRegSurname(){
  const v = document.getElementById('regSurname').value.trim();
  if(!v){ setHint('regSurname', false, null); return false; }
  const ok = v.length>=2;
  setHint('regSurname', ok, ok ? "To'g'ri" : "Kamida 2 harf kiriting");
  return ok;
}
function validateRegEmail(){
  const v = document.getElementById('regEmail').value.trim();
  if(!v){ setHint('regEmail', false, null); return false; }
  const ok = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);
  setHint('regEmail', ok, ok ? "To'g'ri" : "Email manzilini to'g'ri kiriting");
  return ok;
}
function validateRegPassword(){
  const v = document.getElementById('regPassword').value;
  if(!v){ setHint('regPassword', false, null); return false; }
  const ok = v.length>=6;
  setHint('regPassword', ok, ok ? "To'g'ri" : "Kamida 6 ta belgidan iborat bo'lsin");
  if(document.getElementById('regPassword2').value) validateRegPassword2();
  return ok;
}
function validateRegPassword2(){
  const v = document.getElementById('regPassword2').value;
  const v1 = document.getElementById('regPassword').value;
  if(!v){ setHint('regPassword2', false, null); return false; }
  const ok = v === v1 && v.length>=6;
  setHint('regPassword2', ok, ok ? "Mos keldi" : "Parollar mos kelmadi");
  return ok;
}
document.getElementById('regName').addEventListener('input', validateRegName);
document.getElementById('regSurname').addEventListener('input', validateRegSurname);
document.getElementById('regEmail').addEventListener('input', validateRegEmail);
document.getElementById('regPassword').addEventListener('input', validateRegPassword);
document.getElementById('regPassword2').addEventListener('input', validateRegPassword2);

document.getElementById('loginSubmit').addEventListener('click', async ()=>{
  const emailOk = validateLoginEmail();
  const passOk = validateLoginPassword();
  const errEl = document.getElementById('loginError');
  const okEl = document.getElementById('loginSuccess');
  errEl.style.display='none'; okEl.style.display='none';
  if(!emailOk || !passOk){
    errEl.textContent = "Iltimos, maydonlarni to'g'ri to'ldiring.";
    errEl.style.display='block';
    return;
  }
  if(!sb){
    errEl.textContent = "Backend ulanmagan. Iltimos, keyinroq urinib ko'ring.";
    errEl.style.display='block';
    return;
  }
  const btn = document.getElementById('loginSubmit');
  setBtnLoading(btn, true);
  const email = document.getElementById('loginEmail').value.trim();
  const password = document.getElementById('loginPassword').value;
  const { error } = await sb.auth.signInWithPassword({ email, password });
  setBtnLoading(btn, false);
  if(error){
    errEl.textContent = mapAuthError(error.message);
    errEl.style.display='block';
    return;
  }
  okEl.style.display='block';
  document.getElementById('loginPassword').value='';
  setTimeout(closeAuthModal, 700);
});

document.getElementById('registerSubmit').addEventListener('click', async ()=>{
  const checks = [validateRegName(), validateRegSurname(), validateRegEmail(), validateRegPassword(), validateRegPassword2()];
  const errEl = document.getElementById('registerError');
  const okEl = document.getElementById('registerSuccess');
  errEl.style.display='none'; okEl.style.display='none';
  if(!checks.every(Boolean)){
    errEl.textContent = "Iltimos, barcha maydonlarni to'g'ri to'ldiring.";
    errEl.style.display='block';
    return;
  }
  if(!sb){
    errEl.textContent = "Backend ulanmagan. Iltimos, keyinroq urinib ko'ring.";
    errEl.style.display='block';
    return;
  }
  const btn = document.getElementById('registerSubmit');
  setBtnLoading(btn, true);
  const name = document.getElementById('regName').value.trim();
  const surname = document.getElementById('regSurname').value.trim();
  const email = document.getElementById('regEmail').value.trim();
  const password = document.getElementById('regPassword').value;
  const { data, error } = await sb.auth.signUp({
    email, password,
    options: { data: { full_name: `${name} ${surname}` } }
  });
  setBtnLoading(btn, false);
  if(error){
    errEl.textContent = mapAuthError(error.message);
    errEl.style.display='block';
    return;
  }
  ['regName','regSurname','regEmail','regPassword','regPassword2'].forEach(id=>{
    document.getElementById(id).value='';
    setHint(id, false, null);
  });
  if(data && data.session){
    okEl.textContent = "Muvaffaqiyatli ro'yxatdan o'tdingiz!";
    okEl.style.display='block';
    setTimeout(closeAuthModal, 700);
  }else{
    okEl.textContent = "Ro'yxatdan o'tdingiz! Hisobingizni tasdiqlash uchun emailingizni tekshiring.";
    okEl.style.display='block';
  }
});

document.getElementById('forgotPasswordLink').addEventListener('click', async (e)=>{
  e.preventDefault();
  const errEl = document.getElementById('loginError');
  const okEl = document.getElementById('loginSuccess');
  errEl.style.display='none'; okEl.style.display='none';
  const email = document.getElementById('loginEmail').value.trim();
  const emailOk = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
  if(!emailOk){
    validateLoginEmail();
    errEl.textContent = "Avval yuqoridagi maydonga emailingizni kiriting.";
    errEl.style.display='block';
    return;
  }
  if(!sb) return;
  try{
    await sb.auth.resetPasswordForEmail(email, { redirectTo: window.location.href });
    okEl.textContent = "Parolni tiklash havolasi emailingizga yuborildi.";
    okEl.style.display='block';
  }catch(err){
    errEl.textContent = mapAuthError(err && err.message);
    errEl.style.display='block';
  }
});

if(sb){
  sb.auth.getSession().then(({ data })=>{
    currentUser = data && data.session ? data.session.user : null;
    renderAuthUI();
  }).catch(()=>{ renderAuthUI(); });
  sb.auth.onAuthStateChange((_event, session)=>{
    currentUser = session ? session.user : null;
    renderAuthUI();
  });
}else{
  renderAuthUI();
}

/* ================= I18N ================= */
const I18N = {
  uz:{ nav_tests:"Testlar", nav_subjects:"Fanlar", nav_speaking:"Speaking", nav_writing:"Writing", nav_ai:"AI Yordamchi", nav_article:"Maqola", nav_it:"IT", nav_extra:"Yo'nalishlar", nav_teachers:"Ustozlar", nav_register:"Ustoz bo'lish",
    hero_eyebrow:"O'ZBEKISTONDA #1", hero_title:"Bilim — bu <em>nur</em>.<br>ILMNUR bilan o'rganing.",
    hero_lead:"Ona tili, rus tili, ingliz tili va matematikani jonli ustoz yoki AI-robot yordamida, 8 yoshdan boshlab o'rganing.",
    hero_cta1:"Fanlarni ko'rish", hero_cta2:"Bepul testdan o'ting",
    hero_card_1:"Ustoz bilan dars", hero_card_2:"AI-robot bilan dars", hero_card_3:"Yosh chegarasi (o'quvchi)", hero_card_4:"Yosh chegarasi (ustoz)", price_free:"Bepul",
    stat_1:"Asosiy fan", stat_2:"Ro'yxatdan o'tgan ustoz", stat_3:"Til varianti", stat_4:"AI yordamchi",
    tests_eyebrow:"BILIMINGIZNI SINANG", tests_title:"O'tilgan fanlar bo'yicha test", tests_sub:"Fanni tanlang va qisqa testdan o'ting.",
    subjects_eyebrow:"FANLAR", subjects_title:"Fanni va o'qitish usulini tanlang", subjects_sub:"Har bir fanni jonli ustoz yoki AI-robot bilan o'rganishingiz mumkin.",
    ai_eyebrow:"SUN'IY INTELLEKT", ai_title:"ILMNUR AI Yordamchi", ai_lead:"Savolingizni yozing — AI yordamchi yordam beradi.",
    ai_f1_t:"Fan bo'yicha maslahat", ai_f1_d:"Qaysi fan va usul sizga mos kelishini aniqlaydi.",
    ai_f2_t:"Uy vazifasida yordam", ai_f2_d:"Matematika, tillar bo'yicha misollarni tushuntiradi.",
    ai_f3_t:"24/7 mavjud", ai_f3_d:"Ustoz band bo'lganda ham AI har doim javob beradi.",
    ai_greeting:"Salom! Men ILMNUR AI yordamchisiman. Savol bering.", ai_placeholder:"Savolingizni yozing...", ai_send:"Yuborish", ai_title_short:"AI Yordamchi", ai_clear:"Tozalash", ai_sugg1:"Qaysi fanni tanlashim kerak?", ai_sugg2:"Ustoz va AI-robot farqi nima?", ai_sugg3:"Matematikadan misol yechib bering",
    teachers_eyebrow:"USTOZLAR UCHUN", teachers_title:"Ustoz sifatida ro'yxatdan o'ting", teachers_sub:"Faqat 18 yoshdan katta shaxslar ro'yxatdan o'tishi mumkin.",
    form_name:"Ism", form_surname:"Familiya", form_age:"Yosh", form_subject:"Qaysi fandan dars berasiz?", form_phone:"Telefon raqami", form_telegram:"Telegram foydalanuvchi nomi", form_photo:"Rasm havolasi (ixtiyoriy)", form_about:"Dars haqida qisqacha",
    form_error:"Ustoz bo'lish uchun yoshingiz 18 dan katta bo'lishi kerak.", form_submit:"Ro'yxatdan o'tish", form_success:"Muvaffaqiyatli ro'yxatdan o'tdingiz!",
    teachers_empty:"Hozircha ustozlar ro'yxati bo'sh. Birinchi bo'lib ro'yxatdan o'ting!",
    modal_title:"Ro'yxatdan o'tish", modal_sub:"O'quvchi 8 yoshdan katta bo'lishi kerak.", form_student_name:"O'quvchi ismi",
    form_error_age:"O'quvchi yoshi kamida 8 bo'lishi kerak.", modal_confirm:"Tasdiqlash", modal_success:"Ro'yxatga olindingiz!",
    speaking_eyebrow:"SPEAKING", speaking_title:"Speaking — gapirish mashqi", speaking_sub:"Diktafon tugmasini bosing — 20 soniya beriladi. Shu vaqt ichida xohlagan mavzuda, xohlagan tilda matn yozing. Vaqt tugagach, matningiz inglizchaga tarjima qilinib, ovoz orqali o'qib beriladi.", speaking_placeholder:"Bugungi kuningiz haqida yozing...", speaking_record:"🎙️ Diktafon — boshlash (20s)",
    writing_eyebrow:"WRITING", writing_title:"Writing — yozish va tarjima", writing_sub:"Matningizni istalgan tilda yozing, tarjima qilinishi kerak bo'lgan tilni tanlang va tugmani bosing.", writing_placeholder:"Matningizni shu yerga yozing...", writing_translate:"Tarjima qilish",
    footer_text:"O'zbekistondagi #1 ta'lim platformasi. Bilim — nur, nur — kelajak." },
  ru:{ nav_tests:"Тесты", nav_subjects:"Предметы", nav_speaking:"Speaking", nav_writing:"Writing", nav_ai:"AI помощник", nav_article:"Статья", nav_it:"IT", nav_extra:"Направления", nav_teachers:"Учителя", nav_register:"Стать учителем",
    hero_eyebrow:"№1 В УЗБЕКИСТАНЕ", hero_title:"Знание — это <em>свет</em>.<br>Учитесь с ILMNUR.",
    hero_lead:"Изучайте родной язык, русский, английский и математику с живым учителем или AI-роботом, начиная с 8 лет.",
    hero_cta1:"Смотреть предметы", hero_cta2:"Пройти бесплатный тест",
    hero_card_1:"Урок с учителем", hero_card_2:"Урок с AI-роботом", hero_card_3:"Возраст (ученик)", hero_card_4:"Возраст (учитель)", price_free:"Бесплатно",
    stat_1:"Основных предмета", stat_2:"Зарегистрированных учителей", stat_3:"Языков интерфейса", stat_4:"AI помощник",
    tests_eyebrow:"ПРОВЕРЬТЕ ЗНАНИЯ", tests_title:"Тест по пройденным предметам", tests_sub:"Выберите предмет и пройдите короткий тест.",
    subjects_eyebrow:"ПРЕДМЕТЫ", subjects_title:"Выберите предмет и способ обучения", subjects_sub:"Каждый предмет можно изучать с учителем или AI-роботом.",
    ai_eyebrow:"ИСКУССТВЕННЫЙ ИНТЕЛЛЕКТ", ai_title:"AI помощник ILMNUR", ai_lead:"Напишите вопрос — AI поможет.",
    ai_f1_t:"Совет по предмету", ai_f1_d:"Определит, какой предмет и формат вам подходит.",
    ai_f2_t:"Помощь с домашним заданием", ai_f2_d:"Объяснит примеры по математике и языкам.",
    ai_f3_t:"Доступен 24/7", ai_f3_d:"AI всегда отвечает, даже когда учитель занят.",
    ai_greeting:"Привет! Я AI помощник ILMNUR. Задайте вопрос.", ai_placeholder:"Напишите вопрос...", ai_send:"Отправить", ai_title_short:"AI помощник", ai_clear:"Очистить", ai_sugg1:"Какой предмет мне выбрать?", ai_sugg2:"В чём разница между учителем и AI?", ai_sugg3:"Решите пример по математике",
    teachers_eyebrow:"ДЛЯ УЧИТЕЛЕЙ", teachers_title:"Зарегистрируйтесь как учитель", teachers_sub:"Регистрироваться могут только лица старше 18 лет.",
    form_name:"Имя", form_surname:"Фамилия", form_age:"Возраст", form_subject:"Какой предмет вы преподаёте?", form_phone:"Номер телефона", form_telegram:"Имя пользователя Telegram", form_photo:"Ссылка на фото (необязательно)", form_about:"Кратко о занятии",
    form_error:"Чтобы стать учителем, вам должно быть больше 18 лет.", form_submit:"Зарегистрироваться", form_success:"Вы успешно зарегистрированы!",
    teachers_empty:"Список учителей пока пуст. Будьте первым!",
    modal_title:"Регистрация", modal_sub:"Ученику должно быть больше 8 лет.", form_student_name:"Имя ученика",
    form_error_age:"Возраст ученика должен быть не менее 8 лет.", modal_confirm:"Подтвердить", modal_success:"Вы зарегистрированы!",
    speaking_eyebrow:"SPEAKING", speaking_title:"Speaking — практика говорения", speaking_sub:"Нажмите кнопку диктофона — у вас будет 20 секунд. Напишите текст на любую тему и на любом языке. По истечении времени текст будет переведён на английский и озвучен.", speaking_placeholder:"Напишите о своём сегодняшнем дне...", speaking_record:"🎙️ Диктофон — начать (20с)",
    writing_eyebrow:"WRITING", writing_title:"Writing — письмо и перевод", writing_sub:"Напишите текст на любом языке, выберите язык перевода и нажмите кнопку.", writing_placeholder:"Напишите текст здесь...", writing_translate:"Перевести",
    footer_text:"№1 образовательная платформа в Узбекистане. Знание — свет, свет — будущее." },
  en:{ nav_tests:"Tests", nav_subjects:"Subjects", nav_speaking:"Speaking", nav_writing:"Writing", nav_ai:"AI Assistant", nav_article:"Article", nav_it:"IT", nav_extra:"Fields", nav_teachers:"Teachers", nav_register:"Become a teacher",
    hero_eyebrow:"#1 IN UZBEKISTAN", hero_title:"Knowledge is <em>light</em>.<br>Learn with ILMNUR.",
    hero_lead:"Learn native language, Russian, English and Math with a live teacher or an AI robot, starting at age 8.",
    hero_cta1:"Browse subjects", hero_cta2:"Take a free test",
    hero_card_1:"Lesson with a teacher", hero_card_2:"Lesson with AI robot", hero_card_3:"Min. age (student)", hero_card_4:"Min. age (teacher)", price_free:"Free",
    stat_1:"Core subjects", stat_2:"Registered teachers", stat_3:"Interface languages", stat_4:"AI assistant",
    tests_eyebrow:"TEST YOUR KNOWLEDGE", tests_title:"Test on subjects covered", tests_sub:"Pick a subject and take a short quiz.",
    subjects_eyebrow:"SUBJECTS", subjects_title:"Choose a subject and teaching mode", subjects_sub:"Every subject can be learned with a teacher or an AI robot.",
    ai_eyebrow:"ARTIFICIAL INTELLIGENCE", ai_title:"ILMNUR AI Assistant", ai_lead:"Write your question — the AI assistant will help.",
    ai_f1_t:"Subject advice", ai_f1_d:"Finds which subject and mode suits you.",
    ai_f2_t:"Homework help", ai_f2_d:"Explains examples in math and languages.",
    ai_f3_t:"Available 24/7", ai_f3_d:"AI always answers, even when a teacher is busy.",
    ai_greeting:"Hi! I'm the ILMNUR AI assistant. Ask me anything.", ai_placeholder:"Type your question...", ai_send:"Send", ai_title_short:"AI Assistant", ai_clear:"Clear", ai_sugg1:"Which subject should I choose?", ai_sugg2:"What's the difference between a teacher and AI?", ai_sugg3:"Solve a math example for me",
    teachers_eyebrow:"FOR TEACHERS", teachers_title:"Register as a teacher", teachers_sub:"Only people over 18 may register as teachers.",
    form_name:"First name", form_surname:"Last name", form_age:"Age", form_subject:"Which subject do you teach?", form_phone:"Phone number", form_telegram:"Telegram username", form_photo:"Photo link (optional)", form_about:"Brief lesson description",
    form_error:"You must be over 18 to become a teacher.", form_submit:"Register", form_success:"You have registered successfully!",
    teachers_empty:"No teachers yet. Be the first to register!",
    modal_title:"Registration", modal_sub:"The student must be over 8 years old.", form_student_name:"Student's name",
    form_error_age:"Student age must be at least 8.", modal_confirm:"Confirm", modal_success:"You're registered!",
    speaking_eyebrow:"SPEAKING", speaking_title:"Speaking practice", speaking_sub:"Press the record button — you get 20 seconds. Write about any topic in any language. When time is up, your text is translated to English and read aloud.", speaking_placeholder:"Write about your day today...", speaking_record:"🎙️ Start recording (20s)",
    writing_eyebrow:"WRITING", writing_title:"Writing & translation", writing_sub:"Write your text in any language, choose a target language, and click translate.", writing_placeholder:"Write your text here...", writing_translate:"Translate",
    footer_text:"Uzbekistan's #1 education platform. Knowledge is light, light is the future." },
  tr:{ nav_tests:"Testler", nav_subjects:"Dersler", nav_speaking:"Speaking", nav_writing:"Writing", nav_ai:"AI Asistan", nav_article:"Makale", nav_it:"IT", nav_extra:"Alanlar", nav_teachers:"Öğretmenler", nav_register:"Öğretmen ol",
    hero_eyebrow:"ÖZBEKİSTAN'DA #1", hero_title:"Bilgi <em>ışıktır</em>.<br>ILMNUR ile öğrenin.",
    hero_lead:"Ana dil, Rusça, İngilizce ve matematiği canlı öğretmen veya AI robotla, 8 yaşından itibaren öğrenin.",
    hero_cta1:"Dersleri gör", hero_cta2:"Ücretsiz test çöz",
    hero_card_1:"Öğretmenle ders", hero_card_2:"AI robotla ders", hero_card_3:"Min. yaş (öğrenci)", hero_card_4:"Min. yaş (öğretmen)", price_free:"Ücretsiz",
    stat_1:"Ana ders", stat_2:"Kayıtlı öğretmen", stat_3:"Dil seçeneği", stat_4:"AI asistan",
    tests_eyebrow:"BİLGİNİ SINA", tests_title:"İşlenen dersler testi", tests_sub:"Bir ders seçin ve kısa testi çözün.",
    subjects_eyebrow:"DERSLER", subjects_title:"Ders ve öğrenme şeklini seçin", subjects_sub:"Her ders öğretmen veya AI robotla öğrenilebilir.",
    ai_eyebrow:"YAPAY ZEKA", ai_title:"ILMNUR AI Asistan", ai_lead:"Sorunuzu yazın — AI asistan yardımcı olsun.",
    ai_f1_t:"Ders tavsiyesi", ai_f1_d:"Size hangi ders ve yöntemin uygun olduğunu bulur.",
    ai_f2_t:"Ödev yardımı", ai_f2_d:"Matematik ve dil örneklerini açıklar.",
    ai_f3_t:"7/24 mevcut", ai_f3_d:"Öğretmen meşgulken bile AI her zaman yanıtlar.",
    ai_greeting:"Merhaba! Ben ILMNUR AI asistanıyım. Sorunu sor.", ai_placeholder:"Sorunuzu yazın...", ai_send:"Gönder", ai_title_short:"AI Asistan", ai_clear:"Temizle", ai_sugg1:"Hangi dersi seçmeliyim?", ai_sugg2:"Öğretmen ve AI arasındaki fark nedir?", ai_sugg3:"Bana bir matematik örneği çöz",
    teachers_eyebrow:"ÖĞRETMENLER İÇİN", teachers_title:"Öğretmen olarak kaydolun", teachers_sub:"Sadece 18 yaşından büyükler öğretmen olarak kaydolabilir.",
    form_name:"Ad", form_surname:"Soyad", form_age:"Yaş", form_subject:"Hangi dersi veriyorsunuz?", form_phone:"Telefon numarası", form_telegram:"Telegram kullanıcı adı", form_photo:"Fotoğraf bağlantısı (isteğe bağlı)", form_about:"Ders hakkında kısa bilgi",
    form_error:"Öğretmen olmak için 18 yaşından büyük olmalısınız.", form_submit:"Kaydol", form_success:"Başarıyla kaydoldunuz!",
    teachers_empty:"Henüz öğretmen yok. İlk kaydolan siz olun!",
    modal_title:"Kayıt", modal_sub:"Öğrenci 8 yaşından büyük olmalıdır.", form_student_name:"Öğrenci adı",
    form_error_age:"Öğrenci yaşı en az 8 olmalıdır.", modal_confirm:"Onayla", modal_success:"Kaydınız alındı!",
    speaking_eyebrow:"SPEAKING", speaking_title:"Speaking alıştırması", speaking_sub:"Kayıt düğmesine basın — 20 saniyeniz var. İstediğiniz konuda, istediğiniz dilde yazın. Süre bitince metniniz İngilizceye çevrilip sesli okunur.", speaking_placeholder:"Bugününüz hakkında yazın...", speaking_record:"🎙️ Kaydı başlat (20sn)",
    writing_eyebrow:"WRITING", writing_title:"Writing ve çeviri", writing_sub:"Metninizi istediğiniz dilde yazın, çeviri dilini seçin ve düğmeye basın.", writing_placeholder:"Metninizi buraya yazın...", writing_translate:"Çevir",
    footer_text:"Özbekistan'ın #1 eğitim platformu. Bilgi ışıktır, ışık gelecektir." },
  ar:{ nav_tests:"اختبارات", nav_subjects:"المواد", nav_speaking:"التحدث", nav_writing:"الكتابة", nav_ai:"مساعد الذكاء الاصطناعي", nav_article:"مقالة", nav_it:"البرمجة", nav_extra:"مجالات", nav_teachers:"المعلمون", nav_register:"كن معلماً",
    hero_eyebrow:"الأول في أوزبكستان", hero_title:"المعرفة <em>نور</em>.<br>تعلّم مع ILMNUR.",
    hero_lead:"تعلّم اللغة الأم والروسية والإنجليزية والرياضيات مع معلم مباشر أو روبوت ذكاء اصطناعي، بدءاً من سن 8 سنوات.",
    hero_cta1:"تصفح المواد", hero_cta2:"جرّب اختباراً مجانياً",
    hero_card_1:"درس مع معلم", hero_card_2:"درس مع روبوت ذكاء اصطناعي", hero_card_3:"الحد الأدنى للسن (الطالب)", hero_card_4:"الحد الأدنى للسن (المعلم)", price_free:"مجاني",
    stat_1:"مواد أساسية", stat_2:"معلمون مسجلون", stat_3:"لغات الواجهة", stat_4:"مساعد ذكاء اصطناعي",
    tests_eyebrow:"اختبر معرفتك", tests_title:"اختبار حول المواد المدروسة", tests_sub:"اختر مادة وخض اختباراً قصيراً.",
    subjects_eyebrow:"المواد", subjects_title:"اختر المادة وطريقة التعلّم", subjects_sub:"يمكن تعلّم كل مادة مع معلم أو روبوت ذكاء اصطناعي.",
    ai_eyebrow:"الذكاء الاصطناعي", ai_title:"مساعد ILMNUR الذكي", ai_lead:"اكتب سؤالك — سيساعدك المساعد الذكي.",
    ai_f1_t:"نصيحة حول المادة", ai_f1_d:"يحدد المادة والطريقة الأنسب لك.",
    ai_f2_t:"مساعدة في الواجبات", ai_f2_d:"يشرح أمثلة في الرياضيات واللغات.",
    ai_f3_t:"متاح على مدار الساعة", ai_f3_d:"يجيب المساعد دائماً حتى عند انشغال المعلم.",
    ai_greeting:"مرحباً! أنا مساعد ILMNUR الذكي. اسألني.", ai_placeholder:"اكتب سؤالك...", ai_send:"إرسال", ai_title_short:"مساعد ذكي", ai_clear:"مسح", ai_sugg1:"أي مادة يجب أن أختار؟", ai_sugg2:"ما الفرق بين المعلم والذكاء الاصطناعي؟", ai_sugg3:"حل لي مثالاً في الرياضيات",
    teachers_eyebrow:"للمعلمين", teachers_title:"سجّل كمعلم", teachers_sub:"يمكن فقط لمن هم فوق 18 عاماً التسجيل كمعلمين.",
    form_name:"الاسم", form_surname:"اللقب", form_age:"العمر", form_subject:"أي مادة تُدرّس؟", form_phone:"رقم الهاتف", form_telegram:"اسم مستخدم Telegram", form_photo:"رابط الصورة (اختياري)", form_about:"وصف موجز للدرس",
    form_error:"يجب أن يكون عمرك أكثر من 18 عاماً لتصبح معلماً.", form_submit:"تسجيل", form_success:"تم التسجيل بنجاح!",
    teachers_empty:"لا يوجد معلمون بعد. كن أول من يسجل!",
    modal_title:"التسجيل", modal_sub:"يجب أن يكون عمر الطالب أكثر من 8 سنوات.", form_student_name:"اسم الطالب",
    form_error_age:"يجب ألا يقل عمر الطالب عن 8 سنوات.", modal_confirm:"تأكيد", modal_success:"تم تسجيلك!",
    speaking_eyebrow:"التحدث", speaking_title:"تمرين التحدث", speaking_sub:"اضغط على زر التسجيل — ستحصل على 20 ثانية. اكتب عن أي موضوع بأي لغة. عند انتهاء الوقت سيُترجم نصك إلى الإنجليزية ويُقرأ بصوت عالٍ.", speaking_placeholder:"اكتب عن يومك اليوم...", speaking_record:"🎙️ ابدأ التسجيل (٢٠ث)",
    writing_eyebrow:"الكتابة", writing_title:"الكتابة والترجمة", writing_sub:"اكتب نصك بأي لغة، اختر لغة الترجمة، ثم اضغط الزر.", writing_placeholder:"اكتب نصك هنا...", writing_translate:"ترجم",
    footer_text:"المنصة التعليمية الأولى في أوزبكستان. المعرفة نور، والنور مستقبل." },
  zh:{ nav_tests:"测试", nav_subjects:"科目", nav_speaking:"口语", nav_writing:"写作", nav_ai:"AI助手", nav_article:"文章", nav_it:"编程", nav_extra:"领域", nav_teachers:"教师", nav_register:"成为教师",
    hero_eyebrow:"乌兹别克斯坦第一", hero_title:"知识就是<em>光</em>。<br>与ILMNUR一起学习。",
    hero_lead:"从8岁起，通过真人教师或AI机器人学习母语、俄语、英语和数学。",
    hero_cta1:"浏览科目", hero_cta2:"参加免费测试",
    hero_card_1:"教师课程", hero_card_2:"AI机器人课程", hero_card_3:"最低年龄（学生）", hero_card_4:"最低年龄（教师）", price_free:"免费",
    stat_1:"核心科目", stat_2:"已注册教师", stat_3:"界面语言", stat_4:"AI助手",
    tests_eyebrow:"测试你的知识", tests_title:"已学科目测试", tests_sub:"选择一个科目，进行简短测试。",
    subjects_eyebrow:"科目", subjects_title:"选择科目和学习方式", subjects_sub:"每个科目都可以选择教师或AI机器人学习。",
    ai_eyebrow:"人工智能", ai_title:"ILMNUR AI助手", ai_lead:"写下你的问题——AI助手会帮助你。",
    ai_f1_t:"科目建议", ai_f1_d:"帮你确定适合的科目和方式。",
    ai_f2_t:"作业帮助", ai_f2_d:"讲解数学和语言方面的例题。",
    ai_f3_t:"全天候可用", ai_f3_d:"即使教师忙碌，AI也会随时回答。",
    ai_greeting:"你好！我是ILMNUR的AI助手，请随时提问。", ai_placeholder:"输入你的问题...", ai_send:"发送", ai_title_short:"AI助手", ai_clear:"清除", ai_sugg1:"我应该选择哪个科目？", ai_sugg2:"老师和AI机器人有什么区别？", ai_sugg3:"帮我解一道数学题",
    teachers_eyebrow:"教师专区", teachers_title:"注册成为教师", teachers_sub:"只有年满18岁的人才能注册成为教师。",
    form_name:"名", form_surname:"姓", form_age:"年龄", form_subject:"你教授哪个科目？", form_phone:"电话号码", form_telegram:"Telegram用户名", form_photo:"照片链接（可选）", form_about:"课程简介",
    form_error:"必须年满18岁才能成为教师。", form_submit:"注册", form_success:"注册成功！",
    teachers_empty:"目前还没有教师。快来做第一个吧！",
    modal_title:"注册", modal_sub:"学生必须年满8岁。", form_student_name:"学生姓名",
    form_error_age:"学生年龄必须至少为8岁。", modal_confirm:"确认", modal_success:"注册成功！",
    speaking_eyebrow:"口语", speaking_title:"口语练习", speaking_sub:"按下录音按钮——你有20秒时间。用任意语言写下任意主题的内容。时间到后，文本会被翻译成英语并朗读出来。", speaking_placeholder:"写写你今天的一天...", speaking_record:"🎙️ 开始录音（20秒）",
    writing_eyebrow:"写作", writing_title:"写作与翻译", writing_sub:"用任意语言写下文本，选择目标语言，然后点击翻译按钮。", writing_placeholder:"在此写下你的文本...", writing_translate:"翻译",
    footer_text:"乌兹别克斯坦第一教育平台。知识是光，光是未来。" },
  fr:{ nav_tests:"Tests", nav_subjects:"Matières", nav_speaking:"Speaking", nav_writing:"Writing", nav_ai:"Assistant IA", nav_article:"Article", nav_it:"IT", nav_extra:"Domaines", nav_teachers:"Enseignants", nav_register:"Devenir enseignant",
    hero_eyebrow:"N°1 EN OUZBÉKISTAN", hero_title:"Le savoir est <em>lumière</em>.<br>Apprenez avec ILMNUR.",
    hero_lead:"Apprenez la langue maternelle, le russe, l'anglais et les mathématiques avec un enseignant ou un robot IA, dès 8 ans.",
    hero_cta1:"Voir les matières", hero_cta2:"Faire un test gratuit",
    hero_card_1:"Cours avec un enseignant", hero_card_2:"Cours avec un robot IA", hero_card_3:"Âge min. (élève)", hero_card_4:"Âge min. (enseignant)", price_free:"Gratuit",
    stat_1:"Matières principales", stat_2:"Enseignants inscrits", stat_3:"Langues disponibles", stat_4:"Assistant IA",
    tests_eyebrow:"TESTEZ VOS CONNAISSANCES", tests_title:"Test sur les matières étudiées", tests_sub:"Choisissez une matière et passez un court test.",
    subjects_eyebrow:"MATIÈRES", subjects_title:"Choisissez une matière et un mode", subjects_sub:"Chaque matière peut être apprise avec un enseignant ou un robot IA.",
    ai_eyebrow:"INTELLIGENCE ARTIFICIELLE", ai_title:"Assistant IA ILMNUR", ai_lead:"Écrivez votre question — l'assistant IA vous aidera.",
    ai_f1_t:"Conseil de matière", ai_f1_d:"Détermine la matière et le mode qui vous conviennent.",
    ai_f2_t:"Aide aux devoirs", ai_f2_d:"Explique des exemples en maths et en langues.",
    ai_f3_t:"Disponible 24/7", ai_f3_d:"L'IA répond toujours, même si l'enseignant est occupé.",
    ai_greeting:"Bonjour ! Je suis l'assistant IA d'ILMNUR. Posez votre question.", ai_placeholder:"Écrivez votre question...", ai_send:"Envoyer", ai_title_short:"Assistant IA", ai_clear:"Effacer", ai_sugg1:"Quelle matière dois-je choisir ?", ai_sugg2:"Quelle est la différence entre un enseignant et l'IA ?", ai_sugg3:"Résolvez un exemple de maths pour moi",
    teachers_eyebrow:"POUR LES ENSEIGNANTS", teachers_title:"Inscrivez-vous comme enseignant", teachers_sub:"Seules les personnes de plus de 18 ans peuvent s'inscrire.",
    form_name:"Prénom", form_surname:"Nom", form_age:"Âge", form_subject:"Quelle matière enseignez-vous ?", form_phone:"Numéro de téléphone", form_telegram:"Nom d'utilisateur Telegram", form_photo:"Lien photo (facultatif)", form_about:"Brève description du cours",
    form_error:"Vous devez avoir plus de 18 ans pour devenir enseignant.", form_submit:"S'inscrire", form_success:"Inscription réussie !",
    teachers_empty:"Aucun enseignant pour l'instant. Soyez le premier !",
    modal_title:"Inscription", modal_sub:"L'élève doit avoir plus de 8 ans.", form_student_name:"Nom de l'élève",
    form_error_age:"L'élève doit avoir au moins 8 ans.", modal_confirm:"Confirmer", modal_success:"Vous êtes inscrit !",
    speaking_eyebrow:"SPEAKING", speaking_title:"Exercice de speaking", speaking_sub:"Appuyez sur le bouton d'enregistrement — vous avez 20 secondes. Écrivez sur un sujet, dans la langue de votre choix. Une fois le temps écoulé, votre texte sera traduit en anglais et lu à voix haute.", speaking_placeholder:"Écrivez à propos de votre journée...", speaking_record:"🎙️ Démarrer (20s)",
    writing_eyebrow:"WRITING", writing_title:"Writing et traduction", writing_sub:"Écrivez votre texte dans la langue de votre choix, choisissez une langue cible et cliquez sur traduire.", writing_placeholder:"Écrivez votre texte ici...", writing_translate:"Traduire",
    footer_text:"La plateforme éducative n°1 d'Ouzbékistan. Le savoir est lumière, la lumière est l'avenir." },
  de:{ nav_tests:"Tests", nav_subjects:"Fächer", nav_speaking:"Speaking", nav_writing:"Writing", nav_ai:"KI-Assistent", nav_article:"Artikel", nav_it:"IT", nav_extra:"Bereiche", nav_teachers:"Lehrer", nav_register:"Lehrer werden",
    hero_eyebrow:"NR. 1 IN USBEKISTAN", hero_title:"Wissen ist <em>Licht</em>.<br>Lerne mit ILMNUR.",
    hero_lead:"Lerne Muttersprache, Russisch, Englisch und Mathematik mit einem echten Lehrer oder einem KI-Roboter, ab 8 Jahren.",
    hero_cta1:"Fächer ansehen", hero_cta2:"Kostenlosen Test machen",
    hero_card_1:"Unterricht mit Lehrer", hero_card_2:"Unterricht mit KI-Roboter", hero_card_3:"Mindestalter (Schüler)", hero_card_4:"Mindestalter (Lehrer)", price_free:"Kostenlos",
    stat_1:"Kernfächer", stat_2:"Registrierte Lehrer", stat_3:"Verfügbare Sprachen", stat_4:"KI-Assistent",
    tests_eyebrow:"TESTE DEIN WISSEN", tests_title:"Test zu den behandelten Fächern", tests_sub:"Wähle ein Fach und mache ein kurzes Quiz.",
    subjects_eyebrow:"FÄCHER", subjects_title:"Wähle Fach und Lernmodus", subjects_sub:"Jedes Fach kann mit einem Lehrer oder einem KI-Roboter gelernt werden.",
    ai_eyebrow:"KÜNSTLICHE INTELLIGENZ", ai_title:"ILMNUR KI-Assistent", ai_lead:"Schreib deine Frage — der KI-Assistent hilft dir.",
    ai_f1_t:"Fachberatung", ai_f1_d:"Findet heraus, welches Fach und welcher Modus zu dir passt.",
    ai_f2_t:"Hausaufgabenhilfe", ai_f2_d:"Erklärt Beispiele in Mathe und Sprachen.",
    ai_f3_t:"24/7 verfügbar", ai_f3_d:"Die KI antwortet immer, auch wenn der Lehrer beschäftigt ist.",
    ai_greeting:"Hallo! Ich bin der ILMNUR KI-Assistent. Stell mir eine Frage.", ai_placeholder:"Schreib deine Frage...", ai_send:"Senden", ai_title_short:"KI-Assistent", ai_clear:"Löschen", ai_sugg1:"Welches Fach soll ich wählen?", ai_sugg2:"Was ist der Unterschied zwischen Lehrer und KI?", ai_sugg3:"Löse ein Matheaufgabe für mich",
    teachers_eyebrow:"FÜR LEHRER", teachers_title:"Registriere dich als Lehrer", teachers_sub:"Nur Personen über 18 Jahre können sich als Lehrer registrieren.",
    form_name:"Vorname", form_surname:"Nachname", form_age:"Alter", form_subject:"Welches Fach unterrichtest du?", form_phone:"Telefonnummer", form_telegram:"Telegram-Benutzername", form_photo:"Foto-Link (optional)", form_about:"Kurze Beschreibung des Unterrichts",
    form_error:"Du musst über 18 Jahre alt sein, um Lehrer zu werden.", form_submit:"Registrieren", form_success:"Erfolgreich registriert!",
    teachers_empty:"Noch keine Lehrer. Sei der Erste!",
    modal_title:"Registrierung", modal_sub:"Der Schüler muss über 8 Jahre alt sein.", form_student_name:"Name des Schülers",
    form_error_age:"Das Alter des Schülers muss mindestens 8 Jahre betragen.", modal_confirm:"Bestätigen", modal_success:"Du bist registriert!",
    speaking_eyebrow:"SPEAKING", speaking_title:"Speaking-Übung", speaking_sub:"Drücke den Aufnahmeknopf — du hast 20 Sekunden. Schreibe über ein beliebiges Thema in einer beliebigen Sprache. Danach wird dein Text ins Englische übersetzt und vorgelesen.", speaking_placeholder:"Schreibe über deinen heutigen Tag...", speaking_record:"🎙️ Aufnahme starten (20s)",
    writing_eyebrow:"WRITING", writing_title:"Writing und Übersetzung", writing_sub:"Schreibe deinen Text in einer beliebigen Sprache, wähle eine Zielsprache und klicke auf Übersetzen.", writing_placeholder:"Schreibe deinen Text hier...", writing_translate:"Übersetzen",
    footer_text:"Usbekistans führende Bildungsplattform. Wissen ist Licht, Licht ist Zukunft." }
};

function applyLang(lang){
  document.documentElement.setAttribute('data-lang', lang);
  document.documentElement.setAttribute('dir', lang==='ar' ? 'rtl' : 'ltr');
  const dict = I18N[lang] || I18N.uz;
  document.querySelectorAll('[data-i18n]').forEach(el=>{
    const key = el.getAttribute('data-i18n');
    if(dict[key]!==undefined) el.innerHTML = dict[key];
  });
  document.querySelectorAll('[data-i18n-placeholder]').forEach(el=>{
    const key = el.getAttribute('data-i18n-placeholder');
    if(dict[key]!==undefined) el.setAttribute('placeholder', dict[key]);
  });
}
document.getElementById('langSelect').addEventListener('change', e=>applyLang(e.target.value));

/* ================= SUBJECTS ================= */
const SUBJECTS = [
  {id:'ona', name:"Ona tili", color:'#1F9D6C', mono:'O', desc:"Savodxonlik, imlo va nutq o'stirish.", cat:"Tillar", isNew:false, pageId:'onatili'},
  {id:'rus', name:"Rus tili", color:'#E2574C', mono:'Р', desc:"Grammatika, muloqot va lug'at boyligi.", cat:"Tillar", isNew:false, pageId:'rustili'},
  {id:'ingliz', name:"Ingliz tili", color:'#2E6BE0', mono:'E', desc:"Speaking, grammar va real muloqot ko'nikmalari.", cat:"Tillar", isNew:false, pageId:'inglizt'},
  {id:'mat', name:"Matematika", color:'#F2A93C', mono:'M', desc:"Mantiq, arifmetika va masala yechish ko'nikmalari.", cat:"Aniq fanlar", isNew:false, pageId:'matsub'},
  {id:'psix', name:"Psixologiya", color:'#8B5FBF', mono:'P', desc:"Inson xulq-atvori, hissiyotlar va fikrlash asoslari.", cat:"Yangi yo'nalishlar", isNew:true, pageId:'psixologiya'},
  {id:'robot', name:"Robototexnika", color:'#0891B2', mono:'R', desc:"Sensorlar, motorlar va robotlarni dasturlash asoslari.", cat:"Yangi yo'nalishlar", isNew:true, pageId:'robototexnika'},
  {id:'oshpaz', name:"Oshpazlik", color:'#E8752C', mono:'Ош', desc:"Pishirish texnikasi, retseptlar va oshxona madaniyati.", cat:"Yangi yo'nalishlar", isNew:true, pageId:'oshpazlik'},
  {id:'kiber', name:"Kiber xavsizlik", color:'#334155', mono:'K', desc:"Parollar, fishing va shaxsiy ma'lumotlarni himoya qilish.", cat:"Yangi yo'nalishlar", isNew:true, pageId:'kiber'},
];
const subjGrid = document.getElementById('subjectsGrid');
const subjectsEmpty = document.getElementById('subjectsEmpty');
let subjectCategory = 'Barchasi';
let subjectSearchTerm = '';

function renderSubjectCards(){
  let list = SUBJECTS;
  if(subjectCategory !== 'Barchasi'){
    list = list.filter(s=>s.cat===subjectCategory);
  }
  if(subjectSearchTerm){
    const q = subjectSearchTerm.toLowerCase();
    list = list.filter(s=>s.name.toLowerCase().includes(q) || s.desc.toLowerCase().includes(q));
  }
  subjGrid.innerHTML = '';
  subjectsEmpty.style.display = list.length ? 'none' : 'block';
  list.forEach(s=>{
    const card = document.createElement('div');
    card.className='subj-card';
    card.innerHTML = `
      ${s.isNew ? '<span class="subj-new-badge">Yangi</span>' : ''}
      <div class="subj-top">
        <div class="subj-icon" style="background:${s.color};">${s.mono}</div>
        <h3 style="font-size:19px;">${s.name}</h3>
      </div>
      <p class="desc">${s.desc}</p>
      <div class="mode-row">
        <button class="mode-btn active" data-mode="teacher">
          <span class="lbl">Ustoz bilan (alohida narx)</span><span class="price mono">50 000 so'm / hafta</span>
        </button>
        <button class="mode-btn" data-mode="ai">
          <span class="lbl">AI Robot bilan</span><span class="price mono">Bepul</span>
        </button>
      </div>
      <p style="font-size:12px;color:var(--slate);margin:0;">* Ko'rsatilgan narx — haftalik ro'yxatdan o'tish narxi.</p>
      <button class="btn choose-btn">Ro'yxatdan o'tish</button>
      ${s.pageId ? `<button class="btn ghost lessons-link-btn" data-page="${s.pageId}" type="button" style="border-color:${s.color};color:${s.color};">To'liq darslarni ko'rish →</button>` : ''}
    `;
    const modeBtns = card.querySelectorAll('.mode-btn');
    let selectedMode = 'teacher';
    modeBtns.forEach(b=>b.addEventListener('click', ()=>{
      modeBtns.forEach(x=>x.classList.remove('active'));
      b.classList.add('active');
      selectedMode = b.getAttribute('data-mode');
    }));
    card.querySelector('.choose-btn').addEventListener('click', ()=>{
      openEnrollModal(s.name, selectedMode);
    });
    const lessonsBtn = card.querySelector('.lessons-link-btn');
    if(lessonsBtn){
      lessonsBtn.addEventListener('click', ()=>scrollToSection(lessonsBtn.dataset.page));
    }
    subjGrid.appendChild(card);
  });
}
renderSubjectCards();

document.getElementById('subjectSearch').addEventListener('input', e=>{
  subjectSearchTerm = e.target.value.trim();
  renderSubjectCards();
});
document.querySelectorAll('#subjectCategoryChips .chip').forEach(chip=>{
  chip.addEventListener('click', ()=>{
    document.querySelectorAll('#subjectCategoryChips .chip').forEach(c=>c.classList.remove('active'));
    chip.classList.add('active');
    subjectCategory = chip.dataset.cat;
    renderSubjectCards();
  });
});

/* ================= REGISTRATION QUESTION BANKS (20 per subject) ================= */
const REG_QUESTIONS = {
  "Ona tili":[
    {q:"\"Kitob\" so'zida nechta bo'g'in bor?", opts:["1","2","3"], correct:1, explain:"Ki-tob — so'z ikki bo'g'indan iborat."},
    {q:"Qaysi so'z sifat turkumiga kiradi?", opts:["Yugurmoq","Chiroyli","Kitob"], correct:1, explain:"Sifat narsaning belgisini bildiradi: chiroyli."},
    {q:"Darak gap oxiriga qanday belgi qo'yiladi?", opts:["Vergul","Nuqta","Chiziqcha"], correct:1, explain:"Darak gap nuqta bilan tugaydi."},
    {q:"Qaysi so'z ot (narsa nomi) hisoblanadi?", opts:["Stol","Yugurmoq","Chiroyli"], correct:0, explain:"Stol — narsa nomi, demak ot turkumiga kiradi."},
    {q:"\"Kel\" so'zi qaysi turkumga kiradi?", opts:["Ot","Fe'l","Sifat"], correct:1, explain:"Harakatni bildiradi, demak fe'l."},
    {q:"So'roq gapda qanday belgi ishlatiladi?", opts:["Undov belgisi","So'roq belgisi","Nuqta"], correct:1, explain:"Savol gap so'roq belgisi bilan tugaydi."},
    {q:"\"Kitoblar\" so'zi qanday sonda?", opts:["Birlik","Ko'plik","Noaniq"], correct:1, explain:"-lar qo'shimchasi ko'plikni bildiradi."},
    {q:"Qaysi harf unli tovush?", opts:["B","A","K"], correct:1, explain:"A — unli tovush, boshqalari undosh."},
    {q:"\"Salom\" so'zi nima uchun ishlatiladi?", opts:["Xayrlashish","Salomlashish","Rozilik"], correct:1, explain:"Salom — uchrashganda ishlatiladigan so'z."},
    {q:"Qaysi so'z olmosh?", opts:["Men","Kitob","Yozmoq"], correct:0, explain:"Men — kishilik olmoshi."},
    {q:"Sabab bildiruvchi bog'lovchini toping.", opts:["Va","Chunki","Lekin"], correct:1, explain:"\"Chunki\" sababni bildiradi."},
    {q:"Bahor faslida nima bo'ladi?", opts:["Qor yog'adi","Gullar ochiladi","Barglar to'kiladi"], correct:1, explain:"Bahorda tabiat uyg'onib, gullar ochiladi."},
    {q:"Undov gap oxiriga qanday belgi qo'yiladi?", opts:["Nuqta","Undov belgisi","Vergul"], correct:1, explain:"His-hayajonni ifodalovchi gap undov belgisi bilan tugaydi."},
    {q:"\"Kitobxon\" so'zi qanday yasalgan?", opts:["Qo'shma so'z","Sodda so'z","Juft so'z"], correct:0, explain:"Kitob + xon — ikki asosdan tuzilgan, qo'shma so'z."},
    {q:"Qarama-qarshi ma'noli so'zlarga (antonim) misol toping.", opts:["Katta–kichik","Katta–ulkan","Kichik–mayda"], correct:0, explain:"Katta va kichik — ma'nosi qarama-qarshi so'zlar."},
    {q:"O'xshash ma'noli so'zlarga (sinonim) misol toping.", opts:["Chiroyli–go'zal","Katta–kichik","Issiq–sovuq"], correct:0, explain:"Chiroyli va go'zal — ma'nosi yaqin so'zlar."},
    {q:"Qaysi biri ertak janriga misol bo'ladi?", opts:["Uch og'a-ini bahodirlar","Bugungi yangilik","Reklama matni"], correct:0, explain:"Bu — xalq og'zaki ijodiga oid ertak nomi."},
    {q:"Qaysi so'z bosh harf bilan yoziladi?", opts:["kitob","toshkent","daftar"], correct:1, explain:"Shahar nomi doim bosh harf bilan yoziladi — Toshkent."},
    {q:"\"Non\" so'zi necha harfdan iborat?", opts:["2","3","4"], correct:1, explain:"N-o-n — uch harf."},
    {q:"Matnning asosiy mavzusi qanday nomlanadi?", opts:["Sarlavha","Xulosa","Reja"], correct:0, explain:"Sarlavha matn mavzusini qisqacha bildiradi."},
    {q:"\"Ustoz\" so'zi qaysi turkumga kiradi?", opts:["Ot","Fe'l","Sifat"], correct:0, explain:"Shaxs nomini bildiradi, demak ot."},
    {q:"Qaysi so'z fe'l bo'lishi mumkin?", opts:["Yozmoq","Qalam","Ozod"], correct:0, explain:"\"Yozmoq\" harakatni bildiradi, demak fe'l."},
    {q:"\"Katta\" so'zining qarama-qarshi ma'nosi qaysi?", opts:["Kichik","Uzun","Baland"], correct:0, explain:"\"Katta\" va \"kichik\" — antonim so'zlar."},
    {q:"Gapda ega nimani bildiradi?", opts:["Harakatni","Bajaruvchini","Vaqtni"], correct:1, explain:"Ega — gapda harakatni bajaruvchi shaxs yoki narsani bildiradi."},
    {q:"\"Bugun havo issiq.\" gapida nechta so'z bor?", opts:["2","3","4"], correct:1, explain:"Bugun, havo, issiq — jami uchta so'z."},
  ],
  "Rus tili":[
    {q:"Как переводится слово \"книга\"?", opts:["Kitob","Qalam","Daftar"], correct:0, explain:"\"Книга\" — bu \"kitob\" degani."},
    {q:"Какое слово является глаголом?", opts:["Красивый","Читать","Стол"], correct:1, explain:"\"Читать\" — harakatni bildiradi, demak fe'l (глагол)."},
    {q:"Сколько падежей в русском языке?", opts:["4","6","8"], correct:1, explain:"Rus tilida 6 ta kelishik mavjud."},
    {q:"Как переводится слово \"стол\"?", opts:["Stul","Stol","Devor"], correct:1, explain:"\"Стол\" — \"stol\" degani."},
    {q:"Какое слово является существительным?", opts:["Бежать","Дом","Быстро"], correct:1, explain:"\"Дом\" — narsa nomi, demak ot (существительное)."},
    {q:"На какой вопрос отвечает родительный падеж?", opts:["Кто? Что?","Кого? Чего?","Кому? Чему?"], correct:1, explain:"Родительный падеж — \"Кого? Чего?\" savoliga javob beradi."},
    {q:"Как переводится слово \"вода\"?", opts:["Suv","Olov","Havo"], correct:0, explain:"\"Вода\" — \"suv\" degani."},
    {q:"Какое слово является прилагательным?", opts:["Красный","Бежать","Дом"], correct:0, explain:"\"Красный\" belgini bildiradi, demak sifat."},
    {q:"Множественное число слова \"книга\":", opts:["Книги","Книгам","Книгой"], correct:0, explain:"Ko'plik shakli — \"книги\"."},
    {q:"Как сказать \"здравствуйте\" по-узбекски?", opts:["Xayr","Assalomu alaykum","Rahmat"], correct:1, explain:"\"Здравствуйте\" — \"Assalomu alaykum\" degani."},
    {q:"Какой глагол стоит в прошедшем времени?", opts:["Читаю","Читал","Буду читать"], correct:1, explain:"\"Читал\" — o'tgan zamon shakli."},
    {q:"Как переводится слово \"спасибо\"?", opts:["Rahmat","Iltimos","Kechirasiz"], correct:0, explain:"\"Спасибо\" — \"rahmat\" degani."},
    {q:"Какое слово является местоимением?", opts:["Я","Стол","Читать"], correct:0, explain:"\"Я\" — kishilik olmoshi (местоимение)."},
    {q:"\"Мама\" — это какая часть речи?", opts:["Глагол","Существительное","Наречие"], correct:1, explain:"\"Мама\" — narsa/shaxs nomi, demak ot."},
    {q:"Как переводится слово \"хорошо\"?", opts:["Yomon","Yaxshi","O'rtacha"], correct:1, explain:"\"Хорошо\" — \"yaxshi\" degani."},
    {q:"Сколько букв в слове \"школа\"?", opts:["4","5","6"], correct:1, explain:"Ш-к-о-л-а — beshta harf."},
    {q:"Как переводится слово \"друг\"?", opts:["Do'st","Dushman","Qarindosh"], correct:0, explain:"\"Друг\" — \"do'st\" degani."},
    {q:"Как называются числа \"один, два, три\"?", opts:["Порядковые","Количественные","Дробные"], correct:1, explain:"Bular — sanoq son (количественные числительные)."},
    {q:"Как переводится \"до свидания\"?", opts:["Salom","Xayr","Kechirasiz"], correct:1, explain:"\"До свидания\" — \"xayr\" degani."},
    {q:"Какой предлог используется в \"иду в школу\"?", opts:["в","на","из"], correct:0, explain:"To'g'ri shakli — \"иду в школу\"."},
    {q:"Как переводится слово \"хлеб\"?", opts:["Non","Sut","Go'sht"], correct:0, explain:"\"Хлеб\" — \"non\" degani."},
    {q:"Какое слово является наречием?", opts:["Быстро","Стол","Красный"], correct:0, explain:"\"Быстро\" harakat tarzini bildiradi, demak ravish (наречие)."},
    {q:"Как переводится слово \"школа\"?", opts:["Maktab","Uy","Bog'cha"], correct:0, explain:"\"Школа\" — \"maktab\" degani."},
    {q:"Какой падеж отвечает на вопрос \"Кому? Чему?\"?", opts:["Дательный","Винительный","Творительный"], correct:0, explain:"\"Кому? Чему?\" — дательный падеж savoli."},
    {q:"Как переводится слово \"учитель\"?", opts:["O'quvchi","Ustoz","Do'st"], correct:1, explain:"\"Учитель\" — \"ustoz\" degani."},
  ],
  "Ingliz tili":[
    {q:"What is the plural of \"child\"?", opts:["Childs","Children","Childes"], correct:1, explain:"\"Children\" is the irregular plural of \"child\"."},
    {q:"Choose the correct verb: \"She ___ to school.\"", opts:["go","goes","going"], correct:1, explain:"With he/she/it we add -s: \"goes\"."},
    {q:"What is the English word for \"kitob\"?", opts:["Book","Pen","Desk"], correct:0, explain:"\"Kitob\" means \"book\" in English."},
    {q:"What is the past tense of \"go\"?", opts:["Goed","Went","Going"], correct:1, explain:"\"Go\" is irregular — past tense is \"went\"."},
    {q:"Choose the correct article: \"___ apple\"", opts:["A","An","The"], correct:1, explain:"Before a vowel sound we use \"an\"."},
    {q:"What is the opposite of \"big\"?", opts:["Small","Tall","Wide"], correct:0, explain:"\"Small\" is the opposite of \"big\"."},
    {q:"Which word is a verb?", opts:["Happy","Run","Table"], correct:1, explain:"\"Run\" describes an action, so it's a verb."},
    {q:"\"They ___ students.\"", opts:["is","am","are"], correct:2, explain:"With \"they\" we use \"are\"."},
    {q:"What is the English word for \"uy\"?", opts:["House","Car","Tree"], correct:0, explain:"\"Uy\" means \"house\" in English."},
    {q:"Choose the correct question word: \"___ is your name?\"", opts:["What","Where","When"], correct:0, explain:"We ask about a name with \"What\"."},
    {q:"What is the plural of \"book\"?", opts:["Book","Books","Bookes"], correct:1, explain:"Regular plural: add -s → \"books\"."},
    {q:"Which word is a color?", opts:["Jump","Blue","Fast"], correct:1, explain:"\"Blue\" is a color."},
    {q:"\"I have two ___.\"", opts:["dog","dogs","doges"], correct:1, explain:"After \"two\" we use the plural form: \"dogs\"."},
    {q:"What is the opposite of \"hot\"?", opts:["Cold","Warm","Wet"], correct:0, explain:"\"Cold\" is the opposite of \"hot\"."},
    {q:"\"He ___ a teacher.\"", opts:["am","is","are"], correct:1, explain:"With \"he\" we use \"is\"."},
    {q:"What day comes after Monday?", opts:["Sunday","Tuesday","Friday"], correct:1, explain:"Tuesday follows Monday."},
    {q:"Choose the correct word: \"This is ___ book.\"", opts:["I","my","me"], correct:1, explain:"\"My\" shows possession before a noun."},
    {q:"What is \"salom\" in English?", opts:["Goodbye","Hello","Thanks"], correct:1, explain:"\"Salom\" means \"Hello\"."},
    {q:"Which word means a number?", opts:["Five","Table","Green"], correct:0, explain:"\"Five\" is a number word."},
    {q:"\"We ___ happy.\"", opts:["is","am","are"], correct:2, explain:"With \"we\" we use \"are\"."},
    {q:"What is the opposite of \"up\"?", opts:["Down","Left","Near"], correct:0, explain:"\"Down\" is the opposite of \"up\"."},
    {q:"Choose the correct sentence.", opts:["She like apples","She likes apples","She liking apples"], correct:1, explain:"With he/she/it we add -s to the verb: \"likes\"."},
    {q:"What is \"maktab\" in English?", opts:["School","Home","Shop"], correct:0, explain:"\"Maktab\" means \"school\" in English."},
    {q:"How many days are in a week?", opts:["5","6","7"], correct:2, explain:"There are 7 days in a week."},
    {q:"What is the plural of \"man\"?", opts:["Mans","Men","Manes"], correct:1, explain:"\"Man\" has an irregular plural: \"men\"."},
  ],
  "Matematika":[
    {q:"7 x 8 = ?", opts:["54","56","64"], correct:1, explain:"7 x 8 = 56."},
    {q:"Uchburchak necha burchakka ega?", opts:["3","4","5"], correct:0, explain:"Uchburchakning nomi ham aytib turibdiki, 3 ta burchagi bor."},
    {q:"12 ning yarmi nechaga teng?", opts:["4","6","8"], correct:1, explain:"12 ni 2 ga bo'lsak — 6."},
    {q:"15 + 27 = ?", opts:["42","32","52"], correct:0, explain:"15 + 27 = 42."},
    {q:"100 - 45 = ?", opts:["55","45","65"], correct:0, explain:"100 - 45 = 55."},
    {q:"Kvadratning necha tomoni bor?", opts:["3","4","5"], correct:1, explain:"Kvadrat — to'rt tomonli shakl."},
    {q:"9 x 9 = ?", opts:["81","72","90"], correct:0, explain:"9 x 9 = 81."},
    {q:"5 ning kvadrati nechaga teng?", opts:["10","25","15"], correct:1, explain:"5 x 5 = 25."},
    {q:"Bir soatda necha daqiqa bor?", opts:["50","60","100"], correct:1, explain:"1 soat = 60 daqiqa."},
    {q:"3/4 ning o'ndalik ko'rinishi qaysi?", opts:["0.75","0.5","0.34"], correct:0, explain:"3 ni 4 ga bo'lsak 0.75 chiqadi."},
    {q:"20 ni 4 ga bo'lsak nechaga teng?", opts:["4","5","6"], correct:1, explain:"20 : 4 = 5."},
    {q:"Aylananing markazidan chetigacha bo'lgan masofa nima deyiladi?", opts:["Diametr","Radius","Perimetr"], correct:1, explain:"Bu masofa — radius deb ataladi."},
    {q:"6 + 7 x 2 = ?", opts:["26","20","13"], correct:1, explain:"Avval ko'paytirish: 7x2=14, so'ng 6+14=20."},
    {q:"1 kilogramm necha grammga teng?", opts:["100","1000","10000"], correct:1, explain:"1 kg = 1000 g."},
    {q:"Qaysi son toq son?", opts:["8","11","14"], correct:1, explain:"11 — 2 ga bo'linmaydi, demak toq son."},
    {q:"Qaysi son juft son?", opts:["3","5","8"], correct:2, explain:"8 — 2 ga bo'linadi, demak juft son."},
    {q:"45 ning 10% i nechaga teng?", opts:["4.5","45","0.45"], correct:0, explain:"45 ning 10 foizi 4.5 ga teng."},
    {q:"Perimetr nima?", opts:["Yuzasi","Tomonlar yig'indisi","Burchagi"], correct:1, explain:"Perimetr — shaklning barcha tomonlari yig'indisi."},
    {q:"2 + 2 x 0 = ?", opts:["0","2","4"], correct:1, explain:"Avval ko'paytirish: 2x0=0, so'ng 2+0=2."},
    {q:"Yarim soat necha daqiqa?", opts:["15","30","45"], correct:1, explain:"1 soatning yarmi — 30 daqiqa."},
    {q:"8 x 7 = ?", opts:["54","56","64"], correct:1, explain:"8 x 7 = 56."},
    {q:"Kub necha yoqqa (tomonga) ega?", opts:["6","8","12"], correct:0, explain:"Kubning 6 ta yoqi (tomoni) bor."},
    {q:"100 ning 50% i nechaga teng?", opts:["25","50","75"], correct:1, explain:"100 ning yarmi — 50."},
    {q:"9 - 4 + 2 = ?", opts:["3","7","5"], correct:1, explain:"Avval 9-4=5, so'ng 5+2=7."},
    {q:"Bir yilda necha oy bor?", opts:["10","12","14"], correct:1, explain:"Bir yilda 12 oy bor."},
  ],
  "Psixologiya":[
    {q:"Xotira odatda nechta asosiy turga bo'linadi?", opts:["2","3","4"], correct:1, explain:"Sensor, qisqa muddatli va uzoq muddatli xotira — 3 asosiy tur."},
    {q:"\"Motivatsiya\" nimani anglatadi?", opts:["Xotira turi","Harakatga undovchi ichki kuch","Idrok jarayoni"], correct:1, explain:"Motivatsiya insonni maqsad sari harakatga undaydi."},
    {q:"Ijobiy xulq-atvorni mustahkamlash usuli qanday deyiladi?", opts:["Jazolash","Mukofotlash (reinforcement)","Chetlashtirish"], correct:1, explain:"Mukofotlash orqali xulq-atvor mustahkamlanadi."},
    {q:"Stress bilan kurashishning sog'lom usuli qaysi?", opts:["Chuqur nafas olish","Uzoq vaqt uxlamaslik","Doim g'azablanish"], correct:0, explain:"Chuqur nafas olish stressni kamaytiradi."},
    {q:"Ekstrovert shaxs qanday xususiyatga ega?", opts:["Yolg'izlikni afzal ko'radi","Odamlar bilan muloqotdan energiya oladi","Juda kam gapiradi"], correct:1, explain:"Ekstrovertlar ijtimoiy muloqotdan quvvat oladi."},
    {q:"Empatiya nima?", opts:["Boshqa odam hissiyotini tushunish qobiliyati","Xotira turi","Aql darajasi ko'rsatkichi"], correct:0, explain:"Empatiya — boshqa odamning his-tuyg'ularini anglash."},
    {q:"Klassik shartlanish tajribasi kim bilan bog'liq?", opts:["Pavlov","Freyd","Piaget"], correct:0, explain:"Ivan Pavlov itlar ustida klassik shartlanishni o'rgangan."},
    {q:"O'z-o'zini past baholash (past self-esteem) nimaga olib kelishi mumkin?", opts:["Yuqori ishonch","O'ziga ishonchsizlik","Doimiy baxt"], correct:1, explain:"Past self-esteem ko'pincha ishonchsizlikka olib keladi."},
    {q:"Bolalarda ijtimoiylashuv nima orqali sodir bo'ladi?", opts:["Yolg'iz o'ynash","Boshqalar bilan muloqot orqali","Faqat uxlash orqali"], correct:1, explain:"Muloqot orqali bola ijtimoiy me'yorlarni o'rganadi."},
    {q:"Psixologiyada \"idrok\" (perception) nima?", opts:["Axborotni tashqi olamdan qabul qilish va talqin qilish","Faqat xotira","Faqat harakat"], correct:0, explain:"Idrok — sezgi organlari orqali olingan axborotni ongda talqin qilish."},
  ],
  "Robototexnika":[
    {q:"Robotning \"miyasi\" vazifasini nima bajaradi?", opts:["Motor","Kontroller/protsessor","G'ildirak"], correct:1, explain:"Kontroller robotning barcha qismlarini boshqaradi."},
    {q:"Sensor nima uchun kerak?", opts:["Faqat harakatlanish uchun","Atrofni \"his qilish\" uchun","Faqat quvvat berish uchun"], correct:1, explain:"Sensorlar robotga atrofdagi ma'lumotni yig'ib beradi."},
    {q:"Servo motor odatda qachon ishlatiladi?", opts:["Aniq burchakka aylanish kerak bo'lganda","Faqat yorug'lik berishda","Faqat ovoz chiqarishda"], correct:0, explain:"Servo motor aniq burchakli harakatlar uchun mos."},
    {q:"Arduino nima?", opts:["Dasturlash tili nomi","Mikrokontroller platasi","Operatsion tizim"], correct:1, explain:"Arduino — robototexnikada keng ishlatiladigan mikrokontroller platasi."},
    {q:"Robotni harakatga keltiruvchi asosiy qism qaysi?", opts:["Aktuator (motor)","Ekran","Xotira kartasi"], correct:0, explain:"Aktuatorlar (motorlar) robotni jismonan harakatlantiradi."},
    {q:"\"Avtonom robot\" nimani anglatadi?", opts:["Uni doim inson boshqaradi","O'zi mustaqil qaror qabul qiladi","Faqat masofadan boshqariladi"], correct:1, explain:"Avtonom robot atrofni his qilib, mustaqil qaror qabul qiladi."},
    {q:"Robototexnikada Python tili nima uchun ishlatiladi?", opts:["Dizayn chizish uchun","Robotni dasturlash uchun","Metall qayta ishlash uchun"], correct:1, explain:"Python robot xatti-harakatlarini dasturlashda keng qo'llaniladi."},
    {q:"Robotlarda ko'pincha qanday quvvat manbai ishlatiladi?", opts:["Akkumulyator batareya","Shamol energiyasi","Suv bosimi"], correct:0, explain:"Ko'chma robotlar odatda akkumulyator bilan ishlaydi."},
    {q:"Sanoat robotlari ko'proq qayerda ishlatiladi?", opts:["Uy ishlarida","Zavod konveyerlarida","Maktab darslarida"], correct:1, explain:"Sanoat robotlari ishlab chiqarish liniyalarida keng qo'llaniladi."},
    {q:"Robot qo'lidagi \"grip\" (ushlagich) nima vazifani bajaradi?", opts:["Harakatlanish","Buyumlarni ushlash","Quvvat olish"], correct:1, explain:"Grip robotga buyumlarni ushlash va ko'tarish imkonini beradi."},
  ],
  "Oshpazlik":[
    {q:"Suv dengiz sathida necha darajada qaynaydi?", opts:["90°C","100°C","120°C"], correct:1, explain:"Standart sharoitda suv 100°C da qaynaydi."},
    {q:"\"Marinatlash\" nima?", opts:["Mahsulotni sousda ivitib ta'm berish","Mahsulotni muzlatish","Mahsulotni qovurish"], correct:0, explain:"Marinatlash mahsulotga ta'm va yumshoqlik beradi."},
    {q:"Xamirni \"ko'tarish\" uchun odatda nima ishlatiladi?", opts:["Tuz","Achitqi (drojji)","Sirka"], correct:1, explain:"Achitqi gaz chiqarib xamirni ko'taradi."},
    {q:"Go'shtni oldindan marinad qilishning asosiy sababi?", opts:["Rangini o'zgartirish","Ta'm va yumshoqlik berish","Og'irligini oshirish"], correct:1, explain:"Marinad go'shtga ta'm singdiradi va yumshatadi."},
    {q:"Sabzavotlarni bug'da pishirish qanday deyiladi?", opts:["Frying","Steaming","Freezing"], correct:1, explain:"Steaming — bug' yordamida pishirish usuli."},
    {q:"\"Al dente\" atamasi odatda nimaga tegishli?", opts:["Go'shtga","Pastaga (yarim qattiq holat)","Shirinlikka"], correct:1, explain:"Al dente — pasta yumshoq, lekin biroz qattiqroq pishirilishi."},
    {q:"Tuxumni qattiq qaynatish uchun odatda necha daqiqa kerak?", opts:["2-3 daqiqa","8-10 daqiqa","20-25 daqiqa"], correct:1, explain:"Qattiq qaynagan tuxum uchun 8-10 daqiqa yetarli."},
    {q:"Non pishirishda xamir nima sababdan ko'tariladi?", opts:["Sovutish natijasida","Achitqi chiqargan gaz tufayli","Tuz ta'siridan"], correct:1, explain:"Achitqi karbonat angidrid gazini chiqarib xamirni ko'taradi."},
    {q:"\"Sote qilish\" (sauté) nima?", opts:["Sekin qaynatish","Tez olovda ozgina yog'da qovurish","Uzoq muddat muzlatish"], correct:1, explain:"Sote — yuqori haroratda tez qovurish usuli."},
    {q:"Oshxonada xavfsizlik uchun eng muhim qoida qaysi?", opts:["Qo'llarni yuvish va issiq yuzalardan ehtiyot bo'lish","Iloji boricha tez ishlash","Ko'proq tuz solish"], correct:0, explain:"Gigiyena va ehtiyotkorlik oshxona xavfsizligining asosi."},
  ],
  "Kiber xavsizlik":[
    {q:"Parol xavfsizligi uchun eng yaxshi amaliyot qaysi?", opts:["Oddiy va qisqa parol","Uzun va murakkab, noyob parol","Barcha hisoblar uchun bitta parol"], correct:1, explain:"Uzun, murakkab va noyob parollar xavfsizlikni oshiradi."},
    {q:"\"Fishing\" (phishing) hujumi nima?", opts:["Kompyuter virusi turi","Firibgarlik orqali maxfiy ma'lumot o'g'irlash","Tarmoqni sekinlashtirish usuli"], correct:1, explain:"Fishing — soxta xabar/sayt orqali ma'lumot o'g'irlash usuli."},
    {q:"Ikki bosqichli autentifikatsiya (2FA) nima uchun kerak?", opts:["Tezroq kirish uchun","Qo'shimcha xavfsizlik qatlami uchun","Parolni unutmaslik uchun"], correct:1, explain:"2FA hisobni qo'shimcha himoya qatlami bilan ta'minlaydi."},
    {q:"Antivirus dasturi vazifasi nima?", opts:["Kompyuterni tezlashtirish","Zararli dasturlardan himoya qilish","Internetni tezlashtirish"], correct:1, explain:"Antivirus zararli dasturlarni aniqlab, ulardan himoya qiladi."},
    {q:"Jamoat Wi-Fi tarmog'ida nima qilish xavfli hisoblanadi?", opts:["Onlayn bank ilovasidan foydalanish","Video ko'rish","Xabar o'qish"], correct:0, explain:"Ochiq tarmoqda maxfiy ma'lumot (bank) kiritish xavfli."},
    {q:"\"Firewall\" (tarmoq devori) nima vazifani bajaradi?", opts:["Tarmoqqa ruxsatsiz kirishni bloklaydi","Kompyuterni tezlashtiradi","Batareyani tejaydi"], correct:0, explain:"Firewall tarmoqqa nomaqbul kirishlarni to'sadi."},
    {q:"Shubhali havolani (link) bosishdan oldin nima qilish tavsiya etiladi?", opts:["Darhol bosish","Havola manzilini diqqat bilan tekshirish","E'tiborsiz qoldirib, baribir bosish"], correct:1, explain:"Havola manzilini tekshirish firibgarlikning oldini oladi."},
    {q:"Ma'lumotlarni zaxiralash (backup) nima uchun muhim?", opts:["Kompyuterni tezlashtiradi","Ma'lumot yo'qolganda tiklash imkonini beradi","Internetni tezlashtiradi"], correct:1, explain:"Backup orqali ma'lumot yo'qolsa ham tiklash mumkin."},
    {q:"Kuchli parolda odatda nima bo'lishi kerak?", opts:["Faqat raqamlar","Harflar, raqamlar va belgilar aralashmasi","Faqat foydalanuvchi ismi"], correct:1, explain:"Aralash belgilar parolni topishni qiyinlashtiradi."},
    {q:"Ijtimoiy tarmoqlarda shaxsiy ma'lumotni oshkor qilish nima uchun xavfli?", opts:["Hech qanday xavf yo'q","Firibgarlar undan foydalanishi mumkin","Internetni tezlashtiradi"], correct:1, explain:"Oshkor ma'lumotdan firibgarlar suiiste'mol qilishi mumkin."},
  ],
};

/* ================= ENROLL MODAL: registration -> 20-question test -> results ================= */
const enrollModal = document.getElementById('enrollModal');
const enrollContent = document.getElementById('enrollContent');
let currentEnroll = {subject:'', mode:''};
let quizState = {questions:[], index:0, answers:[]};

function openEnrollModal(subject, mode){
  currentEnroll = {subject, mode};
  renderRegistrationStep();
  enrollModal.classList.add('open');
}
document.getElementById('modalClose').addEventListener('click', ()=>enrollModal.classList.remove('open'));
enrollModal.addEventListener('click', e=>{ if(e.target===enrollModal) enrollModal.classList.remove('open'); });

function priceFor(mode){ return mode==='teacher' ? "50 000 so'm / hafta" : "Bepul"; }
function modeLabelFor(mode){ return mode==='teacher' ? "ustoz bilan" : "AI-robot bilan"; }

function renderRegistrationStep(){
  const price = priceFor(currentEnroll.mode);
  const priceNote = currentEnroll.mode==='teacher'
    ? `Ro'yxatdan o'tish narxi: <b>${price}</b> (bu — haftalik ro'yxatdan o'tish narxi).`
    : `Ro'yxatdan o'tish narxi: <b>${price}</b> — AI-robot bilan darslar hech qanday to'lovsiz.`;
  enrollContent.innerHTML = `
    <h3>${currentEnroll.subject} — ${modeLabelFor(currentEnroll.mode)}</h3>
    <p class="sub">${priceNote} O'quvchi 8 yoshdan katta bo'lishi kerak.</p>
    <div class="field"><label>Ism</label><input id="sName" type="text"></div>
    <div class="field"><label>Familiya</label><input id="sSurname" type="text"></div>
    <div class="field"><label>Yosh</label><input id="sAge" type="number" min="1" max="100" placeholder="8+"></div>
    <div class="field"><label>Turar joyi</label><input id="sAddress" type="text" placeholder="Shahar / tuman"></div>
    <div class="field"><label>Telefon raqami</label><input id="sPhone" type="tel" placeholder="+998 90 123 45 67"></div>
    <div class="form-error" id="sError">Barcha maydonlarni to'ldiring. O'quvchi yoshi kamida 8 bo'lishi kerak.</div>
    <button class="btn green" id="sSubmit">Ro'yxatdan o'tish va testni boshlash</button>
  `;
  document.getElementById('sSubmit').addEventListener('click', ()=>{
    const name = document.getElementById('sName').value.trim();
    const surname = document.getElementById('sSurname').value.trim();
    const age = parseInt(document.getElementById('sAge').value,10);
    const address = document.getElementById('sAddress').value.trim();
    const phone = document.getElementById('sPhone').value.trim();
    const err = document.getElementById('sError');
    if(!name || !surname || !age || age < 8 || !address || !phone){
      err.style.display='block'; return;
    }
    err.style.display='none';
    currentEnroll.student = {name, surname, age, address, phone};

    if(currentEnroll.mode === 'teacher'){
      const matched = (allTeacherRecords||[]).filter(t => t.subject === currentEnroll.subject);
      const studentLine = `👤 <b>Yangi o'quvchi ustoz so'radi</b>\n` +
        `Fan: ${currentEnroll.subject}\n` +
        `O'quvchi: ${name} ${surname}, ${age} yosh\n` +
        `Manzil: ${address}\n` +
        `Telefon: ${phone}`;
      if(matched.length){
        const t = matched[0];
        sendTelegramNotify(
          studentLine + `\n\nMos ustoz: ${t.name} ${t.surname}\n` +
          `Ustoz tel: ${t.phone}` + (t.telegram ? `\nUstoz Telegram: ${t.telegram}` : ''),
          t._key
        );
      }else{
        sendTelegramNotify(studentLine + `\n\n⚠️ Bu fan bo'yicha hozircha ro'yxatdan o'tgan ustoz yo'q.`);
      }
    }

    startQuiz();
  });
}

function startQuiz(){
  const bank = REG_QUESTIONS[currentEnroll.subject] || [];
  quizState = {questions: bank, index: 0, answers: new Array(bank.length).fill(null)};
  renderQuizStep();
}

function renderQuizStep(){
  const {questions, index, answers} = quizState;
  const item = questions[index];
  const progressPct = Math.round(((index)/questions.length)*100);
  const answered = answers[index];
  enrollContent.innerHTML = `
    <h3>${currentEnroll.subject} bo'yicha test</h3>
    <p class="sub">Savol ${index+1} / ${questions.length}</p>
    <div style="height:6px;background:var(--paper-dim);border-radius:6px;margin-bottom:20px;overflow:hidden;">
      <div style="height:100%;width:${progressPct}%;background:var(--green);"></div>
    </div>
    <div class="quiz-q">${item.q}</div>
    <div class="quiz-opts" id="regOpts"></div>
    <div class="card-nav">
      <button class="opt-arrow" id="regPrev" type="button" ${index===0?'disabled':''}>‹</button>
      <span class="progress-text" id="regHint">${answered===null ? "Javobni tanlang" : "Keyingi savolga o'tish uchun strelkani bosing"}</span>
      <button class="opt-arrow" id="regNext" type="button" ${answered===null?'disabled':''}>${index===questions.length-1 ? '✓' : '›'}</button>
    </div>
  `;
  const optsWrap = document.getElementById('regOpts');
  item.opts.forEach((opt, oi)=>{
    const optBtn = document.createElement('div');
    optBtn.className='quiz-opt';
    optBtn.textContent = opt;
    if(answered===oi) optBtn.classList.add('selected');
    optBtn.addEventListener('click', ()=>{
      quizState.answers[index] = oi;
      renderQuizStep();
    });
    optsWrap.appendChild(optBtn);
  });
  document.getElementById('regPrev').addEventListener('click', ()=>{
    if(quizState.index>0){ quizState.index--; renderQuizStep(); }
  });
  document.getElementById('regNext').addEventListener('click', ()=>{
    if(quizState.answers[quizState.index]===null) return;
    if(quizState.index === questions.length-1){
      renderResultsStep();
    }else{
      quizState.index++;
      renderQuizStep();
    }
  });
}

function renderResultsStep(){
  const {questions, answers} = quizState;
  let score = 0;
  const wrong = [];
  questions.forEach((item, i)=>{
    if(answers[i]===item.correct) score++;
    else wrong.push({...item, given: answers[i]});
  });
  const price = priceFor(currentEnroll.mode);
  const wrongHtml = wrong.length ? wrong.map(w=>`
    <div style="padding:14px;border-radius:12px;background:var(--paper-dim);margin-bottom:10px;">
      <div style="font-weight:700;font-size:14px;margin-bottom:6px;">${w.q}</div>
      <div style="font-size:13.5px;color:var(--rose);margin-bottom:3px;">Sizning javobingiz: ${w.given!==null ? w.opts[w.given] : "Javob berilmagan"}</div>
      <div style="font-size:13.5px;color:var(--green);margin-bottom:6px;">To'g'ri javob: ${w.opts[w.correct]}</div>
      <div style="font-size:13px;color:var(--slate);">${w.explain}</div>
    </div>
  `).join('') : `<p class="empty-note">Barcha savollarga to'g'ri javob berdingiz — ajoyib natija!</p>`;

  enrollContent.innerHTML = `
    <h3>Test natijasi</h3>
    <p class="sub">${currentEnroll.student.name}, sizning natijangiz:</p>
    <div style="font-family:'Space Mono',monospace;font-size:32px;font-weight:700;color:var(--green);margin-bottom:10px;">${score} / ${questions.length}</div>
    <p class="sub">${currentEnroll.subject} — ${modeLabelFor(currentEnroll.mode)}. Narx: <b>${price}</b>${currentEnroll.mode==='teacher' ? ' (haftalik)' : ''}.</p>
    <h4 style="margin:18px 0 10px;font-family:'Manrope';font-size:15px;">Xatolar tahlili</h4>
    <div style="max-height:280px;overflow-y:auto;">${wrongHtml}</div>
    <button class="btn green" id="finishBtn" style="margin-top:16px;">Yopish</button>
  `;
  document.getElementById('finishBtn').addEventListener('click', ()=>enrollModal.classList.remove('open'));
}

/* ================= QUIZ (independent 25-question bank per subject for the top "Bilimingizni sinang" section) ================= */
const QUIZ = {
  "Ona tili":[
    {q:"\"Maktab\" so'zida nechta bo'g'in bor?", opts:["2","3","4"], correct:0, diff:"easy"},
    {q:"Qaysi so'z fe'l turkumiga kiradi?", opts:["Yozmoq","Chiroyli","Kitob"], correct:0, diff:"easy"},
    {q:"Undov gap oxiriga qanday belgi qo'yiladi?", opts:["Nuqta","Undov belgisi","Vergul"], correct:1, diff:"easy"},
    {q:"Qaysi so'z sifat?", opts:["Baland","Yugurmoq","Stol"], correct:0, diff:"easy"},
    {q:"\"Bormoq\" so'zi qaysi turkumga kiradi?", opts:["Ot","Fe'l","Son"], correct:1, diff:"easy"},
    {q:"Sanoq songa misol toping.", opts:["Besh","Beshinchi","Beshtacha"], correct:0, diff:"easy"},
    {q:"Tartib songa misol toping.", opts:["Besh","Beshinchi","Ikki"], correct:1, diff:"easy"},
    {q:"Qaysi tovush undosh?", opts:["A","B","O"], correct:1, diff:"easy"},
    {q:"\"Xayr\" so'zi qachon ishlatiladi?", opts:["Uchrashganda","Xayrlashganda","So'raganda"], correct:1, diff:"easy"},
    {q:"Qaysi so'z olmosh?", opts:["Sen","Kitob","O'qimoq"], correct:0, diff:"medium"},
    {q:"\"Va\" bog'lovchisi nima uchun ishlatiladi?", opts:["Sanash","Qarshilantirish","Sabab"], correct:0, diff:"medium"},
    {q:"Yoz faslida odatda qanday bo'ladi?", opts:["Qor yog'adi","Issiq bo'ladi","Barglar to'kiladi"], correct:1, diff:"medium"},
    {q:"Qaysi biri so'roq gap?", opts:["Bugun dars bor.","Bugun dars bormi?","Qanday ajoyib!"], correct:1, diff:"medium"},
    {q:"\"Qorbobo\" so'zi qanday yasalgan?", opts:["Qo'shma so'z","Sodda so'z","Juft so'z"], correct:0, diff:"medium"},
    {q:"\"Baland-past\" — bu qanday so'z juftligi?", opts:["Sinonim","Antonim","Omonim"], correct:1, diff:"medium"},
    {q:"\"Chiroyli-go'zal\" — bu qanday so'z juftligi?", opts:["Sinonim","Antonim","Omonim"], correct:0, diff:"medium"},
    {q:"Qaysi janr xalq og'zaki ijodiga kiradi?", opts:["Roman","Ertak","Maqola"], correct:1, diff:"medium"},
    {q:"Kishi ismi qanday harf bilan yoziladi?", opts:["Kichik","Bosh","Farqi yo'q"], correct:1, diff:"hard"},
    {q:"\"Kitob\" so'zi necha harfdan iborat?", opts:["4","5","6"], correct:1, diff:"hard"},
    {q:"Matn oxirida fikr umumlashtirilgan qism nima deyiladi?", opts:["Kirish","Xulosa","Reja"], correct:1, diff:"hard"},
    {q:"Qaysi so'z ravish (harakat tarzini bildiradi)?", opts:["Tez","Kitob","Stol"], correct:0, diff:"hard"},
    {q:"\"Bir, ikki, uch...\" — bu qanday sonlar?", opts:["Sanoq son","Tartib son","Jamlovchi son"], correct:0, diff:"hard"},
    {q:"Ega va kesimdan tashkil topgan eng kichik gap nima deyiladi?", opts:["Yig'iq gap","Sodda gap","Qo'shma gap"], correct:1, diff:"hard"},
    {q:"\"O'qidim\" so'zi qaysi zamonda?", opts:["Hozirgi","O'tgan","Kelasi"], correct:1, diff:"hard"},
    {q:"Nutq odobiga oid so'zga misol toping.", opts:["Rahmat","Kitob","Yugurmoq"], correct:0, diff:"hard"},
  ],
  "Rus tili":[
    {q:"Как переводится слово \"стул\"?", opts:["Stol","Stul","Krovat"], correct:1, diff:"easy"},
    {q:"Какое слово является существительным?", opts:["Дом","Бежать","Красный"], correct:0, diff:"easy"},
    {q:"Сколько гласных букв в русском алфавите?", opts:["8","10","12"], correct:1, diff:"easy"},
    {q:"Как переводится слово \"окно\"?", opts:["Deraza","Eshik","Devor"], correct:0, diff:"easy"},
    {q:"Какое слово является глаголом?", opts:["Играть","Игра","Игрушка"], correct:0, diff:"easy"},
    {q:"Как переводится слово \"мама\"?", opts:["Ota","Ona","Buvi"], correct:1, diff:"easy"},
    {q:"На какой вопрос отвечает именительный падеж?", opts:["Кто? Что?","Кого? Чего?","О ком? О чём?"], correct:0, diff:"easy"},
    {q:"Как переводится слово \"папа\"?", opts:["Ona","Ota","Aka"], correct:1, diff:"easy"},
    {q:"Какое слово является прилагательным?", opts:["Синий","Бежать","Окно"], correct:0, diff:"easy"},
    {q:"Как переводится слово \"дом\"?", opts:["Uy","Ko'cha","Maktab"], correct:0, diff:"medium"},
    {q:"Единственное число слова \"дома\":", opts:["Дом","Дому","Домом"], correct:0, diff:"medium"},
    {q:"Как переводится слово \"яблоко\"?", opts:["Olma","Uzum","Nok"], correct:0, diff:"medium"},
    {q:"Какой глагол стоит в будущем времени?", opts:["Читал","Читаю","Буду читать"], correct:2, diff:"medium"},
    {q:"Как переводится слово \"собака\"?", opts:["Mushuk","It","Ot"], correct:1, diff:"medium"},
    {q:"Какое слово является местоимением?", opts:["Ты","Дом","Играть"], correct:0, diff:"medium"},
    {q:"Как переводится слово \"кошка\"?", opts:["It","Mushuk","Sichqon"], correct:1, diff:"medium"},
    {q:"Сколько согласных букв в слове \"стол\"?", opts:["2","3","4"], correct:1, diff:"medium"},
    {q:"Как переводится слово \"брат\"?", opts:["Aka/Uka","Opa","Amaki"], correct:0, diff:"hard"},
    {q:"На какой вопрос отвечает винительный падеж?", opts:["Кто? Что?","Кого? Что?","Кому? Чему?"], correct:1, diff:"hard"},
    {q:"Как переводится слово \"сестра\"?", opts:["Opa/Singil","Aka","Amma"], correct:0, diff:"hard"},
    {q:"Какое слово является наречием?", opts:["Хорошо","Стол","Красный"], correct:0, diff:"hard"},
    {q:"Как переводится слово \"вечер\"?", opts:["Ertalab","Kechqurun","Tush"], correct:1, diff:"hard"},
    {q:"Как переводится слово \"зима\"?", opts:["Yoz","Qish","Bahor"], correct:1, diff:"hard"},
    {q:"Какое слово обозначает цвет?", opts:["Жёлтый","Стол","Бежать"], correct:0, diff:"hard"},
    {q:"Как переводится слово \"снег\"?", opts:["Yomg'ir","Qor","Shamol"], correct:1, diff:"hard"},
  ],
  "Ingliz tili":[
    {q:"What is the plural of \"box\"?", opts:["Boxs","Boxes","Boxies"], correct:1, diff:"easy"},
    {q:"Choose the correct verb: \"I ___ a student.\"", opts:["am","is","are"], correct:0, diff:"easy"},
    {q:"What is the English word for \"olma\"?", opts:["Apple","Orange","Banana"], correct:0, diff:"easy"},
    {q:"What is the past tense of \"eat\"?", opts:["Eated","Ate","Eating"], correct:1, diff:"easy"},
    {q:"Choose the correct article: \"___ orange\"", opts:["A","An","The"], correct:1, diff:"easy"},
    {q:"What is the opposite of \"fast\"?", opts:["Slow","Quick","Loud"], correct:0, diff:"easy"},
    {q:"Which word is a noun?", opts:["Run","Happy","Dog"], correct:2, diff:"easy"},
    {q:"\"You ___ my friend.\"", opts:["is","am","are"], correct:2, diff:"easy"},
    {q:"What is the English word for \"maktab\"?", opts:["School","Park","Shop"], correct:0, diff:"easy"},
    {q:"Choose the correct question word: \"___ do you live?\"", opts:["What","Where","Who"], correct:1, diff:"medium"},
    {q:"What is the plural of \"cat\"?", opts:["Cat","Cats","Cates"], correct:1, diff:"medium"},
    {q:"Which word is a shape?", opts:["Circle","Run","Green"], correct:0, diff:"medium"},
    {q:"\"I have three ___.\"", opts:["pen","pens","penes"], correct:1, diff:"medium"},
    {q:"What is the opposite of \"old\"?", opts:["New","Young","Big"], correct:1, diff:"medium"},
    {q:"\"She ___ a doctor.\"", opts:["am","is","are"], correct:1, diff:"medium"},
    {q:"What month comes after January?", opts:["March","February","April"], correct:1, diff:"medium"},
    {q:"Choose the correct word: \"This is ___ pen.\"", opts:["I","mine","my"], correct:2, diff:"medium"},
    {q:"What is \"rahmat\" in English?", opts:["Sorry","Thanks","Please"], correct:1, diff:"hard"},
    {q:"Which word means an animal?", opts:["Cat","Table","Blue"], correct:0, diff:"hard"},
    {q:"\"You and I ___ friends.\"", opts:["is","am","are"], correct:2, diff:"hard"},
    {q:"What is the opposite of \"day\"?", opts:["Night","Sun","Light"], correct:0, diff:"hard"},
    {q:"Choose the correct sentence.", opts:["He don't like tea","He doesn't like tea","He not like tea"], correct:1, diff:"hard"},
    {q:"What is \"kecha\" in English?", opts:["Tomorrow","Yesterday","Today"], correct:1, diff:"hard"},
    {q:"How many months are in a year?", opts:["10","12","14"], correct:1, diff:"hard"},
    {q:"What is the plural of \"tooth\"?", opts:["Tooths","Teeth","Toothes"], correct:1, diff:"hard"},
  ],
  "Matematika":[
    {q:"6 x 9 = ?", opts:["54","56","64"], correct:0, diff:"easy"},
    {q:"To'rtburchakning necha tomoni bor?", opts:["3","4","5"], correct:1, diff:"easy"},
    {q:"18 ning yarmi nechaga teng?", opts:["8","9","10"], correct:1, diff:"easy"},
    {q:"24 + 18 = ?", opts:["42","32","52"], correct:0, diff:"easy"},
    {q:"90 - 35 = ?", opts:["55","45","65"], correct:0, diff:"easy"},
    {q:"Doiraning necha burchagi bor?", opts:["0","1","4"], correct:0, diff:"easy"},
    {q:"6 x 6 = ?", opts:["36","42","30"], correct:0, diff:"easy"},
    {q:"4 ning kvadrati nechaga teng?", opts:["8","16","12"], correct:1, diff:"easy"},
    {q:"Bir kunda necha soat bor?", opts:["12","24","30"], correct:1, diff:"easy"},
    {q:"1/2 ning o'ndalik ko'rinishi qaysi?", opts:["0.5","0.25","0.75"], correct:0, diff:"medium"},
    {q:"30 ni 5 ga bo'lsak nechaga teng?", opts:["5","6","7"], correct:1, diff:"medium"},
    {q:"Kesmaning ikki uchi orasidagi masofa nima deyiladi?", opts:["Radius","Uzunlik","Diametr"], correct:1, diff:"medium"},
    {q:"8 + 3 x 3 = ?", opts:["33","17","24"], correct:1, diff:"medium"},
    {q:"1 tonna necha kilogrammga teng?", opts:["100","1000","10000"], correct:1, diff:"medium"},
    {q:"Qaysi son toq son?", opts:["12","15","18"], correct:1, diff:"medium"},
    {q:"Qaysi son juft son?", opts:["7","9","10"], correct:2, diff:"medium"},
    {q:"60 ning 20% i nechaga teng?", opts:["12","20","6"], correct:0, diff:"medium"},
    {q:"Yuza nima?", opts:["Tomonlar yig'indisi","Ichki maydon","Burchak"], correct:1, diff:"hard"},
    {q:"3 + 3 x 0 = ?", opts:["0","3","6"], correct:1, diff:"hard"},
    {q:"Chorak soat necha daqiqa?", opts:["10","15","20"], correct:1, diff:"hard"},
    {q:"5 x 5 = ?", opts:["20","25","30"], correct:1, diff:"hard"},
    {q:"Silindr qaysi turdagi shakl?", opts:["Tekis","Hajmli","Chiziq"], correct:1, diff:"hard"},
    {q:"100 ning 25% i nechaga teng?", opts:["20","25","30"], correct:1, diff:"hard"},
    {q:"7 - 2 + 5 = ?", opts:["10","0","4"], correct:0, diff:"hard"},
    {q:"Bir haftada necha kun bor?", opts:["5","6","7"], correct:2, diff:"hard"},
  ],
  "Psixologiya":[
    {q:"Xotira odatda nechta asosiy turga bo'linadi?", opts:["2","3","4"], correct:1, diff:"easy"},
    {q:"\"Motivatsiya\" nimani anglatadi?", opts:["Xotira turi","Harakatga undovchi ichki kuch","Idrok jarayoni"], correct:1, diff:"easy"},
    {q:"Empatiya nima?", opts:["Boshqa odam hissiyotini tushunish qobiliyati","Xotira turi","Aql darajasi"], correct:0, diff:"easy"},
    {q:"Ijobiy xulq-atvorni mustahkamlash usuli qanday deyiladi?", opts:["Jazolash","Mukofotlash (reinforcement)","Chetlashtirish"], correct:1, diff:"medium"},
    {q:"Stress bilan kurashishning sog'lom usuli qaysi?", opts:["Chuqur nafas olish","Uzoq uxlamaslik","G'azablanish"], correct:0, diff:"medium"},
    {q:"Ekstrovert shaxs qanday xususiyatga ega?", opts:["Yolg'izlikni afzal ko'radi","Muloqotdan energiya oladi","Kam gapiradi"], correct:1, diff:"medium"},
    {q:"Bolalarda ijtimoiylashuv nima orqali sodir bo'ladi?", opts:["Yolg'iz o'ynash","Muloqot orqali","Faqat uxlash"], correct:1, diff:"medium"},
    {q:"Klassik shartlanish tajribasi kim bilan bog'liq?", opts:["Pavlov","Freyd","Piaget"], correct:0, diff:"hard"},
    {q:"O'z-o'zini past baholash nimaga olib kelishi mumkin?", opts:["Yuqori ishonch","O'ziga ishonchsizlik","Doimiy baxt"], correct:1, diff:"hard"},
    {q:"Psixologiyada \"idrok\" (perception) nima?", opts:["Axborotni qabul qilib talqin qilish","Faqat xotira","Faqat harakat"], correct:0, diff:"hard"},
  ],
  "Robototexnika":[
    {q:"Robotning \"miyasi\" vazifasini nima bajaradi?", opts:["Motor","Kontroller/protsessor","G'ildirak"], correct:1, diff:"easy"},
    {q:"Sensor nima uchun kerak?", opts:["Faqat harakatlanish uchun","Atrofni \"his qilish\" uchun","Quvvat berish uchun"], correct:1, diff:"easy"},
    {q:"Arduino nima?", opts:["Dasturlash tili","Mikrokontroller platasi","Operatsion tizim"], correct:1, diff:"easy"},
    {q:"Servo motor odatda qachon ishlatiladi?", opts:["Aniq burchakka aylanish kerak bo'lganda","Yorug'lik berishda","Ovoz chiqarishda"], correct:0, diff:"medium"},
    {q:"Robotni harakatga keltiruvchi asosiy qism qaysi?", opts:["Aktuator (motor)","Ekran","Xotira kartasi"], correct:0, diff:"medium"},
    {q:"Robototexnikada Python tili nima uchun ishlatiladi?", opts:["Dizayn chizish","Robotni dasturlash","Metall ishlash"], correct:1, diff:"medium"},
    {q:"Robotlarda ko'pincha qanday quvvat manbai ishlatiladi?", opts:["Akkumulyator batareya","Shamol","Suv bosimi"], correct:0, diff:"medium"},
    {q:"\"Avtonom robot\" nimani anglatadi?", opts:["Inson doim boshqaradi","O'zi mustaqil qaror qabul qiladi","Faqat masofadan boshqariladi"], correct:1, diff:"hard"},
    {q:"Sanoat robotlari ko'proq qayerda ishlatiladi?", opts:["Uy ishlarida","Zavod konveyerlarida","Maktabda"], correct:1, diff:"hard"},
    {q:"Robot qo'lidagi \"grip\" nima vazifani bajaradi?", opts:["Harakatlanish","Buyumlarni ushlash","Quvvat olish"], correct:1, diff:"hard"},
  ],
  "Oshpazlik":[
    {q:"Suv dengiz sathida necha darajada qaynaydi?", opts:["90°C","100°C","120°C"], correct:1, diff:"easy"},
    {q:"\"Marinatlash\" nima?", opts:["Sousda ivitib ta'm berish","Muzlatish","Qovurish"], correct:0, diff:"easy"},
    {q:"Tuxumni qattiq qaynatish uchun necha daqiqa kerak?", opts:["2-3 daqiqa","8-10 daqiqa","20-25 daqiqa"], correct:1, diff:"easy"},
    {q:"Xamirni \"ko'tarish\" uchun odatda nima ishlatiladi?", opts:["Tuz","Achitqi (drojji)","Sirka"], correct:1, diff:"medium"},
    {q:"Sabzavotlarni bug'da pishirish qanday deyiladi?", opts:["Frying","Steaming","Freezing"], correct:1, diff:"medium"},
    {q:"Go'shtni marinad qilishning asosiy sababi?", opts:["Rangini o'zgartirish","Ta'm va yumshoqlik berish","Og'irligini oshirish"], correct:1, diff:"medium"},
    {q:"Oshxonada eng muhim xavfsizlik qoidasi qaysi?", opts:["Qo'llarni yuvish va ehtiyot bo'lish","Tez ishlash","Ko'p tuz solish"], correct:0, diff:"medium"},
    {q:"\"Al dente\" atamasi odatda nimaga tegishli?", opts:["Go'shtga","Pastaga","Shirinlikka"], correct:1, diff:"hard"},
    {q:"Non pishirishda xamir nima sababdan ko'tariladi?", opts:["Sovutishdan","Achitqi gazidan","Tuz ta'siridan"], correct:1, diff:"hard"},
    {q:"\"Sote qilish\" (sauté) nima?", opts:["Sekin qaynatish","Tez olovda ozgina yog'da qovurish","Muzlatish"], correct:1, diff:"hard"},
  ],
  "Kiber xavsizlik":[
    {q:"Parol xavfsizligi uchun eng yaxshi amaliyot qaysi?", opts:["Oddiy va qisqa parol","Uzun va murakkab, noyob parol","Bitta parol hammasiga"], correct:1, diff:"easy"},
    {q:"Antivirus dasturi vazifasi nima?", opts:["Kompyuterni tezlashtirish","Zararli dasturlardan himoya qilish","Internetni tezlashtirish"], correct:1, diff:"easy"},
    {q:"Kuchli parolda nima bo'lishi kerak?", opts:["Faqat raqamlar","Harflar, raqamlar va belgilar aralashmasi","Faqat ism"], correct:1, diff:"easy"},
    {q:"\"Fishing\" (phishing) hujumi nima?", opts:["Virus turi","Firibgarlik orqali ma'lumot o'g'irlash","Tarmoqni sekinlashtirish"], correct:1, diff:"medium"},
    {q:"Ikki bosqichli autentifikatsiya (2FA) nima uchun kerak?", opts:["Tezroq kirish uchun","Qo'shimcha xavfsizlik uchun","Parolni unutmaslik uchun"], correct:1, diff:"medium"},
    {q:"\"Firewall\" nima vazifani bajaradi?", opts:["Ruxsatsiz kirishni bloklaydi","Kompyuterni tezlashtiradi","Batareyani tejaydi"], correct:0, diff:"medium"},
    {q:"Ma'lumotlarni zaxiralash (backup) nima uchun muhim?", opts:["Tezlashtiradi","Ma'lumot yo'qolganda tiklaydi","Internetni tezlashtiradi"], correct:1, diff:"medium"},
    {q:"Jamoat Wi-Fi tarmog'ida nima qilish xavfli?", opts:["Onlayn bank ilovasidan foydalanish","Video ko'rish","Xabar o'qish"], correct:0, diff:"hard"},
    {q:"Shubhali havolani bosishdan oldin nima qilish kerak?", opts:["Darhol bosish","Havola manzilini tekshirish","E'tiborsiz qoldirish"], correct:1, diff:"hard"},
    {q:"Ijtimoiy tarmoqlarda shaxsiy ma'lumot oshkor qilish nima uchun xavfli?", opts:["Xavfi yo'q","Firibgarlar foydalanishi mumkin","Internetni tezlashtiradi"], correct:1, diff:"hard"},
  ],
};
const quizSelect = document.getElementById('quizSelect');
const quizBody = document.getElementById('quizBody');
const quizCountSlider = document.getElementById('quizCountSlider');
const quizCountLabel = document.getElementById('quizCountLabel');
let activeSubject = "Ona tili";
let activeCount = 10;
let activeDifficulty = "easy";

document.querySelectorAll('#difficultyRow .difficulty-btn').forEach(btn=>{
  btn.addEventListener('click', ()=>{
    document.querySelectorAll('#difficultyRow .difficulty-btn').forEach(b=>b.classList.remove('active'));
    btn.classList.add('active');
    activeDifficulty = btn.dataset.diff;
    renderQuiz();
  });
});

quizCountLabel.textContent = activeCount + " ta";
quizCountSlider.addEventListener('input', ()=>{
  activeCount = parseInt(quizCountSlider.value, 10);
  quizCountLabel.textContent = activeCount + " ta";
});
quizCountSlider.addEventListener('change', ()=>{
  activeCount = parseInt(quizCountSlider.value, 10);
  renderQuiz();
});

function shuffleArray(arr){
  const a = arr.slice();
  for(let i=a.length-1;i>0;i--){
    const j = Math.floor(Math.random()*(i+1));
    [a[i],a[j]] = [a[j],a[i]];
  }
  return a;
}
function buildQuestionSet(subject, count, difficulty){
  const fullBank = QUIZ[subject];
  const bank = fullBank.filter(q=>q.diff===difficulty);
  const source = bank.length ? bank : fullBank;
  let result = [];
  while(result.length < count){
    result = result.concat(shuffleArray(source));
  }
  return result.slice(0, count);
}

Object.keys(QUIZ).forEach(name=>{
  const pill = document.createElement('button');
  pill.className = 'subject-pill' + (name===activeSubject?' active':'');
  pill.textContent = name;
  pill.addEventListener('click', ()=>{
    activeSubject = name;
    document.querySelectorAll('.subject-pill').forEach(p=>p.classList.remove('active'));
    pill.classList.add('active');
    renderQuiz();
  });
  quizSelect.appendChild(pill);
});
let topQuizState = {idx:0, answers:[], questions:[]};
function renderQuiz(){
  const questions = buildQuestionSet(activeSubject, activeCount, activeDifficulty);
  topQuizState = {idx:0, answers:new Array(questions.length).fill(null), questions};
  renderQuizCard();
}
function renderQuizCard(){
  const {idx, answers, questions} = topQuizState;
  const item = questions[idx];
  quizBody.innerHTML = '';

  const qEl = document.createElement('div');
  qEl.className='quiz-q';
  qEl.textContent = `${idx+1}. ${item.q}`;
  quizBody.appendChild(qEl);

  const optsWrap = document.createElement('div');
  optsWrap.className='quiz-opts';
  const answered = answers[idx];
  item.opts.forEach((opt, oi)=>{
    const optBtn = document.createElement('div');
    optBtn.className='quiz-opt';
    optBtn.textContent = opt;
    if(answered!==null){
      if(oi===item.correct) optBtn.classList.add('correct');
      else if(oi===answered) optBtn.classList.add('wrong');
    }
    optBtn.addEventListener('click', ()=>{
      if(answers[idx]!==null) return;
      answers[idx] = oi;
      renderQuizCard();
    });
    optsWrap.appendChild(optBtn);
  });
  quizBody.appendChild(optsWrap);

  if(answered!==null && answered!==item.correct){
    const note = document.createElement('div');
    note.className='quiz-result';
    note.textContent = `To'g'ri javob: ${item.opts[item.correct]}`;
    quizBody.appendChild(note);
  }

  const scoreSoFar = answers.filter((a,i)=>a===questions[i].correct).length;
  const answeredCount = answers.filter(a=>a!==null).length;

  const nav = document.createElement('div');
  nav.className = 'card-nav';
  nav.innerHTML = `
    <button class="opt-arrow" id="qPrev" type="button" ${idx===0?'disabled':''}>‹</button>
    <span class="progress-text">Savol ${idx+1} / ${questions.length} · Ball: ${scoreSoFar}/${answeredCount}</span>
    <button class="opt-arrow" id="qNext" type="button" ${idx===questions.length-1?'disabled':''}>›</button>
  `;
  quizBody.appendChild(nav);

  if(answeredCount===questions.length){
    const res = document.createElement('div');
    res.className='quiz-result';
    res.style.marginTop='10px';
    res.textContent = `Yakuniy natija: ${scoreSoFar} / ${questions.length} to'g'ri javob.`;
    quizBody.appendChild(res);
  }

  document.getElementById('qPrev').addEventListener('click', ()=>{ if(topQuizState.idx>0){ topQuizState.idx--; renderQuizCard(); } });
  document.getElementById('qNext').addEventListener('click', ()=>{ if(topQuizState.idx<questions.length-1){ topQuizState.idx++; renderQuizCard(); } });
}
renderQuiz();

/* ================= AI SAVOL LIMITI (Bepul / Pro / Premium) =================
   - Bepul: har bir fan/bo'lim chatida 15 tagacha savol, limitga yetgach 3 soat kutish.
   - Pro (30 000 so'm/oy): kuniga 25 ta savol (platformadagi barcha chatlar birgalikda).
   - Premium (70 000 so'm/oy): kuniga 60 ta savol.
   Uzun/og'ir savollar (matni katta) limitdan ko'proq "yeydi" — bu barcha
   tariflarga (shu jumladan Pro'ga ham) taalluqli. Holat foydalanuvchi hisobiga
   (yoki hali kirmagan bo'lsa shu qurilmaga) bog'lab Supabase kv_store'da
   saqlanadi (getCachedAI kabi 'storage' obyekti orqali), shunda limit
   sahifa yangilansa yoki boshqa qurilmadan kirsa ham saqlanib qoladi. */
const AI_PLANS = {
  free:    { key:'free',    label:"Bepul",   priceLabel:null,           dailyLimit:null, perChatLimit:15, cooldownMs: 3*60*60*1000 },
  pro:     { key:'pro',     label:"Pro",     priceLabel:"30 000 so'm/oy", dailyLimit:25,  perChatLimit:null, cooldownMs:null },
  premium: { key:'premium', label:"Premium", priceLabel:"70 000 so'm/oy", dailyLimit:60,  perChatLimit:null, cooldownMs:null }
};

function aiUserKey(){
  if(currentUser && currentUser.id) return `user:${currentUser.id}`;
  let anon = localStorage.getItem('ilmnur_anon_id');
  if(!anon){
    anon = 'anon_' + Math.random().toString(36).slice(2) + Date.now().toString(36);
    localStorage.setItem('ilmnur_anon_id', anon);
  }
  return `anon:${anon}`;
}

/* Savol matnining "og'irligi" — uzun/murakkab savol standart 1 ta o'rniga
   2 yoki 3 ta savol o'rnini bosadi, shunday qilib bitta juda katta savol
   kunlik/limitni tezroq kamaytiradi. */
function aiQuestionCost(text){
  const len = (text || '').trim().length;
  if(len > 700) return 3;
  if(len > 280) return 2;
  return 1;
}

async function getUserPlan(){
  try{
    const res = await storage.get(`plan:${aiUserKey()}`);
    if(res && res.value && AI_PLANS[res.value.plan]) return res.value.plan;
  }catch(e){ /* topilmadi — bepul tarif */ }
  return 'free';
}

async function setUserPlan(planKey){
  if(!AI_PLANS[planKey]) return;
  await storage.set(`plan:${aiUserKey()}`, { plan: planKey, since: Date.now() });
}

async function loadAiUsage(){
  try{
    const res = await storage.get(`usage:${aiUserKey()}`);
    if(res && res.value) return res.value;
  }catch(e){ /* hali ishlatilmagan */ }
  return {};
}
async function saveAiUsage(usage){
  try{ await storage.set(`usage:${aiUserKey()}`, usage); }catch(e){ /* Supabase sozlanmagan bo'lsa — jim o'tkazamiz */ }
}

function aiTodayStr(){ return new Date().toISOString().slice(0,10); }

function formatCooldown(ms){
  const totalMin = Math.max(1, Math.ceil(ms / 60000));
  const h = Math.floor(totalMin / 60), m = totalMin % 60;
  if(h > 0) return `${h} soat${m > 0 ? ' ' + m + ' daqiqa' : ''}`;
  return `${m} daqiqa`;
}

/* Savol yuborishdan OLDIN chaqiriladi. chatKey — masalan 'mat', 'it', 'speaking',
   'umumiy' (asosiy AI Yordamchi). Ruxsat bo'lsa {allowed:true}, aks holda
   {allowed:false, message} qaytaradi — message chatda botning javobi sifatida
   muloyim tarzda ko'rsatiladi. */
async function checkAndConsumeAiQuota(chatKey, text){
  const plan = await getUserPlan();
  const cost = aiQuestionCost(text);
  const usage = await loadAiUsage();

  if(plan === 'free'){
    const key = chatKey || 'umumiy';
    const entry = usage[key] || { count: 0, cooldownUntil: 0 };
    const now = Date.now();
    if(entry.cooldownUntil && now < entry.cooldownUntil){
      return { allowed:false, message: `Bu bo'limda bepul savollar limitiga yetdingiz 🙏 Yana ${formatCooldown(entry.cooldownUntil - now)}dan so'ng davom etishimiz mumkin. Kutmasdan ko'proq savol berish uchun Pro yoki Premium tarifga o'tishingiz mumkin — "Tariflar" bo'limiga qarang.` };
    }
    if(entry.count + cost > AI_PLANS.free.perChatLimit){
      entry.cooldownUntil = now + AI_PLANS.free.cooldownMs;
      usage[key] = entry;
      await saveAiUsage(usage);
      return { allowed:false, message: `Bu bo'limda bepul ${AI_PLANS.free.perChatLimit} ta savol limitiga yetdik. 3 soatdan so'ng davom etamiz 🙂 Yoki xohlasangiz, "Tariflar" bo'limidan Pro/Premium tarifga o'tib, kuniga ko'proq savol berishingiz mumkin.` };
    }
    entry.count += cost;
    usage[key] = entry;
    await saveAiUsage(usage);
    return { allowed:true };
  }

  const planCfg = AI_PLANS[plan];
  const day = aiTodayStr();
  const entry = (usage.daily && usage.daily.day === day) ? usage.daily : { day, count: 0 };
  if(entry.count + cost > planCfg.dailyLimit){
    return { allowed:false, message: `Bugungi ${planCfg.label} tarifingiz bo'yicha ${planCfg.dailyLimit} ta savol limitiga yetdingiz. Ertaga yangi limit bilan davom etasiz 🙂` };
  }
  entry.count += cost;
  usage.daily = entry;
  await saveAiUsage(usage);
  return { allowed:true };
}

/* ================= SAVOLLAR SONI KO'RSATKICHI (fan AI'lari yonidagi belgi) =================
   Har bir chatning yonida "X/15 savol qoldi" (yoki Pro/Premium'da "X/25, bugun")
   ko'rinishida qolgan savollar soni ko'rsatiladi; limitga yetgan/kutish vaqtida
   qolgan vaqt ko'rsatiladi. */
async function computeAiRemaining(quotaKey){
  const plan = await getUserPlan();
  const usage = await loadAiUsage();

  if(plan === 'free'){
    const entry = usage[quotaKey] || { count: 0, cooldownUntil: 0 };
    const now = Date.now();
    if(entry.cooldownUntil && now < entry.cooldownUntil){
      return { text: `⏳ ${formatCooldown(entry.cooldownUntil - now)}dan keyin`, empty: true };
    }
    const remaining = Math.max(0, AI_PLANS.free.perChatLimit - entry.count);
    return { text: `${remaining}/${AI_PLANS.free.perChatLimit} savol qoldi`, empty: remaining === 0 };
  }

  const planCfg = AI_PLANS[plan];
  const day = aiTodayStr();
  const entry = (usage.daily && usage.daily.day === day) ? usage.daily : { day, count: 0 };
  const remaining = Math.max(0, planCfg.dailyLimit - entry.count);
  return { text: `${remaining}/${planCfg.dailyLimit} savol qoldi (bugun)`, empty: remaining === 0 };
}

const AI_REMAINING_BADGES = [];
async function refreshAiRemainingBadge(elId, quotaKey){
  const el = document.getElementById(elId);
  if(!el) return;
  try{
    const info = await computeAiRemaining(quotaKey);
    el.textContent = info.text;
    el.classList.toggle('empty', !!info.empty);
  }catch(e){ /* jim o'tkazamiz */ }
}
function registerAiRemainingBadge(elId, quotaKey){
  if(!document.getElementById(elId)) return;
  AI_REMAINING_BADGES.push({ elId, quotaKey });
  refreshAiRemainingBadge(elId, quotaKey);
}
function refreshAllAiRemainingBadges(){
  AI_REMAINING_BADGES.forEach(b => refreshAiRemainingBadge(b.elId, b.quotaKey));
}

/* ================= TARIFLAR (Plans) MODALI ================= */
const plansModal = document.getElementById('plansModal');
const plansContent = document.getElementById('plansContent');
function openPlansModal(){
  closeSidebar();
  renderPlansModal();
  plansModal.classList.add('open');
}
function closePlansModal(){ plansModal.classList.remove('open'); }
const plansModalCloseBtn = document.getElementById('plansModalClose');
if(plansModalCloseBtn) plansModalCloseBtn.addEventListener('click', closePlansModal);
if(plansModal) plansModal.addEventListener('click', (e)=>{ if(e.target === plansModal) closePlansModal(); });
const navPlansLink = document.getElementById('navPlansLink');
if(navPlansLink) navPlansLink.addEventListener('click', (e)=>{ e.preventDefault(); openPlansModal(); });

async function renderPlansModal(){
  if(!plansContent) return;
  plansContent.innerHTML = `<p class="empty-note">Yuklanmoqda...</p>`;
  const plan = await getUserPlan();
  const usage = await loadAiUsage();
  const day = aiTodayStr();
  const dailyUsed = (usage.daily && usage.daily.day === day) ? usage.daily.count : 0;

  function usageLine(p){
    if(p.key === 'free') return `<div class="plan-usage">Har bir fan/bo'lim uchun alohida hisoblanadi.</div>`;
    if(plan === p.key) return `<div class="plan-usage">Bugun ishlatilgan: ${dailyUsed} / ${p.dailyLimit} ta savol</div>`;
    return `<div class="plan-usage">Kuniga ${p.dailyLimit} ta savol</div>`;
  }
  function cardHtml(p){
    const isCurrent = plan === p.key;
    const btn = isCurrent
      ? `<span class="plan-tag">Joriy tarif</span>`
      : (p.key === 'free'
          ? `<button class="btn ghost" data-plan="free" type="button">Bepulga qaytish</button>`
          : `<button class="btn gold" data-plan="${p.key}" type="button">Faollashtirish</button>`);
    const features = p.key === 'free'
      ? [`Har bir fan/bo'limda 15 tagacha savol`, `Limitga yetgach 3 soat kutish`, `Barcha 9 fan + IT, Speaking, Writing`]
      : p.key === 'pro'
      ? [`Kuniga 25 ta savol (barcha bo'limlar birga)`, `Kutishsiz, kunlik limit bilan`, `Uzun savollar ko'proq limit sarflaydi`]
      : [`Kuniga 60 ta savol (barcha bo'limlar birga)`, `Eng yuqori kunlik limit`, `Uzun savollar ko'proq limit sarflaydi`];
    return `
      <div class="plan-card${isCurrent ? ' current' : ''}">
        <h4>${p.label}</h4>
        <div class="plan-price">${p.priceLabel ? p.priceLabel : "0 so'm"}${p.priceLabel ? '' : ' <small>doim bepul</small>'}</div>
        <ul>${features.map(f=>`<li>${f}</li>`).join('')}</ul>
        ${usageLine(p)}
        ${btn}
      </div>`;
  }

  plansContent.innerHTML = `<div class="plans-grid">${cardHtml(AI_PLANS.free)}${cardHtml(AI_PLANS.pro)}${cardHtml(AI_PLANS.premium)}</div>
    <p class="sub" style="margin-top:14px;">To'lov: hozircha faollashtirish namoyish tarzida ishlaydi — haqiqiy to'lovni ulash uchun Payme/Click kabi to'lov tizimi ulanishi kerak.</p>`;

  plansContent.querySelectorAll('button[data-plan]').forEach(btn=>{
    btn.addEventListener('click', async ()=>{
      btn.disabled = true;
      await setUserPlan(btn.dataset.plan);
      await renderPlansModal();
      refreshAllAiRemainingBadges();
    });
  });
}

/* ================= AI CHAT ================= */
const chatLog = document.getElementById('chatLog');
const chatInput = document.getElementById('chatInput');
const chatSend = document.getElementById('chatSend');
function addMsg(text, cls){
  const div = document.createElement('div');
  div.className = 'msg ' + cls;
  div.textContent = text;
  chatLog.appendChild(div);
  chatLog.scrollTop = chatLog.scrollHeight;
  return div;
}
function addTyping(){
  const div = document.createElement('div');
  div.className = 'msg bot typing';
  div.innerHTML = '<span></span><span></span><span></span>';
  chatLog.appendChild(div);
  chatLog.scrollTop = chatLog.scrollHeight;
  return div;
}
const chatHistory = [];
async function sendChat(customText){
  const text = (customText !== undefined ? customText : chatInput.value).trim();
  if(!text || chatSend.disabled) return;
  chatSend.disabled = true;
  const quota = await checkAndConsumeAiQuota('umumiy', text);
  refreshAiRemainingBadge('chatRemaining', 'umumiy');
  if(!quota.allowed){
    addMsg(text, 'user');
    addMsg(quota.message, 'bot');
    if(customText === undefined) chatInput.value = '';
    chatSend.disabled = false;
    return;
  }
  addMsg(text, 'user');
  chatHistory.push({ role: "user", content: text });
  chatInput.value='';
  const thinkingEl = addTyping();
  try{
    const { response, data, isRateLimit } = await fetchAIProxy({
      model: AI_MODEL,
      max_completion_tokens: 650,
      messages: [
        { role: "system", content: "Siz ILMNUR ta'lim platformasining AI yordamchisisiz — o'z sohangizni chuqur biladigan, tajribali professional pedagog kabi javob berasiz. Platformada Ona tili, Rus tili, Ingliz tili, Matematika, Psixologiya, Robototexnika, Oshpazlik, Kiber xavsizlik fanlari o'qitiladi (narxlar: ustoz bilan 50 000 so'm/hafta, AI-robot bilan BEPUL), shuningdek Speaking, Writing va IT/dasturlash bo'limlari ham mavjud. O'quvchilar 8 yoshdan, ustozlar 18 yoshdan qabul qilinadi. Dasturlash yoki IT bo'yicha savol berilsa, qisqa kod misoli bilan aniq tushuntiring. Foydalanuvchi qaysi tilda yozsa, o'sha tilda javob bering. Javoblaringiz professional va aniq, lekin IXCHAM bo'lsin: kamida 5 qator, odatda 5-8 qisqa gap/qatordan oshmasin — cho'zib, ortiqcha kirish-xulosa yozmang, to'g'ridan-to'g'ri mohiyatga o'ting, zarur bo'lsagina bitta qisqa misol keltiring." },
        ...chatHistory
      ]
    });
    thinkingEl.remove();
    if(!response.ok){
      const errMsg = isRateLimit
        ? "Hozir foydalanuvchilar biroz ko'p, tizim band. Iltimos, 10-15 soniyadan so'ng qayta urinib ko'ring."
        : ((data && data.error && data.error.message) ? data.error.message : ("HTTP " + response.status));
      addMsg("Xatolik: " + errMsg, 'bot');
      chatHistory.pop();
      chatSend.disabled = false;
      return;
    }
    const reply = (data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content ? data.choices[0].message.content : "").trim() || "Kechirasiz, javob topilmadi.";
    addMsg(reply, 'bot');
    chatHistory.push({ role: "assistant", content: reply });
  }catch(err){
    thinkingEl.remove();
    addMsg("Ulanishda xatolik yuz berdi: " + (err && err.message ? err.message : "noma'lum xato") + ". Birozdan so'ng qayta urinib ko'ring.", 'bot');
    chatHistory.pop();
  }
  chatSend.disabled = false;
  chatInput.focus();
}
chatSend.addEventListener('click', ()=>sendChat());
chatInput.addEventListener('keydown', e=>{ if(e.key==='Enter') sendChat(); });
document.querySelectorAll('#chatSuggestions .chip').forEach(chip=>{
  chip.addEventListener('click', ()=>sendChat(chip.textContent));
});
const chatClearBtn = document.getElementById('chatClearBtn');
if(chatClearBtn){
  chatClearBtn.addEventListener('click', ()=>{
    chatHistory.length = 0;
    chatLog.innerHTML = `<div class="msg bot">${I18N[document.documentElement.getAttribute('data-lang')]?.ai_greeting || I18N.uz.ai_greeting}</div>`;
  });
}
registerAiRemainingBadge('chatRemaining', 'umumiy');


/* ================= TRANSLATION HELPER (shared) ================= */
async function translateText(text, targetLanguage){
  const { response, data, isRateLimit } = await fetchAIProxy({
    model: AI_MODEL_FAST,
    max_completion_tokens: 800,
    messages: [
      { role: "system", content: `You are a translation engine. Translate the user's text into ${targetLanguage}. Reply with ONLY the translation, nothing else — no notes, no quotation marks.` },
      { role: "user", content: text }
    ]
  });
  if(!response.ok){
    const errMsg = isRateLimit
      ? "Tizim hozir band, 10-15 soniyadan so'ng qayta urinib ko'ring."
      : ((data && data.error && data.error.message) ? data.error.message : ("HTTP " + response.status));
    throw new Error(errMsg);
  }
  return (data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content ? data.choices[0].message.content : "").trim();
}

/* ================= GENERIC AI HELPER ================= */
async function callClaude(systemPrompt, userText, maxTokens, model){
  const { response, data, isRateLimit } = await fetchAIProxy({
    model: model || AI_MODEL,
    max_completion_tokens: maxTokens || 800,
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: userText }
    ]
  });
  if(!response.ok){
    const errMsg = isRateLimit
      ? "Tizim hozir band, 10-15 soniyadan so'ng qayta urinib ko'ring."
      : ((data && data.error && data.error.message) ? data.error.message : ("HTTP " + response.status));
    throw new Error(errMsg);
  }
  return (data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content ? data.choices[0].message.content : "").trim();
}

/* ================= AI JAVOBLARINI KESHLASH (kv_store orqali) =================
   Fan/mavzu sahifalari ochilganda AI tushuntirishi AVTOMATIK so'raladi.
   Mavzular soni cheklangan (bitta fanda ~20 ta), shuning uchun bir marta
   yaratilgan tushuntirishni barcha foydalanuvchilar uchun keshlab qo'yamiz —
   ikkinchi marta ochilganda AI'ga umuman so'rov ketmaydi (bazadan darhol
   o'qiladi), bu ham tezlikni oshiradi, ham Groq limitini tejaydi. */
async function getCachedAI(cacheKey, generateFn){
  try{
    const cached = await storage.get(cacheKey);
    if(cached && cached.value) return cached.value;
  }catch(e){ /* keshda yo'q yoki Supabase sozlanmagan — davom etamiz */ }
  const fresh = await generateFn();
  storage.set(cacheKey, fresh).catch(()=>{});
  return fresh;
}

/* ================= ARTICLE: ask about a topic / generate a custom article ================= */
const articleQueryBtn = document.getElementById('articleQueryBtn');
if(articleQueryBtn){
  articleQueryBtn.addEventListener('click', async ()=>{
    const topic = document.getElementById('articleQueryInput').value.trim();
    const resultEl = document.getElementById('articleQueryResult');
    if(!topic){ resultEl.innerHTML = '<p class="empty-note">Avval mavzuni kiriting.</p>'; return; }
    resultEl.innerHTML = '<p class="empty-note">Ma\'lumot izlanmoqda...</p>';
    try{
      const info = await callClaude(
        "You are a senior research analyst with deep subject-matter expertise. Given a topic, provide a professional, well-informed overview: what is generally known about this topic, the key facts, context, and why it matters to readers today. Write 6-8 substantive, well-organized sentences at a professional/academic quality level — not superficial. Reply in the same language the user wrote in. Never fabricate specific named sources — speak in general, well-grounded terms.",
        topic, 900
      );
      resultEl.innerHTML = `<div class="translation-box"><b>Ma'lumot</b><p>${info}</p></div>`;
    }catch(e){
      resultEl.innerHTML = `<p class="empty-note">Xatolik: ${e.message || "noma'lum xato"}</p>`;
    }
  });
}
const articleCustomBtn = document.getElementById('articleCustomBtn');
if(articleCustomBtn){
  articleCustomBtn.addEventListener('click', async ()=>{
    const instructions = document.getElementById('articleCustomInput').value.trim();
    const resultEl = document.getElementById('articleCustomResult');
    if(!instructions){ resultEl.innerHTML = '<p class="empty-note">Avval qanday maqola kerakligini yozing.</p>'; return; }
    resultEl.innerHTML = '<p class="empty-note">Maqola yozilmoqda...</p>';
    try{
      const article = await callClaude(
        "You are an accomplished professional journalist and academic writer, the kind whose long-form articles are published in respected magazines and assigned as reading for university students. Write a complete, in-depth, exceptionally well-structured original article that precisely follows the user's instructions (topic, tone, language, style). Unless the user specifies a shorter length, write a substantial, comprehensive long-form article — aim for at least 2500-3500 words (roughly 10+ printed pages), thorough enough that a student could cite it as a serious source and an engaged general reader (the kind who reads in-depth pieces, not just short posts) would find it rich and rewarding. Structure it properly: a compelling title on the first line, then an engaging introduction, several clearly developed sections (use short section headings in plain text, not markdown symbols), concrete examples, nuance and depth on each point, and a strong conclusion. Write with the authority, clarity, and polish of a professional — never generic, shallow, or padded with filler. Plain text only, no markdown symbols (no #, no **, no bullet dashes) — use plain paragraph breaks and simple section headings instead.",
        instructions, 6500
      );
      resultEl.innerHTML = `<div class="translation-box"><b>Yaratilgan maqola</b><p style="white-space:pre-wrap;">${article}</p></div>`;
    }catch(e){
      resultEl.innerHTML = `<p class="empty-note">Xatolik: ${e.message || "noma'lum xato"}</p>`;
    }
  });
}

/* ================= IT: w3schools-style tutorial (language tabs + topic sidebar + live "Try it") ================= */
const IT_LANGUAGES = {
  "HTML": ["Home","Kirish","Muharrirlar","Asosiy tuzilma","Elementlar","Atributlar","Sarlavhalar","Paragraflar","Formatlash","Iqtiboslar","Izohlar","Ranglar","HTML va CSS","Havolalar","Rasmlar","Sevimli belgi (Favicon)","Sahifa sarlavhasi","Jadvallar","Ro'yxatlar","Block va Inline","Div elementi","Klasslar","Id atributi","Iframe","HTML va JavaScript","Fayl yo'llari","Head qismi","Layout (sahifa tuzilishi)","Responsive dizayn","Formalar","Forma atributlari","Kiritish turlari (Input types)","Semantik teglar","Audio va Video","Belgilar (Entities)","Emoji va Simvollar"],
  "CSS": ["Home","Kirish","Sintaksis","Selektorlar","Qanday qo'shiladi (How To)","Kommentariyalar","Ranglar","Fonlar (Backgrounds)","Border (chegara)","Margin","Padding","Height/Width","Box model","Outline","Matn (Text)","Shriftlar (Fonts)","Ikonkalar","Havolalar (Links)","Ro'yxatlar","Jadvallar","Display","Max-width","Position","Z-index","Overflow","Float","Inline-block","Align","Combinators","Pseudo-class","Pseudo-element","Opacity","Navigation Bar","Flexbox","Grid","Responsive dizayn","Animatsiyalar","Transition"],
  "JavaScript": ["Home","Kirish","Qayerga joylashtiriladi","Chiqish (Output)","Sintaksis","Statements","Sharhlar (Comments)","O'zgaruvchilar (var/let/const)","Operatorlar","Ma'lumot turlari","Funksiyalar","Obyektlar","Massivlar (Arrays)","Sanalar (Dates)","Shart operatorlari (if/else)","Switch","Sikllar (for)","Sikllar (while)","Break/Continue","Massiv metodlari","Obyekt metodlari","String metodlari","Sonlar (Numbers)","Arrow function","Classes","JSON","DOM bilan ishlash","Event'lar","Try/Catch (Xatoliklar)","Async/Await","Fetch va API"],
  "Python": ["Home","Kirish","O'rnatish","Sintaksis","Kommentariyalar","O'zgaruvchilar","Ma'lumot turlari","Sonlar","Kasting (Type Casting)","Stringlar","Boolean","Operatorlar","Listlar","Tuplelar","Setlar","Dictionarylar","Shart operatorlari (if/else)","While sikli","For sikli","Funksiyalar","Lambda","Massivlar","Klasslar/Obyektlar","Meros (Inheritance)","Iteratorlar","Modullar","Fayllar bilan ishlash","Xatoliklarni qayta ishlash (Try/Except)","PIP paketlari"],
  "SQL": ["Home","Kirish","Sintaksis","SELECT","SELECT DISTINCT","WHERE","ORDER BY","AND/OR/NOT","INSERT INTO","NULL qiymatlar","UPDATE","DELETE","SELECT TOP/LIMIT","MIN/MAX","COUNT/AVG/SUM","LIKE","Wildcards","IN operatori","BETWEEN","Aliaslar","JOIN turlari","UNION","GROUP BY","HAVING","EXISTS","CREATE TABLE","ALTER TABLE","Cheklovlar (Constraints)","Indekslar"],
  "Java": ["Home","Kirish","Sintaksis","Kommentariyalar","O'zgaruvchilar","Ma'lumot turlari","Type Casting","Operatorlar","Stringlar","Matematik amallar","Boolean","Shart operatorlari","Switch","While sikli","For sikli","Massivlar (Arrays)","Metodlar (Methods)","Sinflar/Obyektlar","Klass atributlari","Konstruktorlar","Modifikatorlar","Meros (Inheritance)","Polimorfizm","Interfeyslar","Xatoliklarni qayta ishlash"],
  "PHP": ["Home","Kirish","Sintaksis","Kommentariyalar","O'zgaruvchilar","Echo/Print","Ma'lumot turlari","Stringlar","Sonlar","Konstantalar","Operatorlar","Shart operatorlari","Sikllar","Funksiyalar","Massivlar","Superglobal o'zgaruvchilar","Formalar bilan ishlash","Forma validatsiyasi","Sessiyalar","Fayllar bilan ishlash","MySQL bilan ulanish","MySQL so'rovlari (Query)"],
  "C++": ["Home","Kirish","Sintaksis","Chiqish (Output)","Kommentariyalar","O'zgaruvchilar","Ma'lumot turlari","Operatorlar","Stringlar","Matematik amallar","Boolean","Shart operatorlari","Switch","While sikli","For sikli","Break/Continue","Massivlar","Strukturalar","Referenslar","Pointerlar","Funksiyalar","Rekursiya","Klasslar/Obyektlar","Konstruktorlar","Meros (Inheritance)"],
};
const WEB_LANGS = ["HTML","CSS","JavaScript"];
let itActiveLang = "HTML";
let itActiveTopic = "Home";

const w3LangTabs = document.getElementById('w3LangTabs');
const w3Sidebar = document.getElementById('w3Sidebar');
const w3Content = document.getElementById('w3Content');
const w3ContentTitle = document.getElementById('w3ContentTitle');
const w3Code = document.getElementById('w3Code');
const w3RunBtn = document.getElementById('w3RunBtn');
const w3OutputWrap = document.getElementById('w3OutputWrap');
const w3Output = document.getElementById('w3Output');
const w3AiOutput = document.getElementById('w3AiOutput');

Object.keys(IT_LANGUAGES).forEach(lang=>{
  const tab = document.createElement('button');
  tab.type = 'button';
  tab.className = 'w3-lang-tab' + (lang===itActiveLang ? ' active' : '');
  tab.textContent = lang;
  tab.addEventListener('click', ()=>{
    itActiveLang = lang;
    itActiveTopic = IT_LANGUAGES[lang][0];
    document.querySelectorAll('.w3-lang-tab').forEach(t=>t.classList.remove('active'));
    tab.classList.add('active');
    renderSidebar();
    loadTopicContent();
  });
  w3LangTabs.appendChild(tab);
});

function renderSidebar(){
  w3Sidebar.innerHTML = '';
  IT_LANGUAGES[itActiveLang].forEach(topic=>{
    const item = document.createElement('button');
    item.type = 'button';
    item.className = 'w3-sidebar-item' + (topic===itActiveTopic ? ' active' : '');
    item.textContent = topic;
    item.addEventListener('click', ()=>{
      itActiveTopic = topic;
      document.querySelectorAll('.w3-sidebar-item').forEach(i=>i.classList.remove('active'));
      item.classList.add('active');
      loadTopicContent();
    });
    w3Sidebar.appendChild(item);
  });
}
renderSidebar();

async function loadTopicContent(){
  w3ContentTitle.textContent = `${itActiveLang} — ${itActiveTopic}`;
  w3Content.innerHTML = `<h3 id="w3ContentTitle">${itActiveLang} — ${itActiveTopic}</h3><p class="empty-note">Yuklanmoqda...</p>`;
  w3OutputWrap.style.display = 'none';
  w3AiOutput.innerHTML = '';
  try{
    const raw = await getCachedAI(`aicache:it:${itActiveLang}:${itActiveTopic}`, () => callClaude(
      `You are a professional software engineer and experienced instructor writing a thorough, expert-quality w3schools-style tutorial lesson in Uzbek. Language: ${itActiveLang}. Topic: "${itActiveTopic}". Structure your reply as exactly two parts separated by the line "---CODE---": first a detailed, professional-quality explanation (10-14 sentences covering what it is, why/when it's used, important details, best practices, and common mistakes even experienced developers should watch for), then after the separator one clean, complete, well-commented, production-quality code example (plain text, no markdown fences) that demonstrates the topic thoroughly.`,
      `${itActiveLang}: ${itActiveTopic}`, 1800
    ));
    const [explanation, code] = raw.split('---CODE---').map(s=>(s||'').trim());
    w3Content.innerHTML = `<h3 id="w3ContentTitle">${itActiveLang} — ${itActiveTopic}</h3><p style="white-space:pre-wrap;">${explanation || raw}</p>${code ? `<pre>${code}</pre>` : ''}`;
    if(code){
      w3Code.value = code;
    }
  }catch(e){
    w3Content.innerHTML = `<h3 id="w3ContentTitle">${itActiveLang} — ${itActiveTopic}</h3><p class="empty-note">Xatolik: ${e.message || "noma'lum xato"}</p>`;
  }
}

w3RunBtn.addEventListener('click', async ()=>{
  const code = w3Code.value;
  if(!code.trim()){ return; }
  if(WEB_LANGS.includes(itActiveLang)){
    w3AiOutput.innerHTML = '';
    let srcdoc = '';
    if(itActiveLang === 'HTML') srcdoc = code;
    else if(itActiveLang === 'CSS') srcdoc = `<html><body style="font-family:sans-serif;padding:16px;"><style>${code}</style><h2>Namuna sarlavha</h2><p>Bu — CSS natijasini ko'rsatuvchi namuna matn.</p><button>Tugma</button></body></html>`;
    else srcdoc = `<html><body style="font-family:sans-serif;padding:16px;"><div id="output"></div><script>${code}<\/script></body></html>`;
    w3OutputWrap.style.display = 'block';
    w3Output.srcdoc = srcdoc;
  }else{
    w3OutputWrap.style.display = 'none';
    w3AiOutput.innerHTML = '<p class="empty-note">Natija tayyorlanmoqda...</p>';
    try{
      const explanation = await callClaude(
        `The user is running ${itActiveLang} code that cannot execute directly in a browser. Explain step by step what this code would output or do if run, as if simulating its execution. Be concise. Reply in Uzbek.`,
        code, 700, AI_MODEL_FAST
      );
      w3AiOutput.innerHTML = `<div class="translation-box"><b>Kutilgan natija (AI tushuntirishi)</b><pre style="white-space:pre-wrap;margin:0;">${explanation}</pre></div>`;
    }catch(e){
      w3AiOutput.innerHTML = `<p class="empty-note">Xatolik: ${e.message || "noma'lum xato"}</p>`;
    }
  }
});

loadTopicContent();

/* ================= 4 INDEPENDENT SUBJECT PAGES: Psixologiya / Robototexnika / Oshpazlik / Kiber xavsizlik ================= */
const STANDALONE_SUBJECTS = [
  {
    key:'ona', name:'Ona tili', color:'#1F9D6C',
    topicsEl:'onaTopics', contentEl:'onaContent',
    topics: ["Kirish","Alifbo va tovushlar","Unli va undosh tovushlar","Bo'g'in va urg'u","So'z turkumlari","Ot","Sifat","Son","Olmosh","Fe'l","Ravish","Sinonim va antonim","Omonim","Ko'chma ma'no","Gap bo'laklari","Ega va kesim","Sodda va qo'shma gap","Tinish belgilari","Imlo qoidalari","Nutq odobi"],
  },
  {
    key:'rus', name:'Rus tili', color:'#E2574C',
    topicsEl:'rusTopics', contentEl:'rusContent',
    topics: ["Kirish","Alfavit","Fonetika asoslari","Otlar (Существительные)","Sifatlar (Прилагательные)","Fe'llar (Глаголы)","Kelishiklar (Падежи)","Zamonlar","Olmoshlar","Sonlar","Ravishlar","So'z birikmalari","Gap tuzilishi","Muloqot iboralari","Salomlashuv va xayrlashuv","Kundalik lug'at","Grammatik qoidalar","Yozma nutq","Og'zaki nutq","Imlo va punktuatsiya"],
  },
  {
    key:'ingliz', name:'Ingliz tili', color:'#2E6BE0',
    topicsEl:'inglizTopics', contentEl:'inglizContent',
    topics: ["Kirish (Introduction)","Alifbo va talaffuz","Grammar asoslari","Present Simple","Present Continuous","Past Simple","Future Simple","Nouns va Articles","Adjectives","Pronouns","Prepositions","Modal Verbs","Question forms","Vocabulary: Everyday life","Speaking phrases","Listening ko'nikmalari","Writing asoslari","Idioms","Phrasal Verbs","Exam tayyorgarligi"],
  },
  {
    key:'mat', name:'Matematika', color:'#F2A93C',
    topicsEl:'matTopics', contentEl:'matContent',
    topics: ["Kirish","Natural sonlar","Butun sonlar","Kasrlar","Foizlar","Tenglamalar","Tengsizliklar","Geometriya asoslari","Perimetr va yuza","Hajm hisoblash","Proporsiya","Funksiyalar","Algebraik ifodalar","Statistika asoslari","Ehtimollik nazariyasi","Trigonometriya asoslari","Vektorlar","Logika masalalari","Mantiqiy fikrlash","Masala yechish usullari"],
  },
  {
    key:'psix', name:'Psixologiya', color:'#8B5FBF',
    topicsEl:'psixTopics', contentEl:'psixContent',
    topics: ["Kirish","Psixologiya nima","Xotira turlari","Motivatsiya","Emotsiyalar","Shaxsiyat tiplari","Temperament turlari","Stress boshqaruvi","Bolalar psixologiyasi","O'smirlar psixologiyasi","Muloqot psixologiyasi","Xulq-atvor nazariyalari","Klassik shartlanish","Kognitiv psixologiya","O'z-o'zini anglash","Empatiya","Fobiyalar","Uyqu va ruhiy salomatlik","Motivatsion nazariyalar","Guruh psixologiyasi"],
  },
  {
    key:'robot', name:'Robototexnika', color:'#0891B2',
    topicsEl:'robotTopics', contentEl:'robotContent',
    topics: ["Kirish","Robot nima","Sensorlar","Motorlar va aktuatorlar","Arduino asoslari","Raspberry Pi asoslari","Elektronika asoslari","Sxemalar (Circuits)","Robot dasturlash","Avtonom tizimlar","Sun'iy intellekt va robotlar","Sanoat robototexnikasi","Robot dizayni","Mexanik qismlar","Quvvat manbalari","Robotexnika musobaqalari","Kelajak texnologiyalari","Dronlar asoslari"],
  },
  {
    key:'oshpaz', name:'Oshpazlik', color:'#E8752C',
    topicsEl:'oshpazTopics', contentEl:'oshpazContent',
    topics: ["Kirish","Oshxona asboblari","Asosiy pishirish usullari","Xamir bilan ishlash","Sous tayyorlash","Go'sht pishirish","Baliq pishirish","Sabzavot pishirish","Salatlar tayyorlash","Shirinliklar asoslari","Milliy taomlar","Non yopish","Ziravorlar dunyosi","Oshxona xavfsizligi","Ovqat saqlash usullari","Stol tuzish madaniyati","Vegetarian taomlar","Nonushta retseptlari"],
  },
  {
    key:'kiber', name:'Kiber xavsizlik', color:'#334155',
    topicsEl:'kiberTopics', contentEl:'kiberContent',
    topics: ["Kirish","Kiber xavsizlik nima","Parol xavfsizligi","Fishing va firibgarlik","Tarmoq xavfsizligi","VPN nima","Ma'lumotlarni himoya qilish","Ijtimoiy tarmoq xavfsizligi","Zararli dasturlar (Malware)","Ransomware","Xavfsiz internetdan foydalanish","Kiber gigiyena","Ikki bosqichli autentifikatsiya","Firewall asoslari","Shifrlash (Encryption)","Bolalar internet xavfsizligi","Korporativ kiber xavfsizlik"],
  },
];

STANDALONE_SUBJECTS.forEach(subj=>{
  const topicsWrap = document.getElementById(subj.topicsEl);
  const contentEl = document.getElementById(subj.contentEl);
  if(!topicsWrap || !contentEl) return;
  let activeTopic = subj.topics[0];

  function renderTopics(){
    topicsWrap.innerHTML = '';
    subj.topics.forEach(topic=>{
      const pill = document.createElement('button');
      pill.type = 'button';
      pill.className = 'subject-topic-pill' + (topic===activeTopic ? ' active' : '');
      pill.textContent = topic;
      pill.addEventListener('click', ()=>{
        activeTopic = topic;
        topicsWrap.querySelectorAll('.subject-topic-pill').forEach(p=>p.classList.remove('active'));
        pill.classList.add('active');
        loadContent();
      });
      topicsWrap.appendChild(pill);
    });
  }

  async function loadContent(){
    contentEl.innerHTML = `<h4>${subj.name} — ${activeTopic}</h4><p class="empty-note">Yuklanmoqda...</p>`;
    try{
      const explanation = await getCachedAI(`aicache:${subj.key}:${activeTopic}`, () => callClaude(
        `You are a professional subject-matter expert and experienced teacher writing an in-depth educational explainer in Uzbek for a serious learning platform. Subject: ${subj.name}. Topic: "${activeTopic}". Write a thorough, professional-quality explanation (10-14 well-organized sentences): precisely define the concept, explain why it matters, cover key details and nuances an expert would mention, address common misconceptions, and give at least one concrete, well-explained practical example. Write with the depth and authority of a real subject expert, not a generic summary. Plain text only, no markdown.`,
        `${subj.name}: ${activeTopic}`, 1600
      ));
      contentEl.innerHTML = `<h4>${subj.name} — ${activeTopic}</h4><p>${explanation}</p>`;
    }catch(e){
      contentEl.innerHTML = `<h4>${subj.name} — ${activeTopic}</h4><p class="empty-note">Xatolik: ${e.message || "noma'lum xato"}</p>`;
    }
  }

  renderTopics();
  loadContent();

  setupChatWidget({
    logId: subj.key+'ChatLog', inputId: subj.key+'ChatInput', sendId: subj.key+'ChatSend', clearId: subj.key+'ChatClearBtn',
    quotaKey: subj.key,
    remainingId: subj.key+'ChatRemaining',
    greeting: `Salom! Men ${subj.name} bo'yicha AI yordamchiman. Istalgan savolingizga javob beraman.`,
    maxTokens: 600,
    systemPromptFn: ()=>`Siz ILMNUR platformasining ${subj.name} yo'nalishi bo'yicha ishlaydigan, sohasini chuqur biladigan professional AI yordamchisisiz. Foydalanuvchi hozir "${activeTopic}" mavzusini ko'rmoqda. Aniq va professional javob bering — ekspert kabi, lekin IXCHAM: kamida 5 qator, odatda 5-8 qisqa gapdan oshmasin, ortiqcha cho'zib yubormang, to'g'ridan-to'g'ri mohiyatga o'ting, zarur bo'lsagina bitta qisqa misol keltiring. Foydalanuvchi qaysi tilda yozsa, o'sha tilda javob bering.`
  });
});

/* ================= GENERIC PERSISTENT CHAT WIDGET (reused for IT and standalone subject pages) ================= */
function setupChatWidget({logId, inputId, sendId, clearId, systemPromptFn, greeting, maxTokens, quotaKey, remainingId}){
  const log = document.getElementById(logId);
  const input = document.getElementById(inputId);
  const send = document.getElementById(sendId);
  const clearBtn = document.getElementById(clearId);
  const qKey = quotaKey || logId;
  const history = [];
  function addMsg(text, cls){
    const div = document.createElement('div');
    div.className = 'msg ' + cls;
    div.textContent = text;
    log.appendChild(div);
    log.scrollTop = log.scrollHeight;
    return div;
  }
  function addTyping(){
    const div = document.createElement('div');
    div.className = 'msg bot typing';
    div.innerHTML = '<span></span><span></span><span></span>';
    log.appendChild(div);
    log.scrollTop = log.scrollHeight;
    return div;
  }
  async function send_(){
    const text = input.value.trim();
    if(!text || send.disabled) return;
    send.disabled = true;
    const quota = await checkAndConsumeAiQuota(qKey, text);
    if(remainingId) refreshAiRemainingBadge(remainingId, qKey);
    if(!quota.allowed){
      addMsg(text, 'user');
      addMsg(quota.message, 'bot');
      input.value = '';
      send.disabled = false;
      return;
    }
    addMsg(text, 'user');
    history.push({ role: "user", content: text });
    input.value = '';
    const thinking = addTyping();
    try{
      const { response, data, isRateLimit } = await fetchAIProxy({
        model: AI_MODEL,
        max_completion_tokens: maxTokens || 1700,
        messages: [
          { role: "system", content: systemPromptFn() },
          ...history
        ]
      });
      thinking.remove();
      if(!response.ok){
        const errMsg = isRateLimit
          ? "Tizim hozir band, 10-15 soniyadan so'ng qayta urinib ko'ring."
          : ((data && data.error && data.error.message) ? data.error.message : ("HTTP " + response.status));
        addMsg("Xatolik: " + errMsg, 'bot');
        history.pop();
        send.disabled = false;
        return;
      }
      const reply = (data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content ? data.choices[0].message.content : "").trim() || "Kechirasiz, javob topilmadi.";
      addMsg(reply, 'bot');
      history.push({ role: "assistant", content: reply });
    }catch(err){
      thinking.remove();
      addMsg("Ulanishda xatolik: " + (err && err.message ? err.message : "noma'lum xato"), 'bot');
      history.pop();
    }
    send.disabled = false;
    input.focus();
  }
  send.addEventListener('click', send_);
  input.addEventListener('keydown', e=>{ if(e.key==='Enter') send_(); });
  if(clearBtn){
    clearBtn.addEventListener('click', ()=>{
      history.length = 0;
      log.innerHTML = `<div class="msg bot">${greeting}</div>`;
    });
  }
  if(remainingId) registerAiRemainingBadge(remainingId, qKey);
}

setupChatWidget({
  logId:'itChatLog', inputId:'itChatInput', sendId:'itChatSend', clearId:'itChatClearBtn',
  quotaKey: 'it',
  remainingId: 'itChatRemaining',
  greeting:"Salom! Men dasturlash bo'yicha AI yordamchiman. HTML, CSS, JavaScript, Python va boshqa tillar bo'yicha istalgan savolingizga javob beraman.",
  systemPromptFn: ()=>`Siz ILMNUR platformasining IT/dasturlash bo'yicha ishlaydigan, professional dasturchi darajasidagi AI yordamchisisiz. Foydalanuvchi hozir "${itActiveLang}" tili, "${itActiveTopic}" mavzusini ko'rmoqda. Dasturlash savollariga chuqur bilim bilan, aniq kod misollari va eng yaxshi amaliyotlar (best practices) bilan javob bering — sayoz emas, senior dasturchi kabi tushuntiring. Foydalanuvchi qaysi tilda yozsa, o'sha tilda javob bering.`
});


const speakText = document.getElementById('speakText');
const speakRecordBtn = document.getElementById('speakRecordBtn');
const speakTimerEl = document.getElementById('speakTimer');
const speakResultEl = document.getElementById('speakResult');
let speakInterval = null;
let speakRecognition = null;

function getSpeechRecognition(){
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if(!SR) return null;
  const r = new SR();
  r.continuous = true;
  r.interimResults = true;
  r.lang = (navigator.language || 'uz-UZ');
  return r;
}

speakRecordBtn.addEventListener('click', ()=>{
  if(speakInterval) return;
  let secondsLeft = 20;
  speakText.value = '';
  speakText.disabled = false;
  speakText.focus();
  speakResultEl.innerHTML = '';
  speakRecordBtn.disabled = true;
  speakTimerEl.textContent = `⏱ ${secondsLeft}s 🔴`;
  speakInterval = setInterval(()=>{
    secondsLeft--;
    speakTimerEl.textContent = `⏱ ${secondsLeft}s 🔴`;
    if(secondsLeft<=0){
      clearInterval(speakInterval);
      speakInterval = null;
      finishSpeaking();
    }
  }, 1000);

  speakRecognition = getSpeechRecognition();
  if(speakRecognition){
    let finalTranscript = '';
    speakRecognition.onresult = (event)=>{
      let interim = '';
      for(let i=event.resultIndex; i<event.results.length; i++){
        const transcript = event.results[i][0].transcript;
        if(event.results[i].isFinal) finalTranscript += transcript + ' ';
        else interim += transcript;
      }
      speakText.value = (finalTranscript + interim).trim();
    };
    speakRecognition.onerror = ()=>{ /* mic unavailable or denied — user can still type manually */ };
    try{ speakRecognition.start(); }catch(e){ /* ignore */ }
  }
});

function speakAloud(text){
  if(!('speechSynthesis' in window) || !text) return;
  window.speechSynthesis.cancel();
  const utter = new SpeechSynthesisUtterance(text);
  utter.lang = 'en-US';
  window.speechSynthesis.speak(utter);
}

async function finishSpeaking(){
  if(speakRecognition){
    try{ speakRecognition.stop(); }catch(e){ /* ignore */ }
    speakRecognition = null;
  }
  speakText.disabled = true;
  speakRecordBtn.disabled = false;
  speakTimerEl.textContent = '';
  const text = speakText.value.trim();
  if(!text){
    speakResultEl.innerHTML = '<p class="empty-note">Matn yozilmadi yoki gapirilmadi.</p>';
    return;
  }
  speakResultEl.innerHTML = '<p class="empty-note">Tarjima qilinmoqda...</p>';
  try{
    const translation = await translateText(text, "English");
    speakResultEl.innerHTML = `<div class="translation-box"><b>Inglizcha tarjima</b><p>${translation}</p></div>`;
    speakAloud(translation);
  }catch(e){
    speakResultEl.innerHTML = `<p class="empty-note">Tarjimada xatolik: ${e.message || "noma'lum xato"}</p>`;
  }
}

const speakChatLog = document.getElementById('speakChatLog');
const speakChatInput = document.getElementById('speakChatInput');
const speakChatSend = document.getElementById('speakChatSend');
const speakChatHistory = [];
function addSpeakMsg(text, cls){
  const div = document.createElement('div');
  div.className = 'msg ' + cls;
  div.textContent = text;
  speakChatLog.appendChild(div);
  speakChatLog.scrollTop = speakChatLog.scrollHeight;
}
async function sendSpeakChat(){
  const text = speakChatInput.value.trim();
  if(!text || speakChatSend.disabled) return;
  speakChatSend.disabled = true;
  const quota = await checkAndConsumeAiQuota('speaking', text);
  refreshAiRemainingBadge('speakChatRemaining', 'speaking');
  if(!quota.allowed){
    addSpeakMsg(text, 'user');
    addSpeakMsg(quota.message, 'bot');
    speakChatInput.value = '';
    speakChatSend.disabled = false;
    return;
  }
  addSpeakMsg(text, 'user');
  speakChatHistory.push({ role: "user", content: text });
  speakChatInput.value='';
  addSpeakMsg('...', 'bot');
  const thinkingEl = speakChatLog.lastChild;
  try{
    const { response, data, isRateLimit } = await fetchAIProxy({
      model: AI_MODEL,
      max_completion_tokens: 1300,
      messages: [
        { role: "system", content: "Siz ILMNUR platformasining Speaking (gapirish/yozish mashqi) bo'limidagi, til o'qitishda tajribali professional til o'qituvchisi darajasidagi AI yordamchisisiz. O'quvchiga o'z matnini chuqur tahlil qilib yaxshilashda, so'z boyligini oshirishda, grammatik va uslubiy jihatdan professional darajada maslahat berishda yordam bering — sayoz emas, tajribali til mutaxassisi kabi batafsil va foydali fikr bildiring. Foydalanuvchi qaysi tilda yozsa, o'sha tilda javob bering." },
        ...speakChatHistory
      ]
    });
    thinkingEl.remove();
    if(!response.ok){
      const errMsg = isRateLimit
        ? "Tizim hozir band, 10-15 soniyadan so'ng qayta urinib ko'ring."
        : ((data && data.error && data.error.message) ? data.error.message : ("HTTP " + response.status));
      addSpeakMsg("Xatolik: " + errMsg, 'bot');
      speakChatHistory.pop();
      speakChatSend.disabled = false;
      return;
    }
    const reply = (data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content ? data.choices[0].message.content : "").trim() || "Kechirasiz, javob topilmadi.";
    addSpeakMsg(reply, 'bot');
    speakChatHistory.push({ role: "assistant", content: reply });
  }catch(err){
    thinkingEl.remove();
    addSpeakMsg("Ulanishda xatolik: " + (err && err.message ? err.message : "noma'lum xato"), 'bot');
    speakChatHistory.pop();
  }
  speakChatSend.disabled = false;
}
speakChatSend.addEventListener('click', sendSpeakChat);
speakChatInput.addEventListener('keydown', e=>{ if(e.key==='Enter') sendSpeakChat(); });
registerAiRemainingBadge('speakChatRemaining', 'speaking');

/* ================= WRITING: pick from 16 global languages, translate ================= */
const WRITING_LANGUAGES = [
  "Ingliz tili","Rus tili","O'zbek tili","Xitoy tili","Ispan tili","Hind tili","Arab tili",
  "Portugal tili","Bengal tili","Fransuz tili","Nemis tili","Yapon tili","Turk tili",
  "Koreys tili","Italyan tili","Urdu tili"
];
const writeLangSelect = document.getElementById('writeLang');
WRITING_LANGUAGES.forEach(lang=>{
  const opt = document.createElement('option');
  opt.value = lang; opt.textContent = lang;
  writeLangSelect.appendChild(opt);
});
document.getElementById('writeTranslateBtn').addEventListener('click', async ()=>{
  const text = document.getElementById('writeText').value.trim();
  const lang = writeLangSelect.value;
  const resultEl = document.getElementById('writeResult');
  if(!text){ resultEl.innerHTML = '<p class="empty-note">Avval matn kiriting.</p>'; return; }
  resultEl.innerHTML = '<p class="empty-note">Tarjima qilinmoqda...</p>';
  try{
    const translation = await translateText(text, lang);
    resultEl.innerHTML = `<div class="translation-box"><b>${lang}ga tarjima</b><p>${translation}</p></div>`;
  }catch(e){
    resultEl.innerHTML = `<p class="empty-note">Tarjimada xatolik: ${e.message || "noma'lum xato"}</p>`;
  }
});

/* ================= TEACHER REGISTRATION: live validation + 2-step form ================= */
const tError = document.getElementById('tError');
const tSuccess = document.getElementById('tSuccess');

function setHint(fieldId, ok, msg){
  const input = document.getElementById(fieldId);
  const hint = document.getElementById(fieldId + '-hint');
  if(!input || !hint) return;
  input.classList.remove('valid','invalid');
  if(msg===null){ hint.textContent=''; hint.className='field-hint'; return; }
  input.classList.add(ok ? 'valid' : 'invalid');
  hint.textContent = msg;
  hint.className = 'field-hint ' + (ok ? 'ok' : 'err');
}
function validateName(){
  const v = document.getElementById('tName').value.trim();
  if(!v){ setHint('tName', false, null); return false; }
  const ok = v.length>=2;
  setHint('tName', ok, ok ? "To'g'ri" : "Kamida 2 harf kiriting");
  return ok;
}
function validateSurname(){
  const v = document.getElementById('tSurname').value.trim();
  if(!v){ setHint('tSurname', false, null); return false; }
  const ok = v.length>=2;
  setHint('tSurname', ok, ok ? "To'g'ri" : "Kamida 2 harf kiriting");
  return ok;
}
function validateAge(){
  const raw = document.getElementById('tAge').value;
  if(!raw){ setHint('tAge', false, null); return false; }
  const v = parseInt(raw,10);
  const ok = v>=18 && v<=100;
  setHint('tAge', ok, ok ? "To'g'ri" : "Yosh 18 dan katta bo'lishi kerak");
  return ok;
}
function validatePhone(){
  const v = document.getElementById('tPhone').value.trim();
  if(!v){ setHint('tPhone', false, null); return false; }
  const ok = v.replace(/[^0-9]/g,'').length>=9;
  setHint('tPhone', ok, ok ? "To'g'ri" : "To'liq telefon raqamini kiriting");
  return ok;
}
function validateAbout(){
  const v = document.getElementById('tAbout').value.trim();
  if(!v){ setHint('tAbout', false, null); return false; }
  const ok = v.length>=10;
  setHint('tAbout', ok, ok ? "To'g'ri" : "Kamida 10 belgidan iborat bo'lsin");
  return ok;
}
['tName','tSurname','tAge','tPhone'].forEach(id=>{
  document.getElementById(id).addEventListener('input', ()=>{
    ({tName:validateName, tSurname:validateSurname, tAge:validateAge, tPhone:validatePhone})[id]();
  });
});
document.getElementById('tAbout').addEventListener('input', validateAbout);

const tStep1 = document.getElementById('tStep1');
const tStep2 = document.getElementById('tStep2');
const stepDots = document.querySelectorAll('.tform-step-dot');
document.getElementById('tNextBtn').addEventListener('click', ()=>{
  const ok = [validateName(), validateSurname(), validateAge(), validatePhone()].every(Boolean);
  if(!ok){
    tError.textContent = "Iltimos, barcha maydonlarni to'g'ri to'ldiring.";
    tError.style.display='block';
    return;
  }
  tError.style.display='none';
  tStep1.style.display='none';
  tStep2.style.display='block';
  stepDots[0].classList.add('done');
  stepDots[1].classList.add('active');
});
document.getElementById('tBackBtn').addEventListener('click', ()=>{
  tStep2.style.display='none';
  tStep1.style.display='block';
  stepDots[1].classList.remove('active');
  stepDots[0].classList.remove('done');
});

document.getElementById('tSubmit').addEventListener('click', async ()=>{
  const name = document.getElementById('tName').value.trim();
  const surname = document.getElementById('tSurname').value.trim();
  const age = parseInt(document.getElementById('tAge').value,10);
  const subject = document.getElementById('tSubject').value;
  const phone = document.getElementById('tPhone').value.trim();
  const telegram = document.getElementById('tTelegram').value.trim();
  const photo = document.getElementById('tPhoto').value.trim();
  const about = document.getElementById('tAbout').value.trim();
  tSuccess.style.display='none';
  const aboutOk = validateAbout();
  if(!name || !surname || !age || age < 18 || !aboutOk || !phone){
    tError.textContent = "Barcha maydonlarni to'g'ri to'ldiring.";
    tError.style.display='block';
    return;
  }
  tError.style.display='none';
  const keySuffix = Date.now() + '_' + Math.random().toString(36).slice(2,8);
  const key = 'teacher:' + keySuffix;
  const record = { name, surname, age, subject, phone, telegram, photo, about, date: new Date().toISOString() };
  try{
    await storage.set(key, JSON.stringify(record));
    tSuccess.style.display='block';

    // Sayt egasiga Telegram orqali yangi ustoz haqida avtomatik xabar
    sendTelegramNotify(
      `🆕 <b>Yangi ustoz ro'yxatdan o'tdi</b>\n` +
      `Ism: ${name} ${surname} (${age} yosh)\n` +
      `Fan: ${subject}\n` +
      `Telefon: ${phone}\n` +
      (telegram ? `Telegram: ${telegram}\n` : '') +
      (about ? `Haqida: ${about}` : '')
    );

    // Ustoz o'zi botni ishga tushirib, to'g'ridan-to'g'ri xabarnoma olishi uchun havola
    const linkWrap = document.getElementById('tTelegramLink');
    if(TELEGRAM_BOT_USERNAME && TELEGRAM_BOT_USERNAME !== 'YOUR_BOT_USERNAME'){
      linkWrap.style.display='block';
      linkWrap.innerHTML = `<a class="btn gold" href="https://t.me/${TELEGRAM_BOT_USERNAME}?start=tch_${keySuffix}" target="_blank" rel="noopener">Telegram xabarnomalarini yoqish</a>`;
    }

    document.getElementById('tName').value='';
    document.getElementById('tSurname').value='';
    document.getElementById('tAge').value='';
    document.getElementById('tPhone').value='';
    document.getElementById('tTelegram').value='';
    document.getElementById('tPhoto').value='';
    document.getElementById('tAbout').value='';
    ['tName','tSurname','tAge','tPhone','tAbout'].forEach(id=>setHint(id, false, null));
    tStep2.style.display='none';
    tStep1.style.display='block';
    stepDots[1].classList.remove('active');
    stepDots[0].classList.remove('done');
    loadTeachers();
  }catch(e){
    tError.textContent = "Xatolik yuz berdi, birozdan so'ng qayta urinib ko'ring.";
    tError.style.display='block';
  }
});

let allTeacherRecords = [];
let teacherFilter = 'Barchasi';
let teacherSearchTerm = '';

/* Foydalanuvchi kiritgan matnni (ism, about, telefon va h.k.) HTML sifatida
   ko'rsatishdan oldin xavfsizlashtiradi — aks holda ustoz ro'yxatdan
   o'tish formasi orqali <script> yoki onerror= kabi zararli kod
   kiritib, uni har bir tashrifchining brauzerida ishga tushirishi mumkin edi. */
function escapeHtml(str){
  return String(str==null ? '' : str)
    .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
    .replace(/"/g,'&quot;').replace(/'/g,'&#39;');
}
/* Rasm havolasi uchun: faqat http(s) manzillarga ruxsat beramiz, aks holda
   "javascript:" kabi zararli sxemalar orqali kod ishga tushirilishi mumkin. */
function safePhotoUrl(url){
  if(!url) return '';
  try{
    const u = new URL(url, window.location.href);
    return (u.protocol === 'http:' || u.protocol === 'https:') ? u.href : '';
  }catch(e){ return ''; }
}

function renderTeacherList(){
  const listEl = document.getElementById('teacherList');
  let records = allTeacherRecords;
  if(teacherFilter !== 'Barchasi'){
    records = records.filter(r=>r.subject===teacherFilter);
  }
  if(teacherSearchTerm){
    const q = teacherSearchTerm.toLowerCase();
    records = records.filter(r =>
      (r.name+' '+r.surname).toLowerCase().includes(q) ||
      r.subject.toLowerCase().includes(q) ||
      (r.about||'').toLowerCase().includes(q)
    );
  }
  if(records.length===0){
    listEl.innerHTML = '<p class="empty-note">Mos ustoz topilmadi.</p>';
    return;
  }
  const now = Date.now();
  listEl.innerHTML = '';
  records.forEach(r=>{
    const item = document.createElement('div');
    item.className = 'teacher-item';
    const safePhoto = safePhotoUrl(r.photo);
    const avatarHtml = safePhoto ? `<img src="${escapeHtml(safePhoto)}" alt="${escapeHtml(r.name)}">` : escapeHtml((r.name[0]||'').toUpperCase());
    const isNew = (now - new Date(r.date).getTime()) < 1000*60*60*24*3;
    item.innerHTML = `
      <div class="teacher-avatar">${avatarHtml}</div>
      <div>
        <div class="teacher-item-head">
          <h4>${escapeHtml(r.name)} ${escapeHtml(r.surname)}, ${escapeHtml(r.age)} yosh</h4>
          ${isNew ? '<span class="teacher-new-badge">Yangi</span>' : ''}
        </div>
        <div class="meta">${escapeHtml(r.subject)}</div>
        <div class="about">${escapeHtml(r.about)}</div>
        ${r.phone ? `<div class="phone">📞 ${escapeHtml(r.phone)}</div>` : ''}
        ${r.telegram ? `<div class="phone">✈️ ${escapeHtml(r.telegram)}</div>` : ''}
      </div>
    `;
    item.addEventListener('click', ()=>openProfile(r));
    listEl.appendChild(item);
  });
}

let subjTeacherFilter = 'Barchasi';
function renderSubjTeacherList(){
  const listEl = document.getElementById('subjTeacherList');
  if(!listEl) return;
  let records = allTeacherRecords;
  if(subjTeacherFilter !== 'Barchasi'){
    records = records.filter(r=>r.subject===subjTeacherFilter);
  }
  if(records.length===0){
    listEl.innerHTML = '<p class="empty-note">Bu fan bo\'yicha hozircha ustoz yo\'q. Birinchi bo\'lib ro\'yxatdan o\'ting!</p>';
    return;
  }
  listEl.innerHTML = '';
  records.forEach(r=>{
    const item = document.createElement('div');
    item.className = 'teacher-item';
    const safePhoto = safePhotoUrl(r.photo);
    const avatarHtml = safePhoto ? `<img src="${escapeHtml(safePhoto)}" alt="${escapeHtml(r.name)}">` : escapeHtml((r.name[0]||'').toUpperCase());
    item.innerHTML = `
      <div class="teacher-avatar">${avatarHtml}</div>
      <div>
        <div class="teacher-item-head"><h4>${escapeHtml(r.name)} ${escapeHtml(r.surname)}, ${escapeHtml(r.age)} yosh</h4></div>
        <div class="meta">${escapeHtml(r.subject)}</div>
        <div class="about">${escapeHtml(r.about)}</div>
        ${r.phone ? `<div class="phone">📞 ${escapeHtml(r.phone)}</div>` : ''}
        ${r.telegram ? `<div class="phone">✈️ ${escapeHtml(r.telegram)}</div>` : ''}
      </div>
    `;
    item.addEventListener('click', ()=>openProfile(r));
    listEl.appendChild(item);
  });
}
document.querySelectorAll('#subjTeacherFilterChips .chip').forEach(chip=>{
  chip.addEventListener('click', ()=>{
    document.querySelectorAll('#subjTeacherFilterChips .chip').forEach(c=>c.classList.remove('active'));
    chip.classList.add('active');
    subjTeacherFilter = chip.dataset.filter;
    renderSubjTeacherList();
  });
});

document.getElementById('teacherSearch').addEventListener('input', (e)=>{
  teacherSearchTerm = e.target.value.trim();
  renderTeacherList();
});
document.querySelectorAll('#teacherFilterChips .chip').forEach(chip=>{
  chip.addEventListener('click', ()=>{
    document.querySelectorAll('#teacherFilterChips .chip').forEach(c=>c.classList.remove('active'));
    chip.classList.add('active');
    teacherFilter = chip.dataset.filter;
    renderTeacherList();
  });
});

async function loadTeachers(){
  const listEl = document.getElementById('teacherList');
  const statsEl = document.getElementById('teacherStats');
  const countEl = document.getElementById('statTeacherCount');
  try{
    const listing = await storage.list('teacher:');
    const keys = (listing && listing.keys) || [];
    if(keys.length===0){
      allTeacherRecords = [];
      listEl.innerHTML = '<p class="empty-note">Hozircha ustozlar ro\'yxati bo\'sh. Birinchi bo\'lib ro\'yxatdan o\'ting!</p>';
      statsEl.innerHTML='';
      countEl.textContent = '0';
      renderSubjTeacherList();
      return;
    }
    const records = [];
    for(const k of keys){
      try{
        const res = await storage.get(k);
        if(res && res.value){
          const rec = JSON.parse(res.value);
          rec._key = k.startsWith('teacher:') ? k.slice('teacher:'.length) : k;
          records.push(rec);
        }
      }catch(e){ /* skip missing */ }
    }
    records.sort((a,b)=> new Date(b.date) - new Date(a.date));
    allTeacherRecords = records;
    countEl.textContent = String(records.length);
    const counts = {};
    records.forEach(r=> counts[r.subject] = (counts[r.subject]||0)+1 );
    statsEl.innerHTML = Object.keys(counts).map(s=>`<div class="teacher-stat-badge">${s}: ${counts[s]}</div>`).join('');
    renderTeacherList();
    renderSubjTeacherList();
  }catch(e){
    listEl.innerHTML = '<p class="empty-note">Ro\'yxatni yuklab bo\'lmadi.</p>';
  }
}
loadTeachers();

/* ================= TEACHER PROFILE MODAL ================= */
const profileModal = document.getElementById('profileModal');
function openProfile(r){
  const safePhoto = safePhotoUrl(r.photo);
  document.getElementById('profileAvatar').innerHTML = safePhoto ? `<img src="${escapeHtml(safePhoto)}" alt="${escapeHtml(r.name)}">` : escapeHtml((r.name[0]||'').toUpperCase());
  document.getElementById('profileName').textContent = `${r.name} ${r.surname}`;
  document.getElementById('profileSubject').textContent = r.subject;
  document.getElementById('profileAge').textContent = r.age + ' yosh';
  document.getElementById('profilePhone').textContent = r.phone || '—';
  document.getElementById('profileAbout').textContent = r.about;
  profileModal.classList.add('open');
}
document.getElementById('profileClose').addEventListener('click', ()=>profileModal.classList.remove('open'));
profileModal.addEventListener('click', e=>{ if(e.target===profileModal) profileModal.classList.remove('open'); });

/* ================= STAR RATING WIDGET (persisted, per section) ================= */
async function initRating(containerId, sectionKey){
  const container = document.getElementById(containerId);
  if(!container) return;
  container.innerHTML = `
    <div class="rating-label">Ushbu bo'lim yoqdimi? Baho bering:</div>
    <div class="rating-stars"></div>
    <div class="rating-summary" id="${containerId}-summary">Yuklanmoqda...</div>
  `;
  const starsWrap = container.querySelector('.rating-stars');
  for(let i=1;i<=5;i++){
    const star = document.createElement('span');
    star.className = 'rating-star';
    star.textContent = '★';
    star.dataset.value = i;
    starsWrap.appendChild(star);
  }
  const stars = [...starsWrap.children];
  const summaryEl = document.getElementById(`${containerId}-summary`);

  async function refreshSummary(){
    try{
      const listing = await storage.list(`rating:${sectionKey}:`);
      const keys = (listing && listing.keys) || [];
      if(keys.length===0){
        summaryEl.textContent = "Hali baho berilmagan — birinchi bo'ling!";
        return;
      }
      const values = [];
      for(const k of keys){
        try{
          const res = await storage.get(k);
          if(res && res.value) values.push(parseInt(res.value,10));
        }catch(e){ /* skip */ }
      }
      const avg = values.reduce((a,b)=>a+b,0) / values.length;
      const positive = values.filter(v=>v>=4).length;
      const positivePct = Math.round((positive/values.length)*100);
      summaryEl.textContent = `${avg.toFixed(1)} / 5 (${values.length} ta baho) · ${positivePct}% foydalanuvchi mamnun`;
    }catch(e){
      summaryEl.textContent = "Baholarni yuklab bo'lmadi.";
    }
  }

  stars.forEach(star=>{
    star.addEventListener('mouseenter', ()=>{
      const v = parseInt(star.dataset.value,10);
      stars.forEach(s=>s.classList.toggle('hovered', parseInt(s.dataset.value,10)<=v));
    });
    star.addEventListener('mouseleave', ()=>{
      stars.forEach(s=>s.classList.remove('hovered'));
    });
    star.addEventListener('click', async ()=>{
      const v = parseInt(star.dataset.value,10);
      stars.forEach(s=>s.classList.toggle('filled', parseInt(s.dataset.value,10)<=v));
      const key = `rating:${sectionKey}:` + Date.now() + '_' + Math.random().toString(36).slice(2,8);
      try{
        await storage.set(key, String(v));
        summaryEl.textContent = "Rahmat! Bahoyingiz saqlandi.";
        refreshSummary();
      }catch(e){
        summaryEl.textContent = "Bahoni saqlab bo'lmadi.";
      }
    });
  });

  refreshSummary();
}
initRating('rating-site', 'site');

/* ================= ARTICLE DATE ================= */
const articleDateEl = document.getElementById('articleDate');
if(articleDateEl){
  articleDateEl.textContent = new Date().toLocaleDateString('uz-UZ', { year:'numeric', month:'long', day:'numeric' });
}

/* init default language */
applyLang('uz');

/* ================= FORCE-RELIABLE SECTION NAVIGATION ================= */
function scrollToSection(id){
  const el = document.getElementById(id);
  if(!el) return;
  const top = el.getBoundingClientRect().top + window.pageYOffset - 20;
  window.scrollTo({ top, behavior: 'smooth' });
}
document.querySelectorAll('[data-target]').forEach(el=>{
  el.style.cursor = 'pointer';
  el.addEventListener('click', function(e){
    e.preventDefault();
    scrollToSection(this.getAttribute('data-target'));
    closeSidebar();
  });
});

/* ================= SIDEBAR (mobile toggle) ================= */
const sidebarEl = document.getElementById('sidebar');
const sidebarToggleBtn = document.getElementById('sidebarToggle');
const sidebarCloseBtn = document.getElementById('sidebarClose');
const sidebarOverlayEl = document.getElementById('sidebarOverlay');

function openSidebar(){
  if(!sidebarEl) return;
  sidebarEl.classList.add('open');
  sidebarOverlayEl && sidebarOverlayEl.classList.add('open');
}
function closeSidebar(){
  if(!sidebarEl) return;
  sidebarEl.classList.remove('open');
  sidebarOverlayEl && sidebarOverlayEl.classList.remove('open');
}
sidebarToggleBtn && sidebarToggleBtn.addEventListener('click', openSidebar);
sidebarCloseBtn && sidebarCloseBtn.addEventListener('click', closeSidebar);
sidebarOverlayEl && sidebarOverlayEl.addEventListener('click', closeSidebar);

/* ================= SIDEBAR SCROLLSPY (highlight active link) ================= */
(function(){
  const navLinkEls = Array.from(document.querySelectorAll('.nav-links a[data-target]'));
  if(!navLinkEls.length) return;
  const linkByTarget = {};
  navLinkEls.forEach(a=>{ linkByTarget[a.getAttribute('data-target')] = a; });

  const sections = Object.keys(linkByTarget)
    .map(id=>document.getElementById(id))
    .filter(Boolean);

  const setActive = (id)=>{
    navLinkEls.forEach(a=>a.classList.remove('active'));
    const link = linkByTarget[id];
    if(link) link.classList.add('active');
  };

  if('IntersectionObserver' in window && sections.length){
    let currentId = sections[0].id;
    const observer = new IntersectionObserver((entries)=>{
      entries.forEach(entry=>{
        if(entry.isIntersecting){
          currentId = entry.target.id;
          setActive(currentId);
        }
      });
    }, { rootMargin:'-15% 0px -70% 0px', threshold:0 });
    sections.forEach(sec=>observer.observe(sec));
    setActive(currentId);
  }
})();