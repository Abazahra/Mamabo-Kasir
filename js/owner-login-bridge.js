import { all } from './db.js?v=operational-normalization-2';
import { createUser } from './auth.js?v=operational-normalization-2';
import { cloudSignInOwner } from './cloud-sync.js?v=owner-job-invites-1';

// Jalur masuk Owner yang berdiri sendiri dari modul layar kasir.
// Listener capture memastikan tombol tetap memberi respons walau modul fitur lain gagal dimuat.
document.addEventListener('click', async (event) => {
  const button = event.target?.closest?.('#ownerCloudLoginBtn');
  if (!button) return;

  event.preventDefault();
  event.stopImmediatePropagation();

  const emailInput = document.querySelector('#ownerCloudEmail');
  const passwordInput = document.querySelector('#ownerCloudPassword');
  const errorBox = document.querySelector('#ownerCloudLoginError');
  const email = emailInput?.value?.trim() || '';
  const password = passwordInput?.value || '';

  if (!email || !password) {
    if (errorBox) errorBox.textContent = 'Email dan password Owner wajib diisi.';
    return;
  }

  if (button.dataset.busy === '1') return;
  button.dataset.busy = '1';
  button.disabled = true;
  button.textContent = 'Memeriksa akun Owner…';
  if (errorBox) errorBox.textContent = 'Menghubungkan ke toko dan mengambil data yang tersimpan…';

  try {
    const result = await cloudSignInOwner(email, password);
    let owner = (await all('users')).find(user => user.role === 'owner' && user.active !== false);

    if (!owner) {
      const id = crypto.randomUUID();
      await createUser('Owner', 'owner', crypto.randomUUID().replace(/-/g, '').slice(0, 6), id);
      owner = (await all('users')).find(user => user.id === id);
    }

    if (!owner) throw new Error('Login berhasil, tetapi profil lokal Owner belum dapat disiapkan.');

    localStorage.setItem('mambo_local_session_user', owner.id);
    button.textContent = 'Berhasil. Membuka toko…';
    if (errorBox) errorBox.textContent = 'Login berhasil. Membuka kembali aplikasi…';
    window.location.reload();
  } catch (error) {
    console.error('Owner login bridge:', error);
    if (errorBox) errorBox.textContent = 'Login Owner gagal: ' + (error?.message || 'Kesalahan tidak diketahui.');
    button.disabled = false;
    button.textContent = 'Masuk sebagai Owner';
    delete button.dataset.busy;
  }
}, true);
