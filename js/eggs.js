// Easter eggs. Shh. 🌲
(function () {
  const toast = (m) => window.UI && window.UI.toast(m);
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  function rain(emojis, count) {
    if (reduced) return;
    for (let i = 0; i < count; i++) {
      const el = document.createElement('div');
      el.className = 'falling';
      el.textContent = emojis[i % emojis.length];
      el.style.left = Math.random() * 100 + 'vw';
      el.style.fontSize = 18 + Math.random() * 26 + 'px';
      el.style.animationDuration = 2 + Math.random() * 2.5 + 's';
      el.style.animationDelay = Math.random() * 1.2 + 's';
      document.body.appendChild(el);
      setTimeout(() => el.remove(), 6000);
    }
  }

  function driveBy() {
    if (reduced) return;
    const car = document.createElement('div');
    car.className = 'drive-by';
    // the car emoji faces left; mirror it so it drives to the right
    car.innerHTML = '<span style="display:inline-block;transform:scaleX(-1)">🚗</span>';
    document.body.appendChild(car);
    setTimeout(() => car.remove(), 2600);
  }

  // 1. Konami code → it's raining Trees
  const KONAMI = ['ArrowUp', 'ArrowUp', 'ArrowDown', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'ArrowLeft', 'ArrowRight', 'b', 'a'];
  let kIdx = 0;
  // 2/3. Typed words anywhere on the page
  let typed = '';
  let typedRaw = ' '; // keeps word breaks, for whole-word eggs
  const RICK_MSG = 'Thanks for never giving up on our service <3';
  const WORDS = {
    gobears: () => {
      document.querySelector('main').classList.add('shake');
      setTimeout(() => document.querySelector('main').classList.remove('shake'), 600);
      toast('🐻 Wrong side of the Bay. Go Card!');
    },
    beatcal: () => { rain(['🌲', '❤️', '🏈'], 40); toast('BEAT CAL! 🏈'); },
    fearthetree: () => { rain(['🌲'], 50); toast('🌲 Fear the Tree.'); },
    sss: () => toast('🚌 SSS: making airport runs less lonely since forever.'),
  };

  document.addEventListener('keydown', (e) => {
    const key = e.key.length === 1 ? e.key.toLowerCase() : e.key;
    kIdx = key === KONAMI[kIdx] ? kIdx + 1 : key === KONAMI[0] ? 1 : 0;
    if (kIdx === KONAMI.length) {
      kIdx = 0;
      rain(['🌲'], 60);
      toast('🌲 Konami unlocked: Fear the Tree!');
    }
    if (e.key.length === 1) {
      typed = (typed + e.key.toLowerCase()).replace(/[^a-z]/g, '').slice(-16);
      Object.keys(WORDS).forEach((w) => {
        if (typed.endsWith(w)) { typed = ''; WORDS[w](); }
      });
      // "rick" as its own word (not "Patrick" or "brick")
      typedRaw = (typedRaw + (/[a-z]/i.test(e.key) ? e.key.toLowerCase() : ' ')).slice(-16);
      if (/(^|[^a-z])rick$/.test(typedRaw)) { typedRaw = ' '; toast(RICK_MSG); }
    } else if (e.key === 'Enter' || e.key === 'Tab') {
      typedRaw += ' ';
    }
  });

  // 4. Tap the logo 5 times → beep beep
  const logo = document.getElementById('logo');
  if (logo) {
    let taps = 0;
    let timer;
    logo.addEventListener('click', () => {
      taps++;
      clearTimeout(timer);
      timer = setTimeout(() => (taps = 0), 1200);
      if (taps === 5) {
        taps = 0;
        driveBy();
        toast('Beep beep! 🚗 Next stop: SFO.');
      }
    });
  }

  // 5. Double-click the footer credit
  const footer = document.querySelector('.site-footer');
  if (footer) {
    footer.addEventListener('dblclick', (e) => {
      if (e.target.closest('a, button')) return;
      rain(['🎉', '✈️', '🚗', '🌲'], 30);
      toast('👋 You found Samuel. Thanks for carpooling!');
    });
  }

  // 6. Reactions when a ride is posted
  window.Eggs = {
    onRidePosted(ride) {
      const name = (ride.firstName || '').trim().toLowerCase();
      const hour = parseInt((ride.time || '12').split(':')[0], 10);
      setTimeout(() => {
        if (name === 'rick' || name === 'richard') toast(RICK_MSG);
        else if (name === 'leland') toast('🎩 Welcome back, Mr. Stanford.');
        else if (name === 'jane') toast('🎩 Welcome back, Mrs. Stanford.');
        else if (name === 'tree') { rain(['🌲'], 30); toast('🌲 The Tree needs a ride too.'); }
        else if (hour < 5) toast('🦉 Red-eye warrior! Hope you find a buddy.');
        else if (ride.airport === 'OAK') toast('🛫 OAK! A bold, underrated choice.');
      }, 1200);
    },
  };

  // 7. For the curious
  console.log(
    '%cCardinal Carpool 🌲%c\nMade by Samuel for SSS. Try the Konami code, tap the logo 5×, or type "beatcal".',
    'color:#8c1515;font-size:20px;font-weight:bold;font-family:Georgia,serif', 'color:#53565a'
  );
})();
