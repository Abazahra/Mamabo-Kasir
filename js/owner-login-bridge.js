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
    if (!result?.user?.id) throw new Error('Server menerima login, tetapi identitas Owner tidak diterima aplikasi.');
    const owner = {
      id: result.user.id,
      name: 'Pemilik Toko',
      role: 'owner',
      active: true,
      email: result.user.email || email,
      cloudOwner: true
    };
    localStorage.setItem('mambo_owner_cloud_session', JSON.stringify(owner));
    localStorage.setItem('mambo_local_session_user', owner.id);
    if (errorBox) errorBox.textContent = 'Login berhasil. Membuka dashboard Owner…';
    window.location.reload();
  } catch (error) {
    console.error('Owner login:', error);
    if (errorBox) errorBox.textContent = 'Login Owner gagal: ' + (error?.message || 'Kesalahan tidak diketahui.');
    button.disabled = false;
    button.textContent = 'Masuk sebagai Owner';
    delete button.dataset.busy;
    throw error;
  }
}
