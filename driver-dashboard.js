(async () => {
  const session = await initAuth('driver');
  if (!session) return;
  document.getElementById('driver-name').textContent = currentProfile?.name || 'Driver';
  document.getElementById('recon-driver-name').value = currentProfile?.name || '';
  document.getElementById('btn-signout')?.addEventListener('click', signOut);
})();

function getWeekRange(d = new Date()) {
  const date = new Date(d);
  const day = date.getDay();
  const start = new Date(date);
  start.setDate(date.getDate() - day);
  const end = new Date(start);
  end.setDate(start.getDate() + 6);
  return { start: start.toISOString().split('T')[0], end: end.toISOString().split('T')[0] };
}

document.getElementById('form-recon')?.addEventListener('submit', async (e) => {
  e.preventDefault();
  const btn = e.target.querySelector('button[type="submit"]');
  btn.disabled = true; btn.textContent = 'Submitting…';
  try {
    const range = getWeekRange();
    const startKm = Number(document.getElementById('recon-start-km').value || 0);
    const endKm = Number(document.getElementById('recon-end-km').value || 0);
    const payload = {
      driver_id: currentProfile.driver_id,
      week_start: range.start,
      week_end: range.end,
      tour_reference: document.getElementById('recon-tour-reference').value.trim(),
      tour_vehicle: document.getElementById('recon-tour-vehicle').value.trim() || null,
      vehicle_reg: document.getElementById('recon-vehicle-reg').value.trim() || null,
      start_km: startKm || null,
      end_km: endKm || null,
      total_distance_km: endKm > startKm ? (endKm - startKm) : 0,
      cost_lines_text: document.getElementById('recon-lines').value.trim() || null,
      trip_budget: document.getElementById('recon-trip-budget').value.trim() || null,
      trip_cost: document.getElementById('recon-trip-cost').value.trim() || null,
      driver_food: document.getElementById('recon-driver-food').value.trim() || null,
      flights_to: document.getElementById('recon-flights-to').value.trim() || null,
      flights_from: document.getElementById('recon-flights-from').value.trim() || null,
      driver_rate: document.getElementById('recon-driver-rate').value.trim() || null,
      accommodation: document.getElementById('recon-accommodation').value.trim() || null,
      total_profit_loss: document.getElementById('recon-profit-loss').value.trim() || null,
      director_sign_off: document.getElementById('recon-director-signoff').value.trim() || null,
      status: 'submitted',
      submitted_at: new Date().toISOString(),
    };

    const { data, error } = await sb.from('recon_sheets').insert(payload).select().single();
    if (error) throw error;
    await postToWorkerWebhook(CONFIG.WORKER_RECON_WEBHOOK_URL, data || payload);
    toast('Recon sheet submitted successfully', 'success');
    e.target.reset();
    document.getElementById('recon-driver-name').value = currentProfile?.name || '';
  } catch (err) {
    toast(err.message || 'Failed to submit recon sheet', 'error');
  } finally {
    btn.disabled = false; btn.textContent = 'Submit Recon Sheet';
  }
});
