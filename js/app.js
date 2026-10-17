// Main page: post / edit a ride, filter and browse rides.
(function () {
  const {
    AIRLINES, DEMO, esc, minutesOf, fmtTime, fmtMinutes, isoToMDY, mdyToIso,
    fmtDateLong, nowMinutes, todayIso, isMutualMatch, overlapOf, fmtOverlap, windowOf, placeOf, myRides, call,
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
  // Direction is a pair of checkboxes; each checked direction shows its own trip section
  // (airport, date, time, airline). Dorm, name, contact and alerts are shared. Posting with
  // both checked creates two rides.
  const DIRS = ['to', 'from'];
  const dirBox = (d) => form.querySelector(`input[name="dir"][value="${d}"]`);
  const checkedDirs = () => DIRS.filter((d) => dirBox(d).checked);

  function syncDirections() {
    DIRS.forEach((d) => { $(`#trip-${d}`).hidden = !dirBox(d).checked; });
    const dirs = checkedDirs();
    $('#locationLabel').textContent = dirs.length === 2 ? 'Your dorm (pickup & drop-off)'
      : dirs[0] === 'from' ? 'Drop-off location' : 'Pickup location';
    if (!editingId) $('#submitBtn').textContent = dirs.length === 2 ? 'Add my 2 rides' : 'Add my ride';
  }
  form.addEventListener('change', (e) => {
    if (e.target.name === 'dir') {
      if (!checkedDirs().length) e.target.checked = true; // keep at least one
      syncDirections();
    }
    if (e.target.name === 'location') $('#otherField').hidden = form.location.value !== 'Other';
  });

  const tripField = (d, key) => form.elements[`${d}_${key}`];

  function readTrip(d) {
    const label = d === 'to' ? 'departure' : 'return';
    const dateEl = tripField(d, 'date');
    const date = mdyToIso(dateEl.value.trim());
    const trip = {
      direction: d,
      airport: form.querySelector(`input[name="${d}_airport"]:checked`).value,
      date,
      time: tripField(d, 'time').value,
      airline: tripField(d, 'airline').value.trim(),
      matchBefore: Number(tripField(d, 'matchBefore').value),
      matchAfter: Number(tripField(d, 'matchAfter').value),
    };
    if (!date) return [null, `Please enter the ${label} date as MM/DD/YYYY.`, dateEl];
    if (date < todayIso()) return [null, `The ${label} date is in the past.`, dateEl];
    if (!trip.time) return [null, `Please enter the ${label} time.`, tripField(d, 'time')];
    if (!trip.airline) return [null, `Please enter the ${label} airline.`, tripField(d, 'airline')];
    return [trip, null, null];
  }

  function readForm() {
    const trips = [];
    for (const d of checkedDirs()) {
      const [trip, err, field] = readTrip(d);
      if (err) return [null, err, field];
      trips.push(trip);
    }
    const shared = {
      location: form.location.value,
      locationOther: form.location.value === 'Other' ? form.locationOther.value.trim() : '',
      firstName: form.firstName.value.trim(),
      email: form.email.value.trim(),
      phone: form.phone.value.trim(),
    };
    if (!shared.location) return [null, 'Please choose a location.', form.location];
    if (shared.location === 'Other' && !shared.locationOther) return [null, 'Please say where for "Other".', form.locationOther];
    if (!shared.firstName) return [null, 'Please enter your first name.', form.firstName];
    if (!shared.email && !shared.phone) return [null, 'Please add an email or phone number.', form.email];
    if (shared.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(shared.email)) return [null, 'That email looks off.', form.email];
    if (shared.phone && !/^[0-9+().\-\s]{7,30}$/.test(shared.phone)) return [null, 'That phone number looks off.', form.phone];
    return [trips.map((t) => Object.assign({}, t, shared)), null, null];
  }

  function fillForm(r) {
    DIRS.forEach((d) => { dirBox(d).checked = d === r.direction; });
    const airport = form.querySelector(`input[name="${r.direction}_airport"][value="${r.airport}"]`);
    if (airport) airport.checked = true;
    tripField(r.direction, 'date').value = isoToMDY(r.date);
    tripField(r.direction, 'time').value = r.time;
    tripField(r.direction, 'airline').value = r.airline;
    const win = windowOf(r);
    tripField(r.direction, 'matchBefore').value = String(win.before);
    tripField(r.direction, 'matchAfter').value = String(win.after);
    form.location.value = r.location;
    form.locationOther.value = r.locationOther || '';
    $('#otherField').hidden = r.location !== 'Other';
    form.firstName.value = r.firstName;
    form.email.value = r.email || '';
    form.phone.value = r.phone || '';
    syncDirections();
  }

  function startEdit(id) {
    const mine = myRides.get(id);
    if (!mine) return;
    const latest = rides.find((r) => r.id === id) || mine.ride;
    editingId = id;
    fillForm(latest);
    // A ride has one direction; to add the other trip, post it separately.
    DIRS.forEach((d) => { dirBox(d).disabled = d !== latest.direction; });
    $('#postCard').classList.add('editing');
    $('#postTitle').textContent = latest.direction === 'to' ? 'Edit your departure' : 'Edit your return';
    $('#submitBtn').textContent = 'Save changes';
    $('#formError').textContent = '';
    $('#postCard').scrollIntoView({ behavior: 'smooth', block: 'start' });
    tripField(latest.direction, 'time').focus({ preventScroll: true });
  }

  function stopEdit() {
    editingId = null;
    const keep = { firstName: form.firstName.value, email: form.email.value, phone: form.phone.value };
    form.reset();
    DIRS.forEach((d) => { dirBox(d).disabled = false; });
    form.firstName.value = keep.firstName;
    form.email.value = keep.email;
    form.phone.value = keep.phone;
    $('#otherField').hidden = true;
    $('#postCard').classList.remove('editing');
    $('#postTitle').textContent = 'Post your ride';
    syncDirections();
  }
  $('#cancelEdit').addEventListener('click', stopEdit);

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const [trips, err, field] = readForm();
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
    const saved = [];
    try {
      if (editingId) {
        const mine = myRides.get(editingId);
        const res = await call({ action: 'update', id: editingId, editKey: mine.editKey, ride: trips[0] });
        myRides.save(editingId, mine.editKey, res.ride);
        saved.push(res.ride);
        toast('Ride updated!');
      } else {
        for (const trip of trips) {
          const res = await call({ action: 'add', ride: trip });
          myRides.save(res.ride.id, res.editKey, res.ride);
          saved.push(res.ride);
        }
        const what = saved.length === 2 ? 'Both rides added!' : 'Ride added!';
        toast(`${what} Check Your matches at the top. You can edit ${saved.length === 2 ? 'them' : 'it'} any time from this browser.`);
      }
      stopEdit();
      if (window.Eggs) window.Eggs.onRidePosted(saved[0]);
      await load();
      const group = $('#matchesList').querySelector(`[data-trip="${CSS.escape(saved[0].id)}"]`);
      if (group) {
        $('#matchesCard').scrollIntoView({ behavior: 'smooth', block: 'start' });
        group.querySelector('.match-trip-head').classList.add('highlight');
      }
    } catch (ex) {
      // If the first of two rides saved but the second failed, say so and keep the form filled.
      errEl.textContent = saved.length && !editingId ? `Your departure was saved, but the return wasn't: ${ex.message}` : ex.message;
      if (saved.length && !editingId) {
        dirBox('to').checked = false;
        syncDirections();
        load();
      }
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

  // `overlap` (Your matches only): the time range that works for both riders.
  function rideCard(r, mineList, inMatches, overlap) {
    const mine = !!myRides.get(r.id);
    const matchesMine = !mine && !inMatches && mineList.some((m) => isMutualMatch(m, r));
    const where = placeOf(r);
    const route = r.direction === 'to' ? `${esc(where)} → ${esc(r.airport)}` : `${esc(r.airport)} → ${esc(where)}`;
    const badges = [
      r.type === 'shuttle' ? '<span class="badge badge-shuttle">SSS</span>' : '',
      mine ? '<span class="badge badge-mine">Your ride</span>' : '',
      matchesMine ? '<span class="badge badge-match">Matches your trip</span>' : '',
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
      // Contact details stay hidden; the buttons open the right app (or a popup with the details).
      const btn = (how, icon, label) =>
        `<button class="btn btn-ghost btn-sm" type="button" data-contact="${how}" data-ride="${esc(r.id)}">${icon}${label}</button>`;
      if (r.email) actions += btn('email', ICON.mail, 'Email');
      if (r.phone) actions += btn('text', ICON.text, 'Text');
    }

    const sub = r.type === 'shuttle'
      ? `${route}${r.notes ? ` · ${esc(r.notes)}` : ''}`
      : `${route} · ${esc(r.airline)}`;

    return `<article class="ride${r.type === 'shuttle' ? ' shuttle' : ''}${mine ? ' mine' : ''}" data-id="${esc(r.id)}">
      <div class="ride-time">${esc(fmtTime(r.time))}<small>${r.direction === 'to' ? 'To' : 'From'} ${esc(r.airport)}</small></div>
      <div class="ride-main">
        <div class="ride-name">${esc(r.type === 'shuttle' ? '$5 Shuttle' : r.firstName)} ${badges}</div>
        <div class="ride-meta">${sub}</div>
        ${overlap ? `<div class="ride-overlap">✓ Works for both: ${esc(fmtOverlap(overlap))}</div>` : ''}
      </div>
      <div class="ride-actions">${actions}</div>
    </article>`;
  }

  function render() {
    const list = filtered();
    const mineList = upcomingMine();
    renderMatches(mineList);
    $('#count').textContent = `${list.length} ride${list.length === 1 ? '' : 's'} found`;

    if (!list.length) {
      listEl.innerHTML = `<div class="empty">
        <svg width="56" height="56" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 17h-2v-5l2-5h12l3 5h1v5h-2"/><circle cx="7.5" cy="17" r="2"/><circle cx="16.5" cy="17" r="2"/><path d="M9.5 17h5"/></svg>
        <p><strong>No rides match these filters yet.</strong><br>Post yours and nearby rides will show up in Your matches.</p>
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

  // ---------- contacting a rider ----------
  function contactRider(r, how) {
    const where = r.direction === 'to' ? r.airport : 'Stanford';
    const message = `Hi ${r.firstName}! Saw your ${r.airport} ride on ${fmtDateLong(r.date)} at ${fmtTime(r.time)} on Cardinal Carpool. Want to share a ride?`;
    const digits = (r.phone || '').replace(/[^0-9+]/g, '');
    const href = how === 'email'
      ? `mailto:${r.email}?subject=${encodeURIComponent(`Cardinal Carpool: share a ride to ${where}?`)}&body=${encodeURIComponent(message)}`
      : `sms:${digits}?&body=${encodeURIComponent(message)}`;
    const value = how === 'email' ? r.email : r.phone;
    window.UI.openWithFallback(href, { name: r.firstName, how, value, message });
  }

  // ---------- your matches ----------
  const dur = (m) => (m === 0 ? '0 min' : m >= 60 ? `${m / 60} hr` : `${m} min`);

  function renderMatches(mineList) {
    $('#matchesCard').hidden = mineList.length === 0;
    if (!mineList.length) return;
    const cutoff = nowMinutes() - 60;
    let total = 0;
    $('#matchesList').innerHTML = mineList.map((m) => {
      const win = windowOf(m);
      const flex = `${dur(win.before)} earlier to ${dur(win.after)} later`;
      const matches = rides
        .filter((r) => minutesOf(r) >= cutoff && isMutualMatch(m, r))
        .sort((x, y) => minutesOf(x) - minutesOf(y));
      total += matches.length;
      const where = placeOf(m);
      const route = m.direction === 'to' ? `${where} → ${m.airport}` : `${m.airport} → ${where}`;
      return `<div class="match-trip" data-trip="${esc(m.id)}">
        <div class="match-trip-head">
          <div>
            <strong>${m.direction === 'to' ? '✈️ Your departure' : '🌲 Your return'} · ${esc(fmtDateLong(m.date))} · ${esc(fmtTime(m.time))}</strong>
            <div class="count">${esc(route)} · ${matches.length} match${matches.length === 1 ? '' : 'es'} · you're flexible ${flex}</div>
          </div>
          <button class="btn btn-ghost btn-sm" type="button" data-edit="${esc(m.id)}">Edit</button>
        </div>
        ${matches.length
          ? `<div class="rides">${matches.map((r) => rideCard(r, mineList, true, overlapOf(m, r))).join('')}</div>`
          : '<p class="match-none">No matches yet. Check back soon, or share the site so more people post.</p>'}
      </div>`;
    }).join('');
    $('#matchesSub').textContent = total
      ? `${total} ride${total === 1 ? '' : 's'} near the trips you posted. Reach out to split the cost!`
      : 'Nobody near your trips yet. New rides show up here as people post.';
    $('#matchesSub').title = 'Only riders whose flexible times overlap yours are shown.';
  }

  async function onListClick(e) {
    const contactBtn = e.target.closest('[data-contact]');
    if (contactBtn) {
      const r = rides.find((x) => x.id === contactBtn.dataset.ride);
      if (r) contactRider(r, contactBtn.dataset.contact);
      return;
    }
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
  }
  listEl.addEventListener('click', onListClick);
  $('#matchesList').addEventListener('click', onListClick);

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

  syncDirections();
  syncRange();
  load();
  setInterval(() => { if (!document.hidden && !editingId) load(); }, 60000);
})();
