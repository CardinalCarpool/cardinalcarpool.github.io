// Main page: post / edit a ride, filter and browse rides.
(function () {
  const {
    AIRLINES, MATCH_WINDOW_MIN, DEMO, esc, minutesOf, fmtTime, fmtMinutes, isoToMDY, mdyToIso,
    fmtDateLong, nowMinutes, todayIso, isMatch, placeOf, myRides, call,
  } = window.CC;
  const { toast, initDateField, fillLocations } = window.UI;

  const $ = (sel) => document.querySelector(sel);
  const form = $('#rideForm');
  const listEl = $('#list');
  let rides = [];
  let editingId = null;

  // ---------- setup ----------
  if (DEMO) $('#demoNote').hidden = false;
  document.querySelectorAll('[data-date-field]').forEach(initDateField);
  fillLocations($('#location'));
  fillLocations($('#fLocation'), 'Any location');
  $('#airlineList').innerHTML = AIRLINES.map((a) => `<option value="${esc(a)}">`).join('');

  // ---------- form ----------
  function syncDirectionLabels() {
    const dir = form.direction.value;
    $('#timeLabel').textContent = dir === 'to' ? 'Leaving Stanford at' : 'Leaving the airport at';
    $('#locationLabel').textContent = dir === 'to' ? 'Pickup location' : 'Drop-off location';
  }
  form.addEventListener('change', (e) => {
    if (e.target.name === 'direction') syncDirectionLabels();
    if (e.target.name === 'location') $('#otherField').hidden = form.location.value !== 'Other';
  });

  function readForm() {
    const date = mdyToIso(form.date.value.trim());
    const r = {
      direction: form.direction.value,
      airport: form.airport.value,
      date,
      time: form.time.value,
      airline: form.airline.value.trim(),
      location: form.location.value,
      locationOther: form.location.value === 'Other' ? form.locationOther.value.trim() : '',
      firstName: form.firstName.value.trim(),
      email: form.email.value.trim(),
      phone: form.phone.value.trim(),
    };
    if (!date) return [null, 'Please enter the date as MM/DD/YYYY.', form.date];
    if (date < todayIso()) return [null, 'That date is in the past.', form.date];
    if (!r.time) return [null, 'Please enter a time.', form.time];
    if (!r.airline) return [null, 'Please enter your airline.', form.airline];
    if (!r.location) return [null, 'Please choose a location.', form.location];
    if (r.location === 'Other' && !r.locationOther) return [null, 'Please say where for "Other".', form.locationOther];
    if (!r.firstName) return [null, 'Please enter your first name.', form.firstName];
    if (!r.email && !r.phone) return [null, 'Please add an email or phone number.', form.email];
    if (r.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(r.email)) return [null, 'That email looks off.', form.email];
    if (r.phone && !/^[0-9+().\-\s]{7,30}$/.test(r.phone)) return [null, 'That phone number looks off.', form.phone];
    return [r, null, null];
  }

  function fillForm(r) {
    form.direction.value = r.direction;
    form.airport.value = r.airport;
    form.date.value = isoToMDY(r.date);
    form.time.value = r.time;
    form.airline.value = r.airline;
    form.location.value = r.location;
    form.locationOther.value = r.locationOther || '';
    $('#otherField').hidden = r.location !== 'Other';
    form.firstName.value = r.firstName;
    form.email.value = r.email || '';
    form.phone.value = r.phone || '';
    syncDirectionLabels();
  }

  function startEdit(id) {
    const mine = myRides.get(id);
    if (!mine) return;
    const latest = rides.find((r) => r.id === id) || mine.ride;
    editingId = id;
    fillForm(latest);
    $('#postCard').classList.add('editing');
    $('#postTitle').textContent = 'Edit your ride';
    $('#submitBtn').textContent = 'Save changes';
    $('#formError').textContent = '';
    $('#postCard').scrollIntoView({ behavior: 'smooth', block: 'start' });
    form.firstName.focus({ preventScroll: true });
  }

  function stopEdit() {
    editingId = null;
    const keep = { firstName: form.firstName.value, email: form.email.value, phone: form.phone.value };
    form.reset();
    form.firstName.value = keep.firstName;
    form.email.value = keep.email;
    form.phone.value = keep.phone;
    $('#otherField').hidden = true;
    $('#postCard').classList.remove('editing');
    $('#postTitle').textContent = 'Post your ride';
    $('#submitBtn').textContent = 'Add my ride';
    syncDirectionLabels();
  }
  $('#cancelEdit').addEventListener('click', stopEdit);

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const [ride, err, field] = readForm();
    const errEl = $('#formError');
    errEl.textContent = err || '';
    if (err) {
      field.setAttribute('aria-invalid', 'true');
      field.focus();
      return;
    }
    form.querySelectorAll('[aria-invalid="true"]').forEach((el) => el.setAttribute('aria-invalid', 'false'));
    const btn = $('#submitBtn');
    btn.disabled = true;
    try {
      let res;
      if (editingId) {
        const mine = myRides.get(editingId);
        res = await call({ action: 'update', id: editingId, editKey: mine.editKey, ride });
        myRides.save(editingId, mine.editKey, res.ride);
        toast('Ride updated!');
      } else {
        res = await call({ action: 'add', ride });
        myRides.save(res.ride.id, res.editKey, res.ride);
        toast(res.emailed ? `Ride added! We emailed ${res.emailed} matching rider${res.emailed > 1 ? 's' : ''}.` : 'Ride added! You can edit it any time from this browser.');
      }
      const id = res.ride.id;
      stopEdit();
      if (window.Eggs) window.Eggs.onRidePosted(res.ride);
      await load();
      showMatchesFor(id);
      const card = listEl.querySelector(`[data-id="${CSS.escape(id)}"]`);
      if (card) {
        card.classList.add('highlight');
        card.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
    } catch (ex) {
      errEl.textContent = ex.message;
    } finally {
      btn.disabled = false;
    }
  });

  // ---------- filters ----------
  const tMin = $('#tMin');
  const tMax = $('#tMax');
  function syncRange(e) {
    let a = +tMin.value;
    let b = +tMax.value;
    if (a > b) {
      if (e && e.target === tMin) tMin.value = a = b;
      else tMax.value = b = a;
    }
    $('#rangeFill').style.left = `${(a / 1440) * 100}%`;
    $('#rangeFill').style.width = `${((b - a) / 1440) * 100}%`;
    $('#rangeLabel').textContent = `${fmtMinutes(a)} – ${fmtMinutes(b)}`;
    // keep the upper thumb grabbable when both sit at the far right
    tMin.style.zIndex = a > 1300 ? 3 : 1;
  }
  [tMin, tMax].forEach((el) => el.addEventListener('input', (e) => { syncRange(e); render(); }));

  document.querySelectorAll('input[name="fDirection"], input[name="fAirport"], #fLocation')
    .forEach((el) => el.addEventListener('change', render));
  $('#fDate').addEventListener('input', () => {
    const v = $('#fDate').value;
    if (!v || v.length === 10) render();
  });

  function setRadio(name, value) {
    const el = document.querySelector(`input[name="${name}"][value="${value}"]`);
    if (el) el.checked = true;
  }

  function resetFilters() {
    setRadio('fDirection', '');
    setRadio('fAirport', '');
    $('#fDate').value = '';
    $('#fDate').setAttribute('aria-invalid', 'false');
    $('#fLocation').value = '';
    tMin.value = 0;
    tMax.value = 1440;
    syncRange();
    render();
  }
  $('#resetFilters').addEventListener('click', resetFilters);

  function showMatchesFor(id) {
    const r = rides.find((x) => x.id === id);
    if (!r) return;
    setRadio('fDirection', r.direction);
    setRadio('fAirport', r.airport);
    $('#fDate').value = isoToMDY(r.date);
    $('#fLocation').value = '';
    const [h, m] = r.time.split(':').map(Number);
    const mins = h * 60 + m;
    tMin.value = Math.max(0, Math.floor((mins - MATCH_WINDOW_MIN) / 15) * 15);
    tMax.value = Math.min(1440, Math.ceil((mins + MATCH_WINDOW_MIN) / 15) * 15);
    syncRange();
    render();
  }
  $('#matchMine').addEventListener('click', () => {
    const mine = upcomingMine();
    if (mine.length) showMatchesFor(mine[0].id);
  });

  function upcomingMine() {
    const ids = myRides.all();
    return rides.filter((r) => ids[r.id]).sort((a, b) => minutesOf(a) - minutesOf(b));
  }

  function filtered() {
    const dir = document.querySelector('input[name="fDirection"]:checked').value;
    const ap = document.querySelector('input[name="fAirport"]:checked').value;
    const dateText = $('#fDate').value.trim();
    const date = dateText.length === 10 ? mdyToIso(dateText) : null;
    const loc = $('#fLocation').value;
    const a = +tMin.value;
    const b = +tMax.value;
    const cutoff = nowMinutes() - 60;
    return rides
      .filter((r) => minutesOf(r) >= cutoff)
      .filter((r) => !dir || r.direction === dir)
      .filter((r) => !ap || r.airport === ap)
      .filter((r) => !date || r.date === date)
      .filter((r) => !loc || r.location === loc)
      .filter((r) => {
        const [h, m] = r.time.split(':').map(Number);
        const t = h * 60 + m;
        return t >= a && t <= b;
      })
      .sort((x, y) => minutesOf(x) - minutesOf(y) || (x.type === 'shuttle' ? -1 : 1));
  }

  // ---------- rendering ----------
  const ICON = {
    mail: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="2" y="4" width="20" height="16" rx="2"/><path d="m22 7-10 6L2 7"/></svg>',
    text: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>',
  };

  function rideCard(r, mineList) {
    const mine = !!myRides.get(r.id);
    const matchesMine = !mine && mineList.some((m) => isMatch(m, r));
    const where = placeOf(r);
    const route = r.direction === 'to' ? `${esc(where)} → ${esc(r.airport)}` : `${esc(r.airport)} → ${esc(where)}`;
    const badges = [
      r.type === 'shuttle' ? '<span class="badge badge-shuttle">SSS</span>' : '',
      mine ? '<span class="badge badge-mine">Your ride</span>' : '',
      matchesMine ? '<span class="badge badge-match">Within 30 min of your trip</span>' : '',
    ].join('');

    let actions = '';
    if (r.type === 'shuttle') {
      if (r.orderUrl && /^https:\/\//.test(r.orderUrl)) {
        actions = `<a class="btn btn-primary btn-sm" href="${esc(r.orderUrl)}" target="_blank" rel="noopener">Reserve a seat →</a>`;
      }
    } else if (mine) {
      actions = `<button class="btn btn-ghost btn-sm" data-edit="${esc(r.id)}">Edit</button>
        <button class="btn btn-danger btn-sm" data-remove="${esc(r.id)}">Remove</button>`;
    } else {
      const subject = encodeURIComponent(`Cardinal Carpool: share a ride to ${r.direction === 'to' ? r.airport : 'Stanford'}?`);
      if (r.email) actions += `<a class="btn btn-ghost btn-sm" href="mailto:${esc(r.email)}?subject=${subject}" title="${esc(r.email)}">${ICON.mail}Email</a>`;
      if (r.phone) {
        const body = encodeURIComponent(`Hi ${r.firstName}! Saw your ${r.airport} ride on Cardinal Carpool. Want to share?`);
        actions += `<a class="btn btn-ghost btn-sm" href="sms:${esc(r.phone.replace(/[^0-9+]/g, ''))}?&body=${body}" title="${esc(r.phone)}">${ICON.text}Text</a>`;
      }
    }

    const sub = r.type === 'shuttle'
      ? `${route}${r.notes ? ` · ${esc(r.notes)}` : ''}`
      : `${route} · ${esc(r.airline)}`;
    const contact = r.type === 'shuttle' ? '' :
      `<div class="ride-meta">${[r.email, r.phone].filter(Boolean).map(esc).join(' · ')}</div>`;

    return `<article class="ride${r.type === 'shuttle' ? ' shuttle' : ''}${mine ? ' mine' : ''}" data-id="${esc(r.id)}">
      <div class="ride-time">${esc(fmtTime(r.time))}<small>${r.direction === 'to' ? 'To' : 'From'} ${esc(r.airport)}</small></div>
      <div class="ride-main">
        <div class="ride-name">${esc(r.type === 'shuttle' ? '$5 Shuttle' : r.firstName)} ${badges}</div>
        <div class="ride-meta">${sub}</div>
        ${contact}
      </div>
      <div class="ride-actions">${actions}</div>
    </article>`;
  }

  function render() {
    const list = filtered();
    const mineList = upcomingMine();
    $('#matchMine').hidden = mineList.length === 0;
    $('#count').textContent = `${list.length} ride${list.length === 1 ? '' : 's'} found`;

    if (!list.length) {
      listEl.innerHTML = `<div class="empty">
        <svg width="56" height="56" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 17h-2v-5l2-5h12l3 5h1v5h-2"/><circle cx="7.5" cy="17" r="2"/><circle cx="16.5" cy="17" r="2"/><path d="M9.5 17h5"/></svg>
        <p><strong>No rides match these filters yet.</strong><br>Post yours and we'll email you when someone's within 30 minutes.</p>
      </div>`;
      return;
    }
    const groups = {};
    list.forEach((r) => (groups[r.date] = groups[r.date] || []).push(r));
    listEl.innerHTML = Object.keys(groups).map((d) => `
      <div class="day-group">
        <h3>${esc(fmtDateLong(d))} · ${esc(isoToMDY(d))}</h3>
        <div class="rides">${groups[d].map((r) => rideCard(r, mineList)).join('')}</div>
      </div>`).join('');
  }

  listEl.addEventListener('click', async (e) => {
    const edit = e.target.closest('[data-edit]');
    const remove = e.target.closest('[data-remove]');
    if (edit) startEdit(edit.dataset.edit);
    if (remove) {
      const id = remove.dataset.remove;
      if (!confirm('Remove your ride from Cardinal Carpool?')) return;
      remove.disabled = true;
      try {
        await call({ action: 'remove', id, editKey: myRides.get(id).editKey });
        myRides.remove(id);
        if (editingId === id) stopEdit();
        toast('Ride removed.');
        await load();
      } catch (ex) {
        toast(ex.message, true);
        remove.disabled = false;
      }
    }
  });

  // ---------- load ----------
  async function load() {
    try {
      const res = await call({ action: 'list' });
      rides = res.rides || [];
      // forget local edit keys for rides that are gone (removed by an admin or long past)
      const mine = myRides.all();
      Object.keys(mine).forEach((id) => {
        if (!rides.some((r) => r.id === id)) myRides.remove(id);
      });
      render();
    } catch (ex) {
      listEl.innerHTML = `<div class="empty"><p><strong>Couldn't load rides.</strong><br>${esc(ex.message)}</p>
        <button class="btn btn-ghost btn-sm" type="button" id="retry">Try again</button></div>`;
      $('#retry').onclick = load;
    }
  }

  // Pre-fill name/contact from the last ride this browser posted.
  const last = Object.values(myRides.all()).pop();
  if (last && last.ride) {
    form.firstName.value = last.ride.firstName || '';
    form.email.value = last.ride.email || '';
    form.phone.value = last.ride.phone || '';
  }

  syncDirectionLabels();
  syncRange();
  load();
  setInterval(() => { if (!document.hidden && !editingId) load(); }, 60000);
})();
