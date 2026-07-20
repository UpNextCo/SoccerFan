import { Router, type Response } from 'express';

export const legalRouter = Router();

const effectiveDate = '17 July 2026';
const contactEmail = 'contact@upnextapp.co';

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

legalRouter.get('/', (_req, res) => {
  sendPage(
    res,
    'Football games, every day',
    `<section class="hero">
      <h1>Know the game.</h1>
      <p>Seven daily football challenges covering players, clubs, careers and the moments that matter. Ball Knowledge is currently available to invited TestFlight testers.</p>
    </section>
    <h2>About Ball Knowledge</h2>
    <p>Play the daily set, earn XP, build a streak and represent your club on the Teams leaderboard.</p>`
  );
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
