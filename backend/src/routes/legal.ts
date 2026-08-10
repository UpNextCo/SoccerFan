import { Router, type Response } from 'express';

export const legalRouter = Router();

const effectiveDate = '17 July 2026';
const contactEmail = 'contact@upnextapp.co';
const appStoreUrl = 'https://apps.apple.com/app/id6791646115';
/** Native App Store scheme — sometimes escapes TikTok/IG in-app browsers when https is blocked. */
const appStoreItmsUrl = 'itms-apps://apps.apple.com/app/id6791646115';
const siteOrigin = 'https://ballknowledge-production.up.railway.app';

function sendPage(res: Response, title: string, content: string): void {
  res
    .set({
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'public, max-age=3600',
      'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
      'Referrer-Policy': 'no-referrer',
      'X-Content-Type-Options': 'nosniff',
    })
    .send(`<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${title} · Ball Knowledge</title>
  <style>
    :root { color-scheme: dark; font-family: Inter, ui-sans-serif, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
    * { box-sizing: border-box; }
    body { margin: 0; color: #f7f7f7; background: #090909; line-height: 1.6; }
    main { width: min(760px, calc(100% - 40px)); margin: 0 auto; padding: 56px 0 80px; }
    nav { display: flex; justify-content: space-between; align-items: center; margin-bottom: 52px; }
    nav a { color: #00ff66; font-weight: 750; text-decoration: none; }
    nav div { display: flex; gap: 18px; }
    h1 { margin: 0 0 8px; font-size: clamp(32px, 7vw, 52px); line-height: 1.05; letter-spacing: -0.045em; }
    h2 { margin: 38px 0 8px; font-size: 19px; letter-spacing: -0.015em; }
    p, li { color: #b8b8b8; }
    a { color: #00ff66; }
    .meta { margin: 0 0 34px; color: #737373; font-size: 14px; }
    .hero { padding: 36px; background: #121212; border-radius: 22px; }
    .hero p { max-width: 580px; margin-bottom: 0; font-size: 17px; }
    footer { margin-top: 56px; padding-top: 20px; border-top: 1px solid #242424; color: #737373; font-size: 13px; }
    ul { padding-left: 22px; }
    @media (max-width: 560px) {
      nav { align-items: flex-start; gap: 20px; }
      nav div { flex-direction: column; gap: 4px; text-align: right; }
      .hero { padding: 24px; }
    }
  </style>
</head>
<body>
  <main>
    <nav>
      <a href="/">Ball Knowledge</a>
      <div><a href="/support">Support</a><a href="/privacy">Privacy</a><a href="/terms">Terms</a></div>
    </nav>
    ${content}
    <footer>Ball Knowledge is operated by UpNextCo. Questions: <a href="mailto:${contactEmail}">${contactEmail}</a>.</footer>
  </main>
</body>
</html>`);
}

/** Instagram / TikTok link-out — download CTA matching onboarding chrome. */
function sendGetAppPage(res: Response): void {
  res
    .set({
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'public, max-age=3600',
      // script-src needed so we can escape TikTok/IG in-app browsers (they block apps.apple.com).
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
  <title>Download Ball Knowledge</title>
  <meta name="description" content="Seven daily football quiz games. Download Ball Knowledge on the App Store.">
  <meta property="og:title" content="Ball Knowledge">
  <meta property="og:description" content="Think you know football? Seven new quiz games every day.">
  <meta property="og:type" content="website">
  <meta property="og:url" content="${siteOrigin}/get">
  <meta property="og:image" content="${siteOrigin}/brand/ball.jpg">
  <meta name="twitter:card" content="summary_large_image">
  <meta name="twitter:image" content="${siteOrigin}/brand/ball.jpg">
  <meta name="theme-color" content="#0A0A0A">
  <meta name="apple-itunes-app" content="app-id=6791646115">
  <style>
    :root { color-scheme: dark; }
    * { box-sizing: border-box; }
    html, body { height: 100%; }
    body {
      margin: 0;
      min-height: 100%;
      color: #fff;
      background: #0A0A0A;
      font-family: ui-rounded, "SF Pro Rounded", -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      -webkit-font-smoothing: antialiased;
      overflow-x: hidden;
    }
    .scene {
      position: relative;
      min-height: 100%;
      min-height: 100dvh;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: space-between;
      padding: max(28px, env(safe-area-inset-top)) 24px max(28px, env(safe-area-inset-bottom));
      overflow: hidden;
    }
    .glow {
      position: absolute;
      inset: 0;
      pointer-events: none;
      background:
        radial-gradient(ellipse 80% 50% at 50% -10%, rgba(0,255,102,0.16), transparent 55%),
        radial-gradient(ellipse 70% 45% at 80% 30%, rgba(0,204,82,0.08), transparent 50%),
        radial-gradient(ellipse 60% 40% at 15% 70%, rgba(12,34,24,0.9), transparent 55%);
    }
    .spot {
      position: absolute;
      width: 320px;
      height: 320px;
      top: 14%;
      left: 50%;
      translate: -50% 0;
      border-radius: 50%;
      background: radial-gradient(circle, rgba(0,255,102,0.16), transparent 68%);
      filter: blur(8px);
      animation: pulse 4.2s ease-in-out infinite;
      pointer-events: none;
    }
    .content {
      position: relative;
      z-index: 1;
      width: min(400px, 100%);
      flex: 1;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      text-align: center;
      gap: 28px;
    }
    .brand {
      font-size: 13px;
      font-weight: 800;
      letter-spacing: 0.14em;
      text-transform: uppercase;
      color: #00FF66;
    }
    .mark {
      position: relative;
      width: 210px;
      height: 210px;
      display: grid;
      place-items: center;
      animation: float 3.6s ease-in-out infinite;
    }
    .mark::before {
      content: "";
      position: absolute;
      inset: -22px;
      border-radius: 50%;
      border: 1px solid rgba(0,255,102,0.14);
    }
    .mark::after {
      content: "";
      position: absolute;
      inset: -2px;
      border-radius: 40px;
      background: rgba(0,255,102,0.12);
      filter: blur(28px);
      z-index: -1;
    }
    .tile {
      width: 190px;
      height: 190px;
      border-radius: 40px;
      overflow: hidden;
      background: #141414;
      border: 1px solid rgba(255,255,255,0.1);
      box-shadow: 0 18px 40px rgba(0,0,0,0.45), 0 14px 36px rgba(0,255,102,0.22);
    }
    .tile img {
      width: 100%;
      height: 100%;
      object-fit: cover;
      display: block;
    }
    h1 {
      margin: 0;
      font-size: clamp(34px, 9vw, 42px);
      font-weight: 800;
      letter-spacing: -0.04em;
      line-height: 1.05;
    }
    .sub {
      margin: 12px 0 0;
      color: #AAAAAA;
      font-size: 16px;
      font-weight: 500;
      line-height: 1.45;
      max-width: 30ch;
    }
    .copy { margin-top: 4px; }
    .tip {
      display: none;
      width: min(400px, 100%);
      position: relative;
      z-index: 1;
      margin-bottom: 8px;
      padding: 14px 16px;
      border-radius: 16px;
      background: rgba(0,255,102,0.1);
      border: 1px solid rgba(0,255,102,0.28);
      color: #e8ffe8;
      font-size: 14px;
      font-weight: 600;
      line-height: 1.4;
      text-align: left;
    }
    body.in-app .tip { display: block; }
    .tip strong { color: #00FF66; font-weight: 800; }
    .cta-wrap {
      position: relative;
      z-index: 1;
      width: min(400px, 100%);
      display: flex;
      flex-direction: column;
      gap: 12px;
      align-items: center;
    }
    .cta, .cta-secondary {
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 10px;
      width: 100%;
      height: 56px;
      border-radius: 18px;
      font-size: 15px;
      font-weight: 800;
      letter-spacing: 0.04em;
      text-decoration: none;
      text-transform: uppercase;
      border: none;
      cursor: pointer;
      font-family: inherit;
      transition: transform 0.12s ease, opacity 0.12s ease;
    }
    .cta {
      background: #00FF66;
      color: #0A0A0A;
      box-shadow: 0 8px 28px rgba(0,255,102,0.22);
    }
    .cta-secondary {
      display: none;
      background: #1A1A1A;
      color: #fff;
      border: 1px solid #2a2a2a;
    }
    body.in-app .cta-secondary { display: flex; }
    .cta:active, .cta-secondary:active { transform: scale(0.975); opacity: 0.88; }
    .cta svg { width: 16px; height: 16px; }
    .fine {
      color: #666;
      font-size: 12px;
      font-weight: 600;
      text-decoration: none;
      text-align: center;
      line-height: 1.45;
      max-width: 34ch;
    }
    .fine a { color: #666; text-decoration: none; }
    .fine a:hover { color: #00FF66; }
    body.in-app .fine-default { display: none; }
    .fine-inapp { display: none; }
    body.in-app .fine-inapp { display: block; }
    @keyframes float {
      0%, 100% { transform: translateY(0); }
      50% { transform: translateY(-6px); }
    }
    @keyframes pulse {
      0%, 100% { opacity: 0.7; transform: translate(-50%, 0) scale(1); }
      50% { opacity: 1; transform: translate(-50%, 0) scale(1.06); }
    }
    @media (prefers-reduced-motion: reduce) {
      .mark, .spot { animation: none; }
    }
  </style>
</head>
<body>
  <div class="scene">
    <div class="glow" aria-hidden="true"></div>
    <div class="spot" aria-hidden="true"></div>
    <div class="content">
      <div class="brand">Ball Knowledge</div>
      <div class="mark">
        <div class="tile">
          <img src="/brand/ball.jpg" alt="" width="190" height="190">
        </div>
      </div>
      <div class="copy">
        <h1>Think you know<br>football?</h1>
        <p class="sub">Seven new quiz games every day. Download Ball Knowledge and prove it.</p>
      </div>
    </div>
    <div class="cta-wrap">
      <p class="tip" id="tip">
        TikTok blocks App Store links in its browser.
        Tap <strong>···</strong> (top right) → <strong>Open in Browser</strong>, then tap Download.
      </p>
      <button type="button" class="cta" id="downloadBtn">
        Download now
        <svg viewBox="0 0 16 16" fill="currentColor" aria-hidden="true"><path d="M8.6 3.2 13.4 8l-4.8 4.8-.9-.9 3.2-3.2H2.5V7.3h8.4L7.7 4.1l.9-.9z"/></svg>
      </button>
      <button type="button" class="cta-secondary" id="copyBtn">Copy App Store link</button>
      <p class="fine fine-default">Free on the <a href="${appStoreUrl}" id="storeLink">App Store</a> · <a href="/support">Support</a></p>
      <p class="fine fine-inapp">After opening in Safari/Chrome, tap Download — or copy the link above.</p>
    </div>
  </div>
  <script>
    (function () {
      var STORE = ${JSON.stringify(appStoreUrl)};
      var ITMS = ${JSON.stringify(appStoreItmsUrl)};
      var ua = navigator.userAgent || '';
      var inApp = /TikTok|ByteDance|BytedanceWebview|TTWebView|musical_ly|Instagram|FBAN|FBAV|FB_IAB|Line\\//i.test(ua)
        || (/iPhone|iPad|iPod/i.test(ua) && !/Safari/i.test(ua) && /AppleWebKit/i.test(ua));

      if (inApp) document.body.classList.add('in-app');

      function goStore() {
        // itms-apps can leave some in-app browsers; https works in Safari/Chrome.
        try { window.location.href = ITMS; } catch (e) {}
        setTimeout(function () {
          window.location.href = STORE;
        }, inApp ? 400 : 0);
      }

      document.getElementById('downloadBtn').addEventListener('click', function (e) {
        e.preventDefault();
        goStore();
      });

      var copyBtn = document.getElementById('copyBtn');
      copyBtn.addEventListener('click', function () {
        function done(ok) {
          copyBtn.textContent = ok ? 'Link copied' : 'Copy failed — open in browser';
          setTimeout(function () { copyBtn.textContent = 'Copy App Store link'; }, 2000);
        }
        if (navigator.clipboard && navigator.clipboard.writeText) {
          navigator.clipboard.writeText(STORE).then(function () { done(true); }).catch(function () { done(false); });
        } else {
          var ta = document.createElement('textarea');
          ta.value = STORE;
          ta.setAttribute('readonly', '');
          ta.style.position = 'fixed';
          ta.style.opacity = '0';
          document.body.appendChild(ta);
          ta.select();
          try { done(document.execCommand('copy')); } catch (e) { done(false); }
          document.body.removeChild(ta);
        }
      });
    })();
  </script>
</body>
</html>`);
}

legalRouter.get('/', (_req, res) => {
  sendPage(
    res,
    'Football games, every day',
    `<section class="hero">
      <h1>Know the game.</h1>
      <p>Seven daily football challenges covering players, clubs, careers and the moments that matter. <a href="/get">Download on the App Store</a>.</p>
    </section>
    <h2>About Ball Knowledge</h2>
    <p>Play the daily set, earn XP, build a streak and represent your club on the Teams leaderboard.</p>`
  );
});

legalRouter.get('/get', (_req, res) => {
  sendGetAppPage(res);
});

legalRouter.get('/download', (_req, res) => {
  res.redirect(302, '/get');
});

legalRouter.get('/support', (_req, res) => {
  sendPage(
    res,
    'Support',
    `<h1>Support</h1>
    <p class="meta">Ball Knowledge help</p>
    <section class="hero">
      <p>Need a hand with Ball Knowledge? Email us and we’ll get back to you as soon as we can.</p>
    </section>

    <h2>Contact</h2>
    <p>Email <a href="mailto:${contactEmail}">${contactEmail}</a> with your question. Include your display name and roughly what happened if you’re reporting a bug — that helps us fix it faster.</p>

    <h2>Common questions</h2>
    <ul>
      <li><strong>Daily games:</strong> a new set drops each day. Finish games to earn XP and keep your streak going.</li>
      <li><strong>Account &amp; profile:</strong> Sign in with Apple saves your progress. You can change your name, photo and club in Profile.</li>
      <li><strong>Delete account:</strong> you can delete your account from Profile. That permanently removes your account and associated personal information.</li>
      <li><strong>Privacy &amp; terms:</strong> see our <a href="/privacy">Privacy Policy</a> and <a href="/terms">Terms of Service</a>.</li>
    </ul>

    <h2>App Store</h2>
    <p>This page is the support contact for Ball Knowledge on the App Store.</p>`
  );
});

legalRouter.get('/privacy', (_req, res) => {
  sendPage(
    res,
    'Privacy Policy',
    `<h1>Privacy Policy</h1>
    <p class="meta">Effective ${effectiveDate}</p>
    <p>Ball Knowledge is operated by UpNextCo (“we”, “us” or “our”). This policy explains what information we use when you play Ball Knowledge and the choices available to you.</p>

    <h2>Information we collect</h2>
    <ul>
      <li><strong>Account information:</strong> the Sign in with Apple identifier used to create your account, plus your name and email address when Apple makes them available.</li>
      <li><strong>Profile information:</strong> your display name, chosen football club and optional profile photo.</li>
      <li><strong>Gameplay information:</strong> game answers, scores, XP, streaks, completion history and leaderboard participation.</li>
      <li><strong>Technical information:</strong> basic request and diagnostic information, such as IP address, device or operating-system information and server logs, used to operate and secure the service.</li>
    </ul>

    <h2>How we use information</h2>
    <p>We use this information to provide accounts and daily games, calculate scores and streaks, operate leaderboards, save progress, prevent abuse, troubleshoot problems and improve Ball Knowledge.</p>

    <h2>Sharing and service providers</h2>
    <p>We do not sell personal information and we do not use it for cross-app advertising or tracking. We share information only with providers needed to run the service, including Apple for authentication and TestFlight, Railway for application and database hosting, and infrastructure providers that deliver football images and other app assets.</p>

    <h2>Storage and retention</h2>
    <p>Account and gameplay information is retained while your account remains active and for as long as reasonably required to operate, secure and comply with legal obligations for the service. Some game data is cached locally on your device and is removed when you sign out or delete your account.</p>

    <h2>Your choices and rights</h2>
    <p>You can change your display name, club and profile photo in the app. You can delete your account from the Profile screen; this permanently removes the account and associated personal information, subject to limited legal or security retention requirements. You may also contact us to request access, correction or deletion.</p>

    <h2>Children</h2>
    <p>Ball Knowledge is a family friendly game. There is no age restriction, but we do not recommend it for children under 4.</p>

    <h2>Security and international processing</h2>
    <p>We use reasonable technical and organisational measures to protect information. Our providers may process information outside your country, with protections appropriate to the service and applicable law.</p>

    <h2>Changes</h2>
    <p>We may update this policy as Ball Knowledge develops. Material changes will be posted on this page with a new effective date.</p>

    <h2>Contact</h2>
    <p>Questions or privacy requests can be sent to <a href="mailto:${contactEmail}">${contactEmail}</a>.</p>`
  );
});

legalRouter.get('/terms', (_req, res) => {
  sendPage(
    res,
    'Terms of Service',
    `<h1>Terms of Service</h1>
    <p class="meta">Effective ${effectiveDate}</p>
    <p>These terms govern your use of Ball Knowledge. By creating an account or using the app, you agree to them.</p>

    <h2>Using Ball Knowledge</h2>
    <p>We grant you a personal, limited, non-exclusive, non-transferable and revocable licence to use Ball Knowledge for lawful, non-commercial entertainment. You must comply with applicable law and Apple’s platform rules.</p>

    <h2>Your account</h2>
    <p>You are responsible for activity through your account and for keeping access to your Apple account secure. Information you provide, including your display name and profile photo, must not impersonate others, infringe rights or contain unlawful or abusive content.</p>

    <h2>Fair play</h2>
    <p>You must not cheat, automate play, manipulate scores or leaderboards, probe or disrupt the service, access another person’s account, reverse engineer protected parts of the service, or use Ball Knowledge in a way that harms other players or our systems.</p>

    <h2>Football information</h2>
    <p>Football statistics, career histories and quiz answers are prepared from sources we believe to be reliable, but mistakes and delays can occur. Ball Knowledge is an entertainment product and does not guarantee that every item is complete or error-free.</p>

    <h2>Availability and changes</h2>
    <p>We may update games, scoring, features and content, or temporarily suspend parts of the service for maintenance, security or operational reasons. We do not guarantee uninterrupted availability. TestFlight versions are pre-release software and may contain defects.</p>

    <h2>Ownership</h2>
    <p>Ball Knowledge, its software, design, branding and original content belong to UpNextCo or its licensors. Football club names, badges, player images and other third-party materials remain the property of their respective owners.</p>

    <h2>Ending use</h2>
    <p>You may stop using Ball Knowledge or delete your account at any time. We may suspend or terminate access where these terms are materially breached, the service is abused, or doing so is necessary to protect players or the service.</p>

    <h2>Disclaimers and liability</h2>
    <p>Ball Knowledge is provided “as is” and “as available” to the extent permitted by law. We do not exclude liability that cannot legally be excluded. Otherwise, we are not liable for indirect or consequential loss, loss of data, or loss arising from events outside our reasonable control.</p>

    <h2>Governing law</h2>
    <p>These terms are governed by the laws of England and Wales, without removing any mandatory consumer rights you have in your country of residence.</p>

    <h2>Changes and contact</h2>
    <p>We may update these terms as the service develops. The current version will remain available here. Questions can be sent to <a href="mailto:${contactEmail}">${contactEmail}</a>.</p>`
  );
});
