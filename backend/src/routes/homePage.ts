import type { Response } from 'express';

export function sendHomePage(
  res: Response,
  opts: {
    siteOrigin: string;
    contactEmail: string;
    appStoreUrl: string;
    appStoreItmsUrl: string;
  }
): void {
  const { siteOrigin, contactEmail, appStoreUrl, appStoreItmsUrl } = opts;

  res
    .set({
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'public, max-age=3600',
      'Content-Security-Policy':
        "default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; img-src 'self' data:; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
      'Referrer-Policy': 'no-referrer',
      'X-Content-Type-Options': 'nosniff',
    })
    .send(`<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
  <title>Ball Knowledge · Football games, every day</title>
  <meta name="description" content="Eight new football quiz games every day. Earn XP, build your streak, pick your club and climb the leagues.">
  <meta property="og:title" content="Ball Knowledge">
  <meta property="og:description" content="Think you know football? Eight new quiz games every day.">
  <meta property="og:type" content="website">
  <meta property="og:url" content="${siteOrigin}/">
  <meta property="og:image" content="${siteOrigin}/brand/ball.jpg">
  <meta name="twitter:card" content="summary_large_image">
  <meta name="twitter:image" content="${siteOrigin}/brand/ball.jpg">
  <meta name="theme-color" content="#0A0A0A">
  <meta name="apple-itunes-app" content="app-id=6791646115">
  <link rel="icon" href="/brand/ball.jpg">
  <style>
    :root { color-scheme: dark; }
    * { box-sizing: border-box; }
    html, body { margin: 0; background: #0A0A0A; }
    body {
      color: #fff;
      font-family: ui-rounded, "SF Pro Rounded", -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      -webkit-font-smoothing: antialiased;
      overflow-x: hidden;
    }
    a { color: inherit; text-decoration: none; }
    .wrap { position: relative; isolation: isolate; }
    .stadium {
      position: absolute; inset: 0 auto auto 0; width: 100%; height: 88vh;
      background: url("/brand/stadium.jpg") top center / cover no-repeat;
      filter: grayscale(0.5) blur(4px);
      opacity: 0.045;
      pointer-events: none;
      z-index: 0;
    }
    .glow {
      position: absolute; inset: 0;
      pointer-events: none; z-index: 0;
      background:
        radial-gradient(ellipse 80% 46% at 50% -8%, rgba(0,255,102,0.16), transparent 55%),
        radial-gradient(circle 150px at 12% 2%, rgba(0,255,102,0.11), transparent 70%),
        radial-gradient(circle 120px at 88% 8%, rgba(0,170,85,0.08), transparent 70%),
        radial-gradient(ellipse 70% 40% at 15% 70%, rgba(12,34,24,0.9), transparent 55%);
    }
    .fade {
      position: absolute; inset: 34vh 0 auto; height: 42vh;
      background: linear-gradient(to bottom, transparent, rgba(10,10,10,0.65) 43%, #0A0A0A);
      pointer-events: none; z-index: 0;
    }
    .inner {
      position: relative; z-index: 1;
      width: min(860px, calc(100% - 40px));
      margin: 0 auto;
      padding: max(18px, env(safe-area-inset-top)) 0 72px;
    }
    nav {
      display: flex; justify-content: space-between; align-items: center;
      margin-bottom: 28px;
    }
    .brand {
      font-size: 13px; font-weight: 800; letter-spacing: 0.14em;
      text-transform: uppercase; color: #00FF66;
    }
    nav .links { display: flex; gap: 18px; }
    nav .links a { color: #AAAAAA; font-size: 13px; font-weight: 650; }
    nav .links a:hover { color: #00FF66; }

    .hero {
      display: flex; flex-direction: column; align-items: center;
      text-align: center; padding: 12px 0 8px;
    }
    .mark {
      position: relative; width: 270px; height: 270px;
      display: grid; place-items: center;
      animation: float 3.6s ease-in-out infinite;
    }
    .ring {
      position: absolute; inset: 0;
      border-radius: 50%;
      border: 1px solid rgba(0,255,102,0.12);
    }
    .orb {
      position: absolute; width: 230px; height: 230px; border-radius: 50%;
      background: rgba(0,255,102,0.09); filter: blur(36px);
    }
    .tile-hero {
      position: relative; width: 190px; height: 190px; border-radius: 40px;
      overflow: hidden; background: #141414;
      border: 1px solid rgba(255,255,255,0.1);
      box-shadow: 0 18px 40px rgba(0,0,0,0.45), 0 14px 36px rgba(0,255,102,0.22);
    }
    .tile-hero img { width: 100%; height: 100%; object-fit: cover; display: block; }
    .chip {
      position: absolute; display: flex; align-items: center; gap: 6px;
      padding: 9px 11px; border-radius: 999px;
      background: rgba(26,26,26,0.72);
      border: 1px solid rgba(255,255,255,0.1);
      backdrop-filter: blur(10px);
      font-size: 10px; font-weight: 700; letter-spacing: 0.8px;
    }
    .chip.xp { left: -8px; bottom: 28px; transform: rotate(-7deg); color: #fff; animation: float 3.2s ease-in-out infinite; }
    .chip.streak { right: -14px; top: 18px; transform: rotate(7deg); animation: float 3.7s 0.4s ease-in-out infinite; }
    .chip .dot { width: 8px; height: 8px; border-radius: 50%; }
    .chip.xp .dot { background: #00FF66; box-shadow: 0 0 10px #00FF66; }
    .chip.streak .dot { background: #FF6B00; box-shadow: 0 0 10px #FF6B00; }

    h1 {
      margin: 28px 0 0;
      font-size: clamp(34px, 8vw, 52px);
      font-weight: 800; letter-spacing: -0.045em; line-height: 1.05;
    }
    .sub {
      margin: 12px 0 0; max-width: 34ch;
      color: #AAAAAA; font-size: 16px; font-weight: 500; line-height: 1.45;
    }
    .cta {
      display: inline-flex; align-items: center; justify-content: center; gap: 10px;
      margin-top: 28px; height: 56px; padding: 0 28px; border: 0; border-radius: 18px;
      background: #00FF66; color: #0A0A0A;
      font: inherit; font-size: 15px; font-weight: 800; letter-spacing: 0.04em;
      text-transform: uppercase; cursor: pointer;
      box-shadow: 0 8px 28px rgba(0,255,102,0.22);
      transition: transform 0.12s ease, opacity 0.12s ease;
    }
    .cta:active { transform: scale(0.975); opacity: 0.88; }
    .cta svg { width: 16px; height: 16px; }
    .fine { margin: 12px 0 0; color: #666; font-size: 12px; font-weight: 600; }

    .block { margin-top: 72px; }
    .copy { max-width: 520px; }
    .copy h2 {
      margin: 0; font-size: clamp(26px, 5vw, 34px); font-weight: 800;
      letter-spacing: -0.03em; line-height: 1.1;
    }
    .copy p { margin: 12px 0 0; color: #AAAAAA; font-size: 16px; font-weight: 500; line-height: 1.45; }

    .daily {
      position: relative; overflow: hidden;
      margin-top: 22px; padding: 18px;
      border-radius: 20px; background: #141414;
      box-shadow: 0 12px 28px rgba(0,0,0,0.28);
      animation: float 3.8s 0.2s ease-in-out infinite;
    }
    .daily-art {
      position: absolute; right: -8%; top: -28%;
      width: 62%; height: 140%;
      background: url("/brand/hero.jpg") center / cover no-repeat;
      mask-image: linear-gradient(to right, transparent 0, transparent 30%, rgba(255,255,255,0.25) 42%, #fff 70%);
      -webkit-mask-image: linear-gradient(to right, transparent 0, transparent 30%, rgba(255,255,255,0.25) 42%, #fff 70%);
      pointer-events: none;
    }
    .daily-top, .daily-foot { position: relative; display: flex; align-items: center; gap: 12px; }
    .daily-count { display: flex; align-items: baseline; gap: 6px; }
    .daily-count strong {
      font-size: 42px; font-weight: 900; letter-spacing: -0.04em; color: #00FF66;
    }
    .daily-count span { color: #666; font-size: 17px; font-weight: 700; }
    .label { font-size: 10px; font-weight: 700; letter-spacing: 1.2px; color: #666; }
    .xp-block { margin-left: auto; text-align: left; }
    .xp-block b {
      display: block; font-size: 24px; font-weight: 800; color: #00FF66; letter-spacing: -0.03em;
    }
    .bars { position: relative; display: flex; gap: 5px; margin: 16px 0 18px; }
    .bars i {
      flex: 1; height: 7px; border-radius: 99px; background: rgba(255,255,255,0.22);
      transform: scaleX(0.35); transform-origin: left;
      animation: fillBar 0.58s cubic-bezier(0.22, 1, 0.36, 1) forwards;
    }
    .bars i.on {
      background: linear-gradient(90deg, #00FF66, #00CC52);
      box-shadow: 0 0 8px rgba(0,255,102,0.55);
    }
    .bars i:nth-child(1) { animation-delay: 0.05s; }
    .bars i:nth-child(2) { animation-delay: 0.23s; }
    .bars i:nth-child(3) { animation-delay: 0.41s; }
    .bars i:nth-child(4) { animation-delay: 0.59s; }
    .bars i:nth-child(5) { animation-delay: 0.77s; }
    .bars i:nth-child(6) { animation-delay: 0.95s; }
    .bars i:nth-child(7) { animation-delay: 1.13s; }
    .streak-n { font-size: 25px; font-weight: 800; letter-spacing: -0.03em; }
    .keep { margin-left: auto; color: #FF6B00; font-size: 10px; font-weight: 700; letter-spacing: 1px; }

    .fan-wrap { margin-top: 28px; height: 230px; display: grid; place-items: center; }
    .fan { position: relative; width: min(100%, 520px); height: 180px; }
    .fan .tile {
      position: absolute; left: 50%; top: 16px;
      width: 104px; height: 138px; margin-left: -52px;
      border-radius: 18px; overflow: hidden; background: #181818;
      border: 1px solid rgba(255,255,255,0.12);
      box-shadow: 0 10px 18px rgba(0,0,0,0.5);
      transition: transform 0.72s cubic-bezier(0.22, 1, 0.36, 1), opacity 0.4s ease;
    }
    .fan .tile img { width: 100%; height: 100%; object-fit: cover; display: block; }

    .games {
      display: grid; grid-template-columns: 1fr 1fr; gap: 10px 18px;
      margin-top: 28px;
    }
    .game {
      display: flex; align-items: center; gap: 12px;
      padding: 10px 4px;
    }
    .game img {
      width: 56px; height: 56px; object-fit: cover; object-position: top;
      border-radius: 14px; background: #181818;
    }
    .game b { display: block; font-size: 15px; font-weight: 650; }
    .game span { display: block; margin-top: 2px; color: #AAAAAA; font-size: 13px; font-weight: 500; }

    .league { margin-top: 22px; }
    .league-head {
      display: flex; justify-content: space-between; align-items: center;
      padding: 0 4px 10px;
      font-size: 10px; font-weight: 700; letter-spacing: 1.2px; color: #666;
    }
    .league-head em { color: #00FF66; font-style: normal; }
    .row {
      display: flex; align-items: center; gap: 10px;
      margin-bottom: 8px; padding: 8px 12px;
      border-radius: 14px; background: #1A1A1A;
    }
    .row.you { background: #242424; box-shadow: inset 0 0 0 1.5px rgba(0,255,102,0.6); }
    .rank { width: 24px; font-size: 14px; font-weight: 900; color: #00FF66; }
    .rank.dim { color: #666; }
    .ava {
      width: 34px; height: 34px; border-radius: 50%; object-fit: cover; background: #242424;
    }
    .ava.you {
      display: grid; place-items: center;
      background: rgba(0,255,102,0.16); color: #00FF66;
      font-size: 9px; font-weight: 800;
    }
    .row b { flex: 1; font-size: 14px; font-weight: 700; }
    .row .pts { color: #fff; font-size: 13px; font-weight: 700; font-variant-numeric: tabular-nums; }
    .row .pts::before { content: "⚡ "; color: #00FF66; }

    .bottom {
      margin-top: 72px; padding: 36px 28px; border-radius: 22px;
      background: #121212; text-align: center;
    }
    .bottom h2 { margin: 0; font-size: clamp(28px, 6vw, 40px); letter-spacing: -0.04em; }
    .bottom p { margin: 10px auto 0; max-width: 36ch; color: #AAAAAA; }
    footer {
      margin-top: 48px; padding-top: 20px;
      border-top: 1px solid #242424;
      color: #737373; font-size: 13px;
      display: flex; justify-content: space-between; gap: 16px; flex-wrap: wrap;
    }
    footer a { color: #00FF66; }

    @keyframes float {
      0%, 100% { translate: 0 0; }
      50% { translate: 0 -6px; }
    }
    @keyframes fillBar { to { transform: scaleX(1); } }
    @media (prefers-reduced-motion: reduce) {
      .mark, .chip, .daily, .fan .tile { animation: none; transition: none; }
      .bars i { animation: none; transform: none; }
    }
    @media (max-width: 720px) {
      .games { grid-template-columns: 1fr; }
      .daily-art { width: 70%; right: -16%; }
      nav .links { gap: 14px; }
    }
    @media (max-width: 560px) {
      .inner { width: min(100%, calc(100% - 32px)); }
      .mark { width: 230px; height: 230px; }
      .tile-hero { width: 168px; height: 168px; border-radius: 34px; }
      .chip.xp { left: -18px; }
      .chip.streak { right: -22px; }
      .fan-wrap { height: 168px; }
      .fan { height: 150px; }
      .fan .tile { width: 86px; height: 114px; margin-left: -43px; border-radius: 14px; }
      footer { flex-direction: column; }
    }
  </style>
</head>
<body>
  <div class="wrap">
    <div class="stadium" aria-hidden="true"></div>
    <div class="glow" aria-hidden="true"></div>
    <div class="fade" aria-hidden="true"></div>
    <div class="inner">
      <nav>
        <a class="brand" href="/">Ball Knowledge</a>
        <div class="links">
          <a href="/support">Support</a>
          <a href="/privacy">Privacy</a>
          <a href="/terms">Terms</a>
        </div>
      </nav>

      <section class="hero">
        <div class="mark">
          <div class="ring"></div>
          <div class="orb"></div>
          <div class="tile-hero"><img src="/brand/ball.jpg" alt="" width="190" height="190"></div>
          <div class="chip xp"><span class="dot"></span>XP</div>
          <div class="chip streak"><span class="dot"></span>STREAK</div>
        </div>
        <h1>Think you know<br>football?</h1>
        <p class="sub">Test your ball knowledge with eight new football quiz games each day.</p>
        <button type="button" class="cta" id="downloadBtn">
          Download now
          <svg viewBox="0 0 16 16" fill="currentColor" aria-hidden="true"><path d="M8.6 3.2 13.4 8l-4.8 4.8-.9-.9 3.2-3.2H2.5V7.3h8.4L7.7 4.1l.9-.9z"/></svg>
        </button>
        <p class="fine">Free on the App Store</p>
      </section>

      <section class="block">
        <div class="copy">
          <h2>Track your daily progress</h2>
          <p>Complete games to earn XP and build your streak.</p>
        </div>
        <div class="daily">
          <div class="daily-art" aria-hidden="true"></div>
          <div class="daily-top">
            <div>
              <div class="daily-count"><strong>7</strong><span>/ 7</span></div>
              <div class="label">GAMES CLEARED</div>
            </div>
            <div class="xp-block">
              <b>+2,840</b>
              <div class="label">XP EARNED</div>
            </div>
          </div>
          <div class="bars" aria-hidden="true">
            <i class="on"></i><i class="on"></i><i class="on"></i><i class="on"></i><i class="on"></i><i class="on"></i><i class="on"></i>
          </div>
          <div class="daily-foot">
            <div>
              <div class="streak-n">12</div>
              <div class="label">DAY STREAK</div>
            </div>
            <div class="keep">KEEP IT GOING</div>
          </div>
        </div>
      </section>

      <section class="block">
        <div class="copy">
          <h2>Eight different football games</h2>
          <p>Build teams, connect players, hit targets and answer questions across eight game modes.</p>
        </div>
        <div class="fan-wrap">
          <div class="fan" id="fan"></div>
        </div>
        <div class="games">
          <div class="game"><img src="/brand/tiles/football_bingo.jpg" alt=""><div><b>Football Bingo</b><span>Complete the grid</span></div></div>
          <div class="game"><img src="/brand/tiles/one_more.jpg" alt=""><div><b>One More</b><span>Streak or cash out</span></div></div>
          <div class="game"><img src="/brand/tiles/draft_master.jpg" alt=""><div><b>Draft XI</b><span>Draft the best squad</span></div></div>
          <div class="game"><img src="/brand/tiles/club_chain.jpg" alt=""><div><b>Club Chain</b><span>Find the missing links</span></div></div>
          <div class="game"><img src="/brand/tiles/target_man.jpg" alt=""><div><b>Target Man</b><span>Hit the stat target</span></div></div>
          <div class="game"><img src="/brand/tiles/last_man_standing.jpg" alt=""><div><b>Last Man Standing</b><span>Survive the field</span></div></div>
          <div class="game"><img src="/brand/tiles/back_yourself.jpg" alt=""><div><b>Back Yourself</b><span>How many you can name?</span></div></div>
          <div class="game"><img src="/brand/tiles/darts_501.jpg" alt=""><div><b>Football 501</b><span>Check out from 501</span></div></div>
        </div>
      </section>

      <section class="block">
        <div class="copy">
          <h2>Climb the leagues</h2>
          <p>Save your progress, represent your club and earn XP on the overall board.</p>
        </div>
        <div class="league" id="league"></div>
      </section>

      <section class="bottom">
        <h2>How good is your<br>ball knowledge?</h2>
        <p>Eight games. Fresh every day. Download Ball Knowledge and prove it.</p>
        <button type="button" class="cta" id="downloadBtn2">
          Download now
          <svg viewBox="0 0 16 16" fill="currentColor" aria-hidden="true"><path d="M8.6 3.2 13.4 8l-4.8 4.8-.9-.9 3.2-3.2H2.5V7.3h8.4L7.7 4.1l.9-.9z"/></svg>
        </button>
      </section>

      <footer>
        <span>Ball Knowledge is operated by UpNextCo. Questions: <a href="mailto:${contactEmail}">${contactEmail}</a>.</span>
        <span><a href="/privacy">Privacy</a> · <a href="/terms">Terms</a> · <a href="/support">Support</a></span>
      </footer>
    </div>
  </div>
  <script>
    (function () {
      var STORE = ${JSON.stringify(appStoreUrl)};
      var ITMS = ${JSON.stringify(appStoreItmsUrl)};
      var reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

      function goStore() {
        try { window.location.href = ITMS; } catch (e) {}
        setTimeout(function () { window.location.href = STORE; }, 400);
      }
      document.getElementById("downloadBtn").addEventListener("click", goStore);
      document.getElementById("downloadBtn2").addEventListener("click", goStore);

      var tiles = [
        "football_bingo", "one_more", "draft_master", "club_chain",
        "target_man", "last_man_standing", "back_yourself", "darts_501"
      ];
      var fan = document.getElementById("fan");
      var nodes = tiles.map(function (name) {
        var el = document.createElement("div");
        el.className = "tile";
        el.innerHTML = '<img src="/brand/tiles/' + name + '.jpg" alt="">';
        fan.appendChild(el);
        return el;
      });
      function place(step) {
        nodes.forEach(function (el, index) {
          var slot = (index + step) % tiles.length;
          var offset = slot - 3;
          el.style.transform = "translateX(" + (offset * 41) + "px) translateY(" + (Math.abs(offset) * 9) + "px) rotate(" + (offset * 4.2) + "deg)";
          el.style.zIndex = String(4 - Math.abs(offset));
        });
      }
      place(0);
      if (!reduce) {
        var step = 0;
        setInterval(function () { step = (step + 1) % tiles.length; place(step); }, 2200);
      }

      var players = [
        { id: "jordan", name: "Jordan", img: "/brand/league/league1.jpg", xp: 3520 },
        { id: "theo", name: "Theo", img: "/brand/league/league3.jpg", xp: 3050 },
        { id: "lewis", name: "Lewis", img: "/brand/league/league4.jpg", xp: 2510 },
        { id: "you", name: "You", img: null, xp: 1860 }
      ];
      var youXP = [1860, 2280, 2740, 3260, 3890, 3890];
      var league = document.getElementById("league");
      function renderLeague(stage) {
        var rows = players.map(function (p) {
          return { id: p.id, name: p.name, img: p.img, xp: p.id === "you" ? youXP[stage] : p.xp };
        }).sort(function (a, b) { return b.xp - a.xp; });
        league.innerHTML = '<div class="league-head"><span>OVERALL LEAGUE</span><em>XP</em></div>' +
          rows.map(function (p, i) {
            var you = p.id === "you";
            var ava = p.img
              ? '<img class="ava" src="' + p.img + '" alt="">'
              : '<div class="ava you">YOU</div>';
            return '<div class="row' + (you ? " you" : "") + '">' +
              '<span class="rank' + (i > 2 ? " dim" : "") + '">' + (i + 1) + '</span>' +
              ava + '<b>' + p.name + '</b><span class="pts">' + p.xp.toLocaleString("en-GB") + '</span></div>';
          }).join("");
      }
      var stage = 0;
      renderLeague(0);
      if (!reduce) {
        setInterval(function () {
          stage = (stage + 1) % youXP.length;
          renderLeague(stage);
        }, 1450);
      }
    })();
  </script>
</body>
</html>`);
}
