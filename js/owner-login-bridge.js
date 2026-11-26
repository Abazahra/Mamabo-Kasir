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
    const result = await cloudSignInOwner(email, password);
    if (!result?.user?.id) throw new Error('Server tidak mengembalikan identitas Owner.');

    let owner = (await all('users')).find(item => item.role === 'owner' && item.active !== false);
    if (!owner) {
      await createUser('Pemilik Toko', 'owner', crypto.randomUUID().replace(/-/g, '').slice(0, 8));
      owner = (await all('users')).find(item => item.role === 'owner' && item.active !== false);
    }
    if (!owner) throw new Error('Profil lokal Owner tidak dapat disiapkan.');

    owner = { ...owner, email: result.user.email || email, cloudOwner: true };
    localStorage.setItem('mambo_owner_cloud_session', JSON.stringify(owner));
    localStorage.setItem('mambo_local_session_user', owner.id);

    const successDetail = { owner, pulled: result.pulled || 0, applied: result.applied || 0 };
    window.__mamboOwnerLoginPending = successDetail;
    window.dispatchEvent(new CustomEvent('mambo-owner-login-success', { detail: successDetail }));
    if (errorBox) errorBox.textContent = 'Login berhasil. Dashboard Owner sedang dibuka…';
    button.textContent = 'Berhasil masuk';
  } catch (error) {
    console.error('Owner login:', error);
    if (errorBox) errorBox.textContent = 'Login Owner gagal: ' + (error?.message || 'Kesalahan tidak diketahui.');
    button.disabled = false;
    button.textContent = 'Masuk sebagai Owner';
    delete button.dataset.busy;
    throw error;
  }
}
