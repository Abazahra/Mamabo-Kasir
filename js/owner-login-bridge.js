import { all } from './db.js?v=operational-normalization-2';
import { createUser } from './auth.js?v=operational-normalization-2';
import { cloudSignInOwner } from './cloud-sync.js?v=owner-login-fix-2';

export async function loginOwner(button) {
  const email = document.querySelector('#ownerCloudEmail')?.value?.trim() || '';
  const password = document.querySelector('#ownerCloudPassword')?.value || '';
  const errorBox = document.querySelector('#ownerCloudLoginError');
  if (!email || !password) throw new Error('Email dan password Owner wajib diisi.');

  button.disabled = true;
  button.textContent = 'Memeriksa akun Owner…';
  if (errorBox) errorBox.textContent = 'Menghubungkan ke server…';

  try {
    await cloudSignInOwner(email, password);
    let owner = (await all('users')).find(user => user.role === 'owner' && user.active !== false);
    if (!owner) {
      const id = crypto.randomUUID();
      await createUser('Owner', 'owner', crypto.randomUUID().replace(/-/g, '').slice(0, 6), id);
      owner = (await all('users')).find(user => user.id === id);
    }
    if (!owner) throw new Error('Login berhasil, tetapi profil Owner lokal belum dapat disiapkan.');
    localStorage.setItem('mambo_local_session_user', owner.id);
    if (errorBox) errorBox.textContent = 'Login berhasil. Membuka toko…';
    window.location.reload();
  } catch (error) {
    console.error('Owner login:', error);
    if (errorBox) errorBox.textContent = 'Login Owner gagal: ' + (error?.message || 'Kesalahan tidak diketahui.');
    button.disabled = false;
    button.textContent = 'Masuk sebagai Owner';
    throw error;
  }
}
