// script.js — Global auth, sidebar, avatar, canvas

const Auth = {
  getSession()  { try { return JSON.parse(localStorage.getItem('nyzz-session')); } catch { return null; } },
  getToken()    { return this.getSession()?.access_token || null; },
  isLoggedIn()  {
    const s = this.getSession();
    if (!s) return false;
    if (s.expires_at && Date.now() / 1000 > s.expires_at) { this.logout(); return false; }
    return true;
  },
  setSession(s) { localStorage.setItem('nyzz-session', JSON.stringify(s)); },
  logout()      { localStorage.removeItem('nyzz-session'); localStorage.removeItem('nyzz-profile'); },
  async getProfile(force = false) {
    if (!this.isLoggedIn()) return null;
    if (!force) {
      try { const c = JSON.parse(localStorage.getItem('nyzz-profile')); if (c?.username) return c; } catch {}
    }
    try {
      const r = await fetch('/api/user', { headers: { Authorization: 'Bearer ' + this.getToken() } });
      if (r.status === 401) { this.logout(); window.location.href = '/login'; return null; }
      if (!r.ok) return null;
      const p = await r.json();
      localStorage.setItem('nyzz-profile', JSON.stringify(p));
      return p;
    } catch { return null; }
  }
};

document.addEventListener('DOMContentLoaded', async function () {

  // ===== SIDEBAR TOGGLE =====
  const menuBtn  = document.getElementById('menu-toggle');
  const sidebar  = document.getElementById('sidebar');
  const overlay  = document.getElementById('overlay');
  if (menuBtn && sidebar && overlay) {
    menuBtn.onclick  = () => { sidebar.classList.add('active');    overlay.classList.add('active'); };
    overlay.onclick  = () => { sidebar.classList.remove('active'); overlay.classList.remove('active'); };
  }

  // ===== SIDEBAR AUTH MENU =====
  const sidebarAuthMenu = document.getElementById('sidebarAuthMenu');
  if (sidebarAuthMenu) {
    if (Auth.isLoggedIn()) {
      sidebarAuthMenu.innerHTML = `
        <li><a href="/profile" class="sidebar-auth-btn login"><i class="fas fa-user-circle"></i> Profil</a></li>
        <li><a href="#" id="sidebarLogout" class="sidebar-auth-btn logout"><i class="fas fa-sign-out-alt"></i> Logout</a></li>`;
      document.getElementById('sidebarLogout')?.addEventListener('click', e => {
        e.preventDefault(); Auth.logout(); window.location.href = '/login';
      });
    } else {
      sidebarAuthMenu.innerHTML = `
        <li><a href="/login"    class="sidebar-auth-btn login"   ><i class="fas fa-sign-in-alt"></i> Login</a></li>
        <li><a href="/register" class="sidebar-auth-btn register"><i class="fas fa-user-plus"></i> Register</a></li>`;
    }
  }

  // ===== PROFILE + AVATAR =====
  if (Auth.isLoggedIn()) {
    const profile = await Auth.getProfile();
    if (profile) {
      const initial = (profile.username || '?').charAt(0).toUpperCase();
      const avUrl   = profile.avatar_url
        ? profile.avatar_url + '?v=' + Date.now()
        : `https://ui-avatars.com/api/?name=${encodeURIComponent(profile.username)}&background=06070f&color=00e5ff&bold=true`;

      // Navbar avatar — kalau ada foto pakai foto, kalau tidak pakai inisial 1 huruf
      document.querySelectorAll('.user-avatar').forEach(wrap => {
        // Update navInitial span kalau ada
        const span = wrap.querySelector('.nav-initial');
        if (span) span.textContent = initial;

        if (profile.avatar_url) {
          const img = new Image();
          img.style.cssText = 'width:100%;height:100%;object-fit:cover;border-radius:50%';
          img.onload  = () => { wrap.innerHTML = ''; wrap.appendChild(img); };
          img.onerror = () => { wrap.innerHTML = `<span class="nav-initial" style="font-family:'Orbitron',sans-serif;font-size:15px;font-weight:900;color:#00e5ff;text-shadow:0 0 10px rgba(0,229,255,0.8);display:flex;align-items:center;justify-content:center;width:100%;height:100%">${initial}</span>`; };
          img.src = profile.avatar_url + '?v=' + Date.now();
        }
        // Tidak ada avatar_url = inisial sudah di-set lewat span di atas
      });

      // Sidebar — JANGAN diubah (hardcode DzzXNzz + image.jpg)
    }
  }

  // ===== CANVAS STARS =====
  const canvas = document.getElementById('canvas');
  if (canvas) {
    const ctx = canvas.getContext('2d');
    let stars  = [];
    const cols = ['#00e5ff','#00ff88','#bf00ff'];
    const resize = () => { canvas.width = window.innerWidth; canvas.height = window.innerHeight; };
    const mkStars = () => {
      stars = [];
      const n = Math.min(80, Math.floor(window.innerWidth / 15));
      for (let i = 0; i < n; i++) stars.push({
        x: Math.random()*canvas.width, y: Math.random()*canvas.height,
        size: Math.random()*1.5+0.3, speed: Math.random()*0.25+0.05,
        color: cols[Math.floor(Math.random()*cols.length)]
      });
    };
    const draw = () => {
      ctx.clearRect(0,0,canvas.width,canvas.height);
      stars.forEach(s => {
        ctx.beginPath(); ctx.arc(s.x,s.y,s.size,0,Math.PI*2);
        ctx.fillStyle=s.color; ctx.globalAlpha=0.5;
        ctx.shadowBlur=6; ctx.shadowColor=s.color;
        ctx.fill(); ctx.globalAlpha=1; ctx.shadowBlur=0;
        s.y+=s.speed; if(s.y>canvas.height){s.y=0;s.x=Math.random()*canvas.width;}
      });
      requestAnimationFrame(draw);
    };
    window.addEventListener('resize', ()=>{resize();mkStars();});
    resize(); mkStars(); draw();
  }

});
