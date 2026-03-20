// script.js — Global: auth helper, sidebar, coins, avatar, canvas stars

const Auth = {
  getSession() { try { return JSON.parse(localStorage.getItem('nyzz-session')); } catch { return null; } },
  getToken()   { return this.getSession()?.access_token || null; },
  getUser()    { return this.getSession()?.user || null; },
  isLoggedIn() {
    const s = this.getSession();
    if (!s) return false;
    if (s.expires_at && Date.now() / 1000 > s.expires_at) { this.logout(); return false; }
    return true;
  },
  setSession(session) { localStorage.setItem('nyzz-session', JSON.stringify(session)); },
  logout() {
    localStorage.removeItem('nyzz-session');
    localStorage.removeItem('nyzz-profile');
  },
  async getProfile(forceRefresh = false) {
    if (!this.isLoggedIn()) return null;
    if (!forceRefresh) {
      try {
        const c = JSON.parse(localStorage.getItem('nyzz-profile'));
        if (c && 'avatar_url' in c) return c;
        localStorage.removeItem('nyzz-profile');
      } catch {}
    }
    try {
      const res = await fetch('/api/user', { headers: { Authorization: 'Bearer ' + this.getToken() } });
      if (res.status === 401) { this.logout(); window.location.href = '/login'; return null; }
      if (!res.ok) return null;
      const p = await res.json();
      localStorage.setItem('nyzz-profile', JSON.stringify(p));
      return p;
    } catch { return null; }
  }
};

document.addEventListener('DOMContentLoaded', async function () {

  // ===== SIDEBAR TOGGLE =====
  const menuBtn = document.getElementById('menu-toggle');
  const sidebar  = document.getElementById('sidebar');
  const overlay  = document.getElementById('overlay');
  if (menuBtn && sidebar && overlay) {
    menuBtn.onclick = () => { sidebar.classList.add('active'); overlay.classList.add('active'); };
    overlay.onclick = () => { sidebar.classList.remove('active'); overlay.classList.remove('active'); };
  }

  // ===== SIDEBAR SYSTEM MENU =====
  const systemMenu = document.getElementById('system-menu');
  if (systemMenu) {
    if (Auth.isLoggedIn()) {
      systemMenu.innerHTML = `
        <li class="system-item"><a href="/profile"><i class="fas fa-user-circle"></i> Akun</a></li>
        <li class="system-item"><a href="#" id="sidebarLogout"><i class="fas fa-sign-out-alt"></i> Logout</a></li>`;
      document.getElementById('sidebarLogout')?.addEventListener('click', e => {
        e.preventDefault(); Auth.logout(); window.location.href = '/login';
      });
    } else {
      systemMenu.innerHTML = `
        <li class="system-item"><a href="/login"><i class="fas fa-sign-in-alt"></i> Login</a></li>
        <li class="system-item"><a href="/register"><i class="fas fa-user-plus"></i> Register</a></li>`;
    }
  }

  // ===== LOCK SIDEBAR NAME =====
  function lockSidebarName() {
    document.querySelectorAll('.user-name-text').forEach(el => {
      if (el.textContent !== 'DzzXNzz') el.textContent = 'DzzXNzz';
    });
  }
  lockSidebarName();
  const nameObserver = new MutationObserver(lockSidebarName);
  document.querySelectorAll('.user-name-text').forEach(el => {
    nameObserver.observe(el, { childList: true, characterData: true, subtree: true });
  });

  // ===== LOAD PROFILE (coins + avatar) =====
  const coinCountEl = document.getElementById('coinCount');

  if (Auth.isLoggedIn()) {
    const profile = await Auth.getProfile();
    if (profile) {
      // Update coins
      if (coinCountEl) coinCountEl.textContent = Number(profile.coins).toLocaleString('id-ID');

      // Update avatar navbar — foto kalau ada, inisial kalau tidak
      const initial = (profile.username || '?').charAt(0).toUpperCase();

      function setNavbarAvatar(wrap, url, fallbackInitial) {
        if (url) {
          const img = document.createElement('img');
          img.style.cssText = 'width:100%;height:100%;object-fit:cover;border-radius:50%';
          img.alt = fallbackInitial;
          img.onload = () => {
            wrap.innerHTML = '';
            wrap.appendChild(img);
          };
          img.onerror = () => {
            wrap.innerHTML = `<span class="nav-initial" style="font-family:'Orbitron',sans-serif;font-size:15px;font-weight:900;color:#00e5ff;text-shadow:0 0 10px rgba(0,229,255,0.8);width:100%;height:100%;display:flex;align-items:center;justify-content:center;user-select:none">${fallbackInitial}</span>`;
          };
          // Paksa bypass cache
          img.src = url.split('?')[0] + '?v=' + Date.now();
        } else {
          wrap.innerHTML = `<span class="nav-initial" style="font-family:'Orbitron',sans-serif;font-size:15px;font-weight:900;color:#00e5ff;text-shadow:0 0 10px rgba(0,229,255,0.8);width:100%;height:100%;display:flex;align-items:center;justify-content:center;user-select:none">${fallbackInitial}</span>`;
        }
      }

      document.querySelectorAll('.user-avatar').forEach(wrap => {
        setNavbarAvatar(wrap, profile.avatar_url, initial);
      });
    }
  } else {
    if (coinCountEl) coinCountEl.textContent = '0';
  }

  // ===== LOADING SCREEN =====
  const loadingScreen = document.getElementById('loading-screen');
  if (loadingScreen) {
    const bar  = document.querySelector('.progress-bar');
    const text = document.getElementById('progress-text');
    if (sessionStorage.getItem('homeLoaded')) {
      loadingScreen.style.opacity = '0';
      setTimeout(() => loadingScreen.style.display = 'none', 600);
    } else {
      let progress = 0, stepIndex = 0;
      const steps  = [20, 40, 60, 80, 100];
      function nextStep() {
        if (stepIndex >= steps.length) {
          sessionStorage.setItem('homeLoaded', 'true');
          setTimeout(() => { loadingScreen.style.opacity = '0'; setTimeout(() => loadingScreen.style.display = 'none', 600); }, 300);
          return;
        }
        const target = steps[stepIndex];
        const iv = setInterval(() => {
          if (progress < target) {
            progress++;
            if (bar)  bar.style.width    = progress + '%';
            if (text) text.textContent   = progress + '%';
          } else {
            clearInterval(iv); stepIndex++;
            if (stepIndex < steps.length) setTimeout(nextStep, 400); else nextStep();
          }
        }, 18);
      }
      nextStep();
    }
  }

  // ===== CANVAS STARS =====
  const canvas = document.getElementById('canvas');
  if (canvas) {
    const ctx    = canvas.getContext('2d');
    let stars    = [];
    const colors = ['#00e5ff','#00ff88','#bf00ff'];
    function resize() { canvas.width = window.innerWidth; canvas.height = window.innerHeight; }
    function createStars() {
      stars = [];
      const n = Math.min(80, Math.floor(window.innerWidth / 15));
      for (let i = 0; i < n; i++) stars.push({
        x: Math.random() * canvas.width, y: Math.random() * canvas.height,
        size: Math.random() * 1.5 + 0.3, speed: Math.random() * 0.25 + 0.05,
        color: colors[Math.floor(Math.random() * colors.length)]
      });
    }
    function draw() {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      stars.forEach(s => {
        ctx.beginPath(); ctx.arc(s.x, s.y, s.size, 0, Math.PI * 2);
        ctx.fillStyle = s.color; ctx.globalAlpha = 0.5;
        ctx.shadowBlur = 6; ctx.shadowColor = s.color;
        ctx.fill(); ctx.globalAlpha = 1; ctx.shadowBlur = 0;
        s.y += s.speed;
        if (s.y > canvas.height) { s.y = 0; s.x = Math.random() * canvas.width; }
      });
      requestAnimationFrame(draw);
    }
    window.addEventListener('resize', () => { resize(); createStars(); });
    resize(); createStars(); draw();
  }

});
