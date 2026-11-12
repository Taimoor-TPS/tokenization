/* IRIS Tokenization decision engine — Phase 3 (PRD §9).
   Pure functions: no DOM, no fetch, no Date.now() except through ctx.now, no store writes. */
(function (global) {
  'use strict';

  var COLOUR_RANK = { GREEN: 1, YELLOW: 2, RED: 3 };
  var MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

  function asDate(now) {
    if (now instanceof Date) return new Date(now.getTime());
    if (typeof now === 'number') return new Date(now);
    if (typeof now === 'string') {
      var parsed = Date.parse(now);
      if (!isNaN(parsed)) return new Date(parsed);
    }
    return new Date(0);
  }

  function pad2(n) {
    return (n < 10 ? '0' : '') + n;
  }

  function formatStamp(d) {
    return d.getDate() + ' ' + MONTHS[d.getMonth()] + ' ' + d.getFullYear() + ', ' +
      pad2(d.getHours()) + ':' + pad2(d.getMinutes()) + ':' + pad2(d.getSeconds());
  }

  function sameCalendarDay(a, b) {
    return a.getFullYear() === b.getFullYear() &&
      a.getMonth() === b.getMonth() &&
      a.getDate() === b.getDate();
  }

  function parseTxnTime(value) {
    if (value instanceof Date) return value;
    if (typeof value === 'number') return new Date(value);
    if (typeof value !== 'string') return null;
    var iso = Date.parse(value);
    if (!isNaN(iso)) return new Date(iso);
    var m = String(value).match(/^(\d{1,2})\s+([A-Za-z]{3})\s+(\d{4}),\s+(\d{1,2}):(\d{2}):(\d{2})/);
    if (!m) return null;
    var mi = MONTHS.indexOf(m[2]);
    if (mi < 0) return null;
    return new Date(Number(m[3]), mi, Number(m[1]), Number(m[4]), Number(m[5]), Number(m[6]));
  }

  /** Parse MM/YY or MM/YYYY into end-of-month Date (local). */
  function parseExpiryEnd(expiry) {
    if (!expiry) return null;
    var m = String(expiry).trim().match(/^(\d{1,2})\/(\d{2}|\d{4})$/);
    if (!m) return null;
    var month = Number(m[1]);
    var year = Number(m[2]);
    if (year < 100) year += 2000;
    if (month < 1 || month > 12) return null;
    return new Date(year, month, 0, 23, 59, 59, 999);
  }

  function formatTokenExpiry(now, months) {
    var d = asDate(now);
    var total = d.getMonth() + Number(months || 0);
    var y = d.getFullYear() + Math.floor(total / 12);
    var mo = total % 12;
    if (mo < 0) {
      mo += 12;
      y -= 1;
    }
    return pad2(mo + 1) + '/' + y;
  }

  function makeRng(seed) {
    var s;
    if (seed == null || seed === '') {
      s = (Math.random() * 0x100000000) >>> 0;
    } else if (typeof seed === 'number') {
      s = seed >>> 0;
    } else {
      s = 2166136261;
      var str = String(seed);
      for (var i = 0; i < str.length; i++) {
        s ^= str.charCodeAt(i);
        s = Math.imul(s, 16777619);
      }
      s = s >>> 0;
    }
    return function next() {
      s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
      return s / 0x100000000;
    };
  }

  function randomDigits(rng, n) {
    var out = '';
    for (var i = 0; i < n; i++) out += Math.floor(rng() * 10);
    return out;
  }

  function enabledRows(list) {
    if (!Array.isArray(list)) return [];
    return list.filter(function (r) { return r && !r.disabled; });
  }

  function firstSettings(list) {
    var rows = enabledRows(list);
    return rows[0] || (Array.isArray(list) && list[0]) || {};
  }

  function findBy(list, key, value) {
    if (!Array.isArray(list)) return null;
    for (var i = 0; i < list.length; i++) {
      if (list[i] && list[i][key] === value) return list[i];
    }
    return null;
  }

  function findEnabledBy(list, key, value) {
    var row = findBy(list, key, value);
    if (!row || row.disabled) return null;
    return row;
  }

  function check(ok, text, screen, setting, value) {
    return {
      ok: !!ok,
      text: text,
      screen: screen,
      setting: setting,
      value: value == null ? '' : String(value)
    };
  }

  function skipped(screen, setting) {
    return check(true, 'Skipped: rule is switched off', screen, setting, 'off');
  }

  function result(partial) {
    var out = {
      ok: !!partial.ok,
      reason: partial.reason || '',
      message: partial.message || '',
      checks: partial.checks || []
    };
    if (partial.responseCode != null) out.responseCode = partial.responseCode;
    if (partial.decision != null) out.decision = partial.decision;
    if (partial.effects != null) out.effects = partial.effects;
    if (partial.methods != null) out.methods = partial.methods;
    if (partial.otp != null) out.otp = partial.otp;
    if (partial.expiresAt != null) out.expiresAt = partial.expiresAt;
    if (partial.text != null) out.text = partial.text;
    if (partial.token != null) out.token = partial.token;
    if (partial.cardId != null) out.cardId = partial.cardId;
    if (partial.product != null) out.product = partial.product;
    if (partial.productName != null) out.productName = partial.productName;
    if (partial.issuerCardRef != null) out.issuerCardRef = partial.issuerCardRef;
    if (partial.termsId != null) out.termsId = partial.termsId;
    if (partial.cascadeMode != null) out.cascadeMode = partial.cascadeMode;
    if (partial.channel != null) out.channel = partial.channel;
    if (partial.method != null) out.method = partial.method;
    if (partial.minutes != null) out.minutes = partial.minutes;
    return out;
  }

  function lookupResponseCode(store, reason, auth) {
    var row = findEnabledBy(store.responseCodes, 'reason', reason);
    if (row && row.code) {
      return { code: String(row.code), usedDefault: false };
    }
    var fallback = (auth && auth.defaultDeclineCode) || '05';
    return { code: String(fallback), usedDefault: true };
  }

  function resolveCardContext(store, cardId) {
    var card = findEnabledBy(store.cards, 'id', cardId);
    if (!card) {
      var raw = findBy(store.cards, 'id', cardId);
      return { card: null, rawCard: raw || null, product: null, scheme: null };
    }
    var product = findBy(store.products, 'code', card.product) || null;
    var scheme = product ? findBy(store.schemes, 'code', product.scheme) : null;
    return { card: card, rawCard: card, product: product, scheme: scheme };
  }

  function nonDeletedTokens(store, cardId) {
    return enabledRows(store.tokens).filter(function (t) {
      return t.cardId === cardId && t.status !== 'DELETED';
    });
  }

  function fillTemplate(tpl, vars) {
    return String(tpl || '').replace(/\{([a-zA-Z0-9_]+)\}/g, function (_, key) {
      return vars[key] != null ? String(vars[key]) : '{' + key + '}';
    });
  }

  function bankName(store) {
    var inst = firstSettings(store.institution);
    return inst.bankName || 'IRIS Issuer Bank';
  }

  function last4(pan) {
    var s = String(pan || '');
    return s.length >= 4 ? s.slice(-4) : s;
  }

  function normalizeLimitChannel(channel) {
    var c = String(channel || '').trim();
    var u = c.toUpperCase();
    if (u === 'POS' || u === 'POS CONTACTLESS' || u.indexOf('POS') === 0) return 'POS contactless';
    if (u === 'ECOM' || u === 'E-COMMERCE' || u === 'ECOMMERCE' || u.indexOf('E-COM') >= 0 || u.indexOf('COMMERCE') >= 0) {
      return 'E-commerce';
    }
    return c;
  }

  function isCallCentreMethod(method) {
    if (!method) return false;
    var m = String(method).toUpperCase().replace(/[\s_-]+/g, '');
    return m === 'CALLCENTRE' || m === 'CALLCENTER';
  }

  function worstColour(colours) {
    var best = 'GREEN';
    for (var i = 0; i < colours.length; i++) {
      var c = colours[i];
      if (!c) continue;
      if ((COLOUR_RANK[c] || 0) > (COLOUR_RANK[best] || 0)) best = c;
    }
    return best;
  }

  function dailyUsage(store, tokenRef, now) {
    var day = asDate(now);
    var amount = 0;
    var count = 0;
    var txns = Array.isArray(store.transactions) ? store.transactions : [];
    for (var i = 0; i < txns.length; i++) {
      var t = txns[i];
      if (!t || t.type !== 'AUTHORIZATION') continue;
      if (t.tokenRef !== tokenRef) continue;
      if (t.status !== 'APPROVED' && t.decision !== 'APPROVED') continue;
      var tt = parseTxnTime(t.time);
      if (!tt || !sameCalendarDay(tt, day)) continue;
      amount += Number(t.amount) || 0;
      count += 1;
    }
    return { amount: amount, count: count };
  }

  function templateVars(store, card, product, requestor, deviceType, extra) {
    var vars = {
      bank: bankName(store),
      product: product ? product.name : '',
      last4: last4(card && card.pan),
      wallet: requestor ? requestor.name : '',
      device: deviceType || (extra && extra.device) || '',
      otp: '',
      minutes: ''
    };
    if (extra) {
      Object.keys(extra).forEach(function (k) { vars[k] = extra[k]; });
    }
    return vars;
  }

  function findTemplate(store, event, channel) {
    return enabledRows(store.templates).filter(function (t) {
      return t.event === event && String(t.channel).toUpperCase() === String(channel).toUpperCase();
    })[0] || null;
  }

  /* ---------- checkEligibility ---------- */
  function checkEligibility(store, ctx) {
    store = store || {};
    ctx = ctx || {};
    var checks = [];
    var elig = firstSettings(store.eligibility);

    // P1 Card known
    var card = findEnabledBy(store.cards, 'id', ctx.cardId);
    if (!card) {
      checks.push(check(false, 'Card ' + (ctx.cardId || '') + ' was not found or is disabled', 'Card', 'id', ctx.cardId || ''));
      return result({ ok: false, reason: 'CARD_NOT_FOUND', message: 'Card was not found', checks: checks });
    }
    checks.push(check(true, 'Card ' + card.id + ' is on file and enabled', 'Card', 'id', card.id));

    var product = findBy(store.products, 'code', card.product);
    var scheme = product ? findBy(store.schemes, 'code', product.scheme) : null;

    // P2 Scheme enabled
    if (!scheme || scheme.disabled) {
      checks.push(check(false,
        'Scheme ' + ((product && product.scheme) || '') + ' is disabled or missing',
        'Scheme', 'Status', scheme && scheme.disabled ? 'Disabled' : 'missing'));
      return result({ ok: false, reason: 'SCHEME_DISABLED', message: 'Scheme is disabled', checks: checks });
    }
    checks.push(check(true, 'Scheme ' + scheme.code + ' is enabled', 'Scheme', 'Status', 'Enabled'));

    // P3 Approved requestor (optional)
    if (!elig.requireApprovedRequestor) {
      checks.push(skipped('Eligibility Rules', 'requireApprovedRequestor'));
    } else {
      var req = findBy(store.tokenRequestors, 'id', ctx.requestorId);
      if (!req || req.disabled) {
        checks.push(check(false,
          'Token requestor ' + (ctx.requestorId || '') + ' is not an approved wallet',
          'Token Requestor', 'Status', req && req.disabled ? 'Disabled' : 'missing'));
        return result({ ok: false, reason: 'REQUESTOR_NOT_APPROVED', message: 'Token requestor is not approved', checks: checks });
      }
      var schemesOk = Array.isArray(req.schemes) && req.schemes.indexOf(scheme.code) >= 0;
      if (!schemesOk) {
        checks.push(check(false,
          'Requestor ' + req.name + ' does not support scheme ' + scheme.code,
          'Token Requestor', 'schemes', (req.schemes || []).join(', ')));
        return result({ ok: false, reason: 'REQUESTOR_NOT_APPROVED', message: 'Token requestor does not support this scheme', checks: checks });
      }
      var deviceOk = Array.isArray(req.deviceTypes) && req.deviceTypes.indexOf(ctx.deviceType) >= 0;
      if (!deviceOk) {
        checks.push(check(false,
          'Device type ' + (ctx.deviceType || '') + ' is not allowed for ' + req.name + '; allowed are ' + (req.deviceTypes || []).join(', '),
          'Token Requestor', 'deviceTypes', (req.deviceTypes || []).join(', ')));
        return result({ ok: false, reason: 'DEVICE_TYPE_NOT_ALLOWED', message: 'Device type is not allowed for this requestor', checks: checks });
      }
      checks.push(check(true,
        'Requestor ' + req.name + ' is approved for ' + scheme.code + ' on ' + ctx.deviceType,
        'Token Requestor', 'id', req.id));
    }

    // P4 Card status
    var allowedStatuses = Array.isArray(elig.allowedCardStatuses) ? elig.allowedCardStatuses : [];
    if (allowedStatuses.indexOf(card.status) < 0) {
      checks.push(check(false,
        'Card status is ' + card.status + '; allowed statuses are ' + (allowedStatuses.join(', ') || '(none)'),
        'Eligibility Rules', 'allowedCardStatuses', allowedStatuses.join(', ')));
      return result({ ok: false, reason: 'CARD_STATUS_NOT_ALLOWED', message: 'Card status is not allowed for provisioning', checks: checks });
    }
    checks.push(check(true,
      'Card status ' + card.status + ' is allowed for provisioning',
      'Eligibility Rules', 'allowedCardStatuses', allowedStatuses.join(', ')));

    // P5 Product flag
    if (!elig.requireProductFlag) {
      checks.push(skipped('Eligibility Rules', 'requireProductFlag'));
    } else {
      var tokOn = product && !product.disabled && !!product.tokenizationEnabled;
      if (!tokOn) {
        checks.push(check(false,
          'Product ' + ((product && product.name) || card.product) + ' does not have tokenization enabled',
          'Card Product', 'tokenizationEnabled', product ? String(!!product.tokenizationEnabled) : 'missing'));
        return result({ ok: false, reason: 'PRODUCT_NOT_ENABLED', message: 'Tokenization is not enabled for this product', checks: checks });
      }
      checks.push(check(true,
        'Product ' + product.name + ' has tokenization enabled',
        'Card Product', 'tokenizationEnabled', 'true'));
    }

    // P6 Card not expired
    if (!elig.rejectExpired) {
      checks.push(skipped('Eligibility Rules', 'rejectExpired'));
    } else {
      var now = asDate(ctx.now);
      var end = parseExpiryEnd(card.expiry);
      var expired = !end || now.getTime() > end.getTime();
      if (expired) {
        checks.push(check(false,
          'Card expiry ' + card.expiry + ' is in the past',
          'Eligibility Rules', 'rejectExpired', card.expiry));
        return result({ ok: false, reason: 'CARD_EXPIRED', message: 'Card is expired', checks: checks });
      }
      checks.push(check(true,
        'Card expiry ' + card.expiry + ' is not in the past',
        'Eligibility Rules', 'rejectExpired', card.expiry));
    }

    // P7 CVV2
    if (!elig.requireCvv2) {
      checks.push(skipped('Eligibility Rules', 'requireCvv2'));
    } else {
      if (String(ctx.cvv2 || '') !== String(card.cvv2 || '')) {
        checks.push(check(false,
          'Entered CVV2 does not match the card',
          'Eligibility Rules', 'requireCvv2', 'mismatch'));
        return result({ ok: false, reason: 'CVV2_MISMATCH', message: 'CVV2 does not match', checks: checks });
      }
      checks.push(check(true, 'Entered CVV2 matches the card', 'Eligibility Rules', 'requireCvv2', 'match'));
    }

    // P8 Token count
    if (!elig.enforceMaxTokens) {
      checks.push(skipped('Eligibility Rules', 'enforceMaxTokens'));
    } else {
      var maxTok = product && product.maxTokensPerCard != null ? Number(product.maxTokensPerCard) : 5;
      var existing = nonDeletedTokens(store, card.id);
      if (existing.length >= maxTok) {
        checks.push(check(false,
          'Card already has ' + existing.length + ' tokens; maximum is ' + maxTok,
          'Card Product', 'maxTokensPerCard', String(maxTok)));
        return result({ ok: false, reason: 'MAX_TOKENS_REACHED', message: 'Maximum tokens per card reached', checks: checks });
      }
      checks.push(check(true,
        'Card has ' + existing.length + ' tokens; maximum is ' + maxTok,
        'Card Product', 'maxTokensPerCard', String(maxTok)));
    }

    // P9 Already tokenized
    if (!elig.oneTokenPerDeviceRequestor) {
      checks.push(skipped('Eligibility Rules', 'oneTokenPerDeviceRequestor'));
    } else {
      var dup = nonDeletedTokens(store, card.id).filter(function (t) {
        return t.deviceId === ctx.deviceId && t.requestorId === ctx.requestorId;
      })[0];
      if (dup) {
        checks.push(check(false,
          'A non-deleted token already exists for this card, device and requestor (' + dup.ref + ')',
          'Eligibility Rules', 'oneTokenPerDeviceRequestor', dup.ref));
        return result({ ok: false, reason: 'ALREADY_TOKENIZED', message: 'Card is already tokenized on this device for this requestor', checks: checks });
      }
      checks.push(check(true,
        'No existing token for this card, device and requestor',
        'Eligibility Rules', 'oneTokenPerDeviceRequestor', 'none'));
    }

    return result({
      ok: true,
      reason: 'ELIGIBLE',
      message: 'Card is eligible for tokenization',
      checks: checks,
      cardId: card.id,
      issuerCardRef: card.id,
      product: product ? product.code : card.product,
      productName: product ? product.name : card.product,
      termsId: 'IRIS-TOKEN-TERMS-1'
    });
  }

  /* ---------- decideIdv ---------- */
  function decideIdv(store, ctx) {
    store = store || {};
    ctx = ctx || {};
    var checks = [];
    var elig = firstSettings(store.eligibility);
    var colours = [];
    var defaultColour = elig.unlistedReasonDecision || 'YELLOW';

    var score = Number(ctx.deviceScore);
    var band = findEnabledBy(store.riskScoreBands, 'score', score);
    if (!band) {
      // disabled or missing band → default
      colours.push(defaultColour);
      checks.push(check(true,
        'Device score ' + ctx.deviceScore + ' has no enabled band; using default ' + defaultColour,
        'ID&V Risk Rules', 'deviceScore', String(ctx.deviceScore)));
    } else {
      colours.push(band.decision);
      checks.push(check(true,
        'Device score ' + band.score + ' maps to ' + band.decision,
        'ID&V Risk Rules', 'deviceScore', String(band.score) + '=' + band.decision));
    }

    var reasonCodes = Array.isArray(ctx.reasonCodes) ? ctx.reasonCodes : [];
    for (var i = 0; i < reasonCodes.length; i++) {
      var code = reasonCodes[i];
      var rule = findEnabledBy(store.riskReasonRules, 'code', code);
      if (!rule) {
        colours.push(defaultColour);
        checks.push(check(true,
          'Reason code ' + code + ' is unlisted or disabled; using default ' + defaultColour,
          'Eligibility Rules', 'unlistedReasonDecision', defaultColour));
      } else {
        colours.push(rule.decision);
        checks.push(check(true,
          'Reason code ' + code + ' maps to ' + rule.decision,
          'ID&V Risk Rules', 'reasonCode', code + '=' + rule.decision));
      }
    }

    var finalColour = worstColour(colours);
    checks.push(check(true,
      'Final ID&V colour is ' + finalColour + ' (most serious of ' + colours.join(', ') + ')',
      'ID&V Risk Rules', 'finalColour', finalColour));

    if (finalColour === 'RED') {
      return result({
        ok: false,
        reason: 'IDV_RED',
        message: 'ID&V decision is RED; provisioning declined',
        decision: 'RED',
        checks: checks
      });
    }

    return result({
      ok: true,
      reason: finalColour === 'YELLOW' ? 'IDV_YELLOW' : 'IDV_GREEN',
      message: 'ID&V decision is ' + finalColour,
      decision: finalColour,
      checks: checks
    });
  }

  /* ---------- stepUpMethods ---------- */
  function stepUpMethods(store, ctx) {
    store = store || {};
    ctx = ctx || {};
    var checks = [];
    var cfg = firstSettings(store.stepup);
    var card = findEnabledBy(store.cards, 'id', ctx.cardId);
    if (!card) {
      checks.push(check(false, 'Card ' + (ctx.cardId || '') + ' was not found', 'Card', 'id', ctx.cardId || ''));
      return result({ ok: false, reason: 'CARD_NOT_FOUND', message: 'Card was not found', checks: checks, methods: [] });
    }

    var methods = [];
    if (cfg.smsEnabled && card.mobile) {
      methods.push({ id: 'SMS', channel: 'SMS', contact: card.mobile, label: 'SMS' });
    }
    if (cfg.emailEnabled && card.email) {
      methods.push({ id: 'EMAIL', channel: 'EMAIL', contact: card.email, label: 'Email' });
    }
    if (cfg.callCentreEnabled) {
      methods.push({ id: 'CALL_CENTRE', channel: 'CALL_CENTRE', contact: '', label: 'Call centre' });
    }

    if (!methods.length) {
      checks.push(check(false,
        'No step-up method is available for this card (SMS/Email need a contact; call centre is ' + (cfg.callCentreEnabled ? 'on' : 'off') + ')',
        'Step-up and OTP', 'methods', 'none'));
      return result({ ok: false, reason: 'NO_STEPUP_METHOD', message: 'No step-up method is available', checks: checks, methods: [] });
    }

    checks.push(check(true,
      'Available step-up methods: ' + methods.map(function (m) { return m.label; }).join(', '),
      'Step-up and OTP', 'methods', methods.map(function (m) { return m.id; }).join(', ')));
    return result({
      ok: true,
      reason: 'METHODS_AVAILABLE',
      message: 'Step-up methods are available',
      checks: checks,
      methods: methods
    });
  }

  /* ---------- issueOtp ---------- */
  function issueOtp(store, ctx) {
    store = store || {};
    ctx = ctx || {};
    var checks = [];
    var cfg = firstSettings(store.stepup);
    var card = findEnabledBy(store.cards, 'id', ctx.cardId);
    if (!card) {
      checks.push(check(false, 'Card ' + (ctx.cardId || '') + ' was not found', 'Card', 'id', ctx.cardId || ''));
      return result({ ok: false, reason: 'CARD_NOT_FOUND', message: 'Card was not found', checks: checks });
    }

    var method = String(ctx.method || 'SMS').toUpperCase();
    if (method === 'EMAIL') method = 'EMAIL';
    else if (isCallCentreMethod(method)) method = 'CALL_CENTRE';
    else method = 'SMS';

    if (method === 'CALL_CENTRE') {
      checks.push(check(true, 'Call centre method chosen; OTP is not issued', 'Step-up and OTP', 'method', 'CALL_CENTRE'));
      return result({
        ok: true,
        reason: 'CALL_CENTRE',
        message: 'Call centre step-up; token will be PENDING',
        checks: checks,
        method: 'CALL_CENTRE'
      });
    }

    var channel = method === 'EMAIL' ? 'EMAIL' : 'SMS';
    var tpl = findTemplate(store, 'OTP', channel);
    if (!tpl) {
      checks.push(check(false,
        'OTP template for ' + channel + ' is disabled or missing',
        'Notification Templates', 'OTP/' + channel, 'disabled'));
      return result({ ok: false, reason: 'TEMPLATE_DISABLED', message: 'OTP template is not available', checks: checks });
    }
    checks.push(check(true, 'OTP template for ' + channel + ' is enabled', 'Notification Templates', 'OTP/' + channel, 'enabled'));

    var length = Number(cfg.otpLength) || 6;
    var validity = Number(cfg.otpValiditySeconds) || 180;
    var now = asDate(ctx.now);
    var expiresAt = new Date(now.getTime() + validity * 1000);
    var rng = makeRng(ctx.seed != null ? ctx.seed : undefined);
    var otp = randomDigits(rng, length);
    var product = findBy(store.products, 'code', card.product);
    var requestor = ctx.requestorId ? findBy(store.tokenRequestors, 'id', ctx.requestorId) : null;
    var minutes = Math.max(1, Math.round(validity / 60));
    var text = fillTemplate(tpl.text, templateVars(store, card, product, requestor, ctx.deviceType, {
      otp: otp,
      minutes: String(minutes)
    }));

    checks.push(check(true,
      'OTP of length ' + length + ' issued, valid for ' + validity + ' seconds (by ' + (cfg.otpBy || 'Scheme') + ')',
      'Step-up and OTP', 'otpLength', String(length)));

    return result({
      ok: true,
      reason: 'OTP_ISSUED',
      message: 'OTP issued',
      checks: checks,
      otp: otp,
      expiresAt: expiresAt.toISOString(),
      text: text,
      channel: channel,
      method: method,
      minutes: minutes
    });
  }

  /* ---------- verifyOtp ---------- */
  function verifyOtp(store, ctx) {
    store = store || {};
    ctx = ctx || {};
    var checks = [];
    var cfg = firstSettings(store.stepup);
    var now = asDate(ctx.now);
    var expiresAt = ctx.expiresAt instanceof Date ? ctx.expiresAt : new Date(ctx.expiresAt);
    var attempt = Number(ctx.attempt) || 1;
    var maxAttempts = Number(cfg.maxAttempts) || 3;

    // S4 Not expired
    if (!(expiresAt instanceof Date) || isNaN(expiresAt.getTime()) || now.getTime() >= expiresAt.getTime()) {
      checks.push(check(false,
        'OTP has expired (validity ' + (cfg.otpValiditySeconds || 180) + ' seconds)',
        'Step-up and OTP', 'otpValiditySeconds', String(cfg.otpValiditySeconds || 180)));
      return result({ ok: false, reason: 'OTP_EXPIRED', message: 'OTP has expired', checks: checks });
    }
    checks.push(check(true, 'OTP is still within its validity window', 'Step-up and OTP', 'otpValiditySeconds', String(cfg.otpValiditySeconds || 180)));

    // S5 Attempts
    if (attempt > maxAttempts) {
      checks.push(check(false,
        'Attempt ' + attempt + ' exceeds maximum of ' + maxAttempts,
        'Step-up and OTP', 'maxAttempts', String(maxAttempts)));
      return result({ ok: false, reason: 'OTP_ATTEMPTS_EXCEEDED', message: 'Maximum OTP attempts exceeded', checks: checks });
    }
    checks.push(check(true,
      'Attempt ' + attempt + ' is within maximum of ' + maxAttempts,
      'Step-up and OTP', 'maxAttempts', String(maxAttempts)));

    // S6 Code correct
    if (String(ctx.entered || '') !== String(ctx.otp || '')) {
      if (attempt >= maxAttempts) {
        checks.push(check(false,
          'OTP is incorrect and no attempts remain',
          'Step-up and OTP', 'otp', 'incorrect'));
        return result({ ok: false, reason: 'OTP_ATTEMPTS_EXCEEDED', message: 'OTP incorrect; maximum attempts exceeded', checks: checks });
      }
      checks.push(check(false, 'Entered OTP is incorrect', 'Step-up and OTP', 'otp', 'incorrect'));
      return result({ ok: false, reason: 'OTP_INCORRECT', message: 'OTP is incorrect', checks: checks });
    }
    checks.push(check(true, 'Entered OTP is correct', 'Step-up and OTP', 'otp', 'match'));

    return result({
      ok: true,
      reason: 'OTP_VERIFIED',
      message: 'OTP verified',
      checks: checks
    });
  }

  /* ---------- createToken ---------- */
  function createToken(store, ctx) {
    store = store || {};
    ctx = ctx || {};
    var checks = [];
    var resolved = resolveCardContext(store, ctx.cardId);
    var card = resolved.card;
    var product = resolved.product;
    var scheme = resolved.scheme;

    if (!card) {
      checks.push(check(false, 'Card ' + (ctx.cardId || '') + ' was not found', 'Card', 'id', ctx.cardId || ''));
      return result({ ok: false, reason: 'CARD_NOT_FOUND', message: 'Card was not found', checks: checks });
    }
    if (!product || product.disabled || !scheme || scheme.disabled) {
      checks.push(check(false, 'Product or scheme is missing or disabled', 'Card Product', 'code', card.product));
      return result({ ok: false, reason: 'PRODUCT_NOT_ENABLED', message: 'Product or scheme is not available', checks: checks });
    }

    var requestor = findEnabledBy(store.tokenRequestors, 'id', ctx.requestorId) ||
      findBy(store.tokenRequestors, 'id', ctx.requestorId);
    if (!requestor) {
      checks.push(check(false, 'Token requestor was not found', 'Token Requestor', 'id', ctx.requestorId || ''));
      return result({ ok: false, reason: 'REQUESTOR_NOT_APPROVED', message: 'Token requestor was not found', checks: checks });
    }

    var elig = firstSettings(store.eligibility);
    var idvPath = String(ctx.idvPath || 'GREEN').toUpperCase();
    var callCentre = isCallCentreMethod(ctx.method) || isCallCentreMethod(ctx.stepUpMethod) || idvPath === 'CALL_CENTRE';
    var assuranceNum = (idvPath === 'YELLOW' || idvPath === 'CALL_CENTRE' || callCentre)
      ? (elig.assuranceAfterStepUp != null ? elig.assuranceAfterStepUp : 70)
      : (elig.assuranceNoStepUp != null ? elig.assuranceNoStepUp : 50);
    var assurance = pad2(Number(assuranceNum) || 0);

    var now = asDate(ctx.now);
    var stamp = formatStamp(now);
    var rng = makeRng(ctx.seed != null ? ctx.seed : undefined);
    var ref = String(scheme.tokenRefPrefix || '') + randomDigits(rng, 12);
    var tokenPan = String(scheme.panPrefix || '') + randomDigits(rng, 15);
    var tokenExpiry = formatTokenExpiry(now, scheme.tokenValidityMonths || 36);
    var status = callCentre ? 'PENDING' : 'ACTIVE';

    var token = {
      ref: ref,
      token: tokenPan,
      scheme: scheme.code,
      cardId: card.id,
      requestorId: requestor.id,
      channel: requestor.name,
      deviceId: ctx.deviceId || '',
      deviceType: ctx.deviceType || '',
      tokenType: requestor.tokenType || '03',
      assurance: assurance,
      status: status,
      suspendedBy: '',
      provisionedAt: stamp,
      tokenExpiry: tokenExpiry,
      updatedAt: stamp,
      lastReason: '',
      idvPath: callCentre ? 'YELLOW' : idvPath
    };

    checks.push(check(true,
      'Token ' + ref + ' created as ' + status + ' with assurance ' + assurance + ' (ID&V path ' + token.idvPath + ')',
      'Token Management', 'status', status));

    var effects = [{ type: 'CREATE_TOKEN', token: token }];
    var addedTpl = findTemplate(store, 'CARD_ADDED', 'SMS');
    var messageText = '';
    if (addedTpl) {
      messageText = fillTemplate(addedTpl.text, templateVars(store, card, product, requestor, ctx.deviceType, {
        device: ctx.deviceType || ''
      }));
      effects.push({ type: 'MESSAGE', event: 'CARD_ADDED', channel: 'SMS', text: messageText });
      checks.push(check(true, 'CARD_ADDED SMS template is enabled', 'Notification Templates', 'CARD_ADDED/SMS', 'enabled'));
    } else {
      checks.push(check(true, 'CARD_ADDED SMS template is disabled; message skipped', 'Notification Templates', 'CARD_ADDED/SMS', 'disabled'));
    }

    return result({
      ok: true,
      reason: 'TOKEN_CREATED',
      message: status === 'PENDING'
        ? 'Token created as PENDING pending call-centre activation'
        : 'Token created',
      checks: checks,
      token: token,
      effects: effects,
      text: messageText
    });
  }

  /* ---------- authorize ---------- */
  function authorize(store, ctx) {
    store = store || {};
    ctx = ctx || {};
    var checks = [];
    var auth = firstSettings(store.authRules);
    var now = asDate(ctx.now);

    function decline(reason, message) {
      var rc = lookupResponseCode(store, reason, auth);
      if (rc.usedDefault) {
        checks.push(check(true,
          'Response code for ' + reason + ' missing or disabled; using default decline code ' + rc.code,
          'Authorization Rules', 'defaultDeclineCode', rc.code));
      }
      return result({
        ok: false,
        reason: reason,
        message: message,
        decision: 'DECLINED',
        responseCode: rc.code,
        checks: checks
      });
    }

    // Resolve token → card → product (A1 needs the product; missing token fails at A2)
    var token = findBy(store.tokens, 'ref', ctx.tokenRef);
    var card = token ? findBy(store.cards, 'id', token.cardId) : null;
    var product = card ? findBy(store.products, 'code', card.product) : null;

    // A2 existence first when the reference is unknown (cannot evaluate product without a token)
    if (!token) {
      checks.push(check(false,
        'Token reference ' + (ctx.tokenRef || '') + ' was not found',
        'Token Management', 'ref', ctx.tokenRef || ''));
      return decline('TOKEN_NOT_FOUND', 'Token was not found');
    }

    // A1 Token payments switched on
    if (!product || product.disabled || !product.tokenizationEnabled) {
      checks.push(check(false,
        'Token payments are not switched on for ' + ((product && product.name) || 'unknown product'),
        'Card Product', 'tokenizationEnabled', product ? String(!!product.tokenizationEnabled) : 'missing'));
      return decline('TOKENIZATION_DISABLED', 'Tokenization is disabled for the card product');
    }
    checks.push(check(true,
      'Token payments are switched on for ' + product.name,
      'Card Product', 'tokenizationEnabled', 'true'));

    // A2 Token Active
    if (token.status !== 'ACTIVE') {
      checks.push(check(false,
        'Token ' + token.ref + ' is ' + token.status + ', not Active',
        'Token Management', 'status', token.status));
      return decline('TOKEN_NOT_ACTIVE', 'Token status is ' + token.status);
    }
    checks.push(check(true, 'Token ' + token.ref + ' is Active', 'Token Management', 'status', 'ACTIVE'));

    // A2b Requestor valid
    if (!auth.validateRequestor) {
      checks.push(skipped('Authorization Rules', 'validateRequestor'));
    } else {
      var req = findEnabledBy(store.tokenRequestors, 'id', token.requestorId);
      if (!req) {
        checks.push(check(false,
          'Token requestor ' + (token.requestorId || '') + ' is invalid or disabled',
          'Token Requestor', 'Status', 'Disabled'));
        return decline('REQUESTOR_INVALID', 'Token requestor is invalid');
      }
      checks.push(check(true,
        'Token requestor ' + req.name + ' is enabled',
        'Token Requestor', 'Status', 'Enabled'));
    }

    // A3 Expiry
    var tokenEnd = parseExpiryEnd(token.tokenExpiry);
    if (!tokenEnd || now.getTime() > tokenEnd.getTime()) {
      checks.push(check(false,
        'Token expiry ' + (token.tokenExpiry || '') + ' is in the past',
        'Token Management', 'tokenExpiry', token.tokenExpiry || ''));
      return decline('TOKEN_EXPIRED', 'Token has expired');
    }
    checks.push(check(true,
      'Token expiry ' + token.tokenExpiry + ' is not in the past',
      'Token Management', 'tokenExpiry', token.tokenExpiry));

    if (!auth.enforceExpiryMatch) {
      checks.push(skipped('Authorization Rules', 'enforceExpiryMatch'));
    } else {
      if (String(ctx.msgTokenExpiry || '') !== String(token.tokenExpiry || '')) {
        checks.push(check(false,
          'Message token expiry ' + (ctx.msgTokenExpiry || '') + ' does not match record ' + token.tokenExpiry,
          'Authorization Rules', 'enforceExpiryMatch', ctx.msgTokenExpiry || ''));
        return decline('EXPIRY_MISMATCH', 'Token expiry in the message does not match the record');
      }
      checks.push(check(true,
        'Message token expiry matches the record (' + token.tokenExpiry + ')',
        'Authorization Rules', 'enforceExpiryMatch', token.tokenExpiry));
    }

    // A4 Card status allowed
    if (!card || card.disabled) {
      checks.push(check(false, 'Card for token was not found', 'Card', 'id', token.cardId));
      return decline('CARD_STATUS_NOT_ALLOWED', 'Card was not found');
    }
    var allowed = Array.isArray(auth.allowedCardStatuses) ? auth.allowedCardStatuses.slice() : [];
    if (!allowed.length) allowed = ['ACTIVE'];
    if (allowed.indexOf(card.status) < 0) {
      checks.push(check(false,
        'Card status is ' + card.status + '; allowed statuses are ' + allowed.join(', '),
        'Authorization Rules', 'allowedCardStatuses', allowed.join(', ')));
      return decline('CARD_STATUS_NOT_ALLOWED', 'Card status is not allowed for token payments');
    }
    checks.push(check(true,
      'Card status ' + card.status + ' is allowed for token payments',
      'Authorization Rules', 'allowedCardStatuses', allowed.join(', ')));

    // A5 Cryptogram
    if (!auth.requireCryptogram) {
      checks.push(skipped('Authorization Rules', 'requireCryptogram'));
    } else {
      if (String(ctx.camResult || '').toUpperCase() !== 'PASS') {
        checks.push(check(false,
          'Cryptogram result is ' + (ctx.camResult || '') + ', not PASS',
          'Authorization Rules', 'requireCryptogram', ctx.camResult || ''));
        return decline('CRYPTOGRAM_FAILED', 'Cryptogram verification failed');
      }
      checks.push(check(true, 'Cryptogram result is PASS', 'Authorization Rules', 'requireCryptogram', 'PASS'));
    }

    // A6 Limits
    var amount = Number(ctx.amount) || 0;
    if (!auth.applyLimits) {
      checks.push(skipped('Authorization Rules', 'applyLimits'));
    } else {
      var limChannel = normalizeLimitChannel(ctx.channel);
      var lim = enabledRows(store.limits).filter(function (r) {
        return r.product === product.code && r.channel === limChannel;
      })[0];
      if (!lim) {
        checks.push(check(true,
          'No enabled Limits row for ' + product.code + ' / ' + limChannel + '; limits not applied',
          'Limits', 'product+channel', 'none'));
      } else {
        var perTxn = Number(lim.perTxn) || 0;
        if (perTxn > 0 && amount > perTxn) {
          checks.push(check(false,
            'Amount ' + amount + ' exceeds per-transaction limit ' + perTxn,
            'Limits', 'perTxn', String(perTxn)));
          return decline('LIMIT_EXCEEDED_TXN', 'Per-transaction limit exceeded');
        }
        checks.push(check(true,
          'Amount ' + amount + ' is within per-transaction limit ' + (perTxn || 'none'),
          'Limits', 'perTxn', String(perTxn)));

        var usage = dailyUsage(store, token.ref, now);
        var dailyAmount = Number(lim.dailyAmount) || 0;
        if (dailyAmount > 0 && (usage.amount + amount) > dailyAmount) {
          checks.push(check(false,
            'Today\'s approved amount ' + usage.amount + ' plus ' + amount + ' exceeds daily amount limit ' + dailyAmount,
            'Limits', 'dailyAmount', String(dailyAmount)));
          return decline('LIMIT_EXCEEDED_DAILY_AMOUNT', 'Daily amount limit exceeded');
        }
        checks.push(check(true,
          'Daily amount ' + usage.amount + ' + ' + amount + ' is within limit ' + (dailyAmount || 'none'),
          'Limits', 'dailyAmount', String(dailyAmount)));

        var dailyCount = Number(lim.dailyCount) || 0;
        if (dailyCount > 0 && (usage.count + 1) > dailyCount) {
          checks.push(check(false,
            'Today\'s approved count ' + usage.count + ' would exceed daily count limit ' + dailyCount,
            'Limits', 'dailyCount', String(dailyCount)));
          return decline('LIMIT_EXCEEDED_DAILY_COUNT', 'Daily count limit exceeded');
        }
        checks.push(check(true,
          'Daily count ' + usage.count + ' + 1 is within limit ' + (dailyCount || 'none'),
          'Limits', 'dailyCount', String(dailyCount)));
      }
    }

    // A7 Account check
    if (!auth.checkBalance) {
      checks.push(skipped('Authorization Rules', 'checkBalance'));
    } else {
      var bal = Number(card.balance);
      if (!isFinite(bal)) bal = 0;
      if (amount > bal) {
        checks.push(check(false,
          'Amount ' + amount + ' exceeds available balance ' + bal,
          'Card', 'balance', String(bal)));
        return decline('INSUFFICIENT_FUNDS', 'Available balance is insufficient');
      }
      checks.push(check(true,
        'Amount ' + amount + ' is within available balance ' + bal,
        'Card', 'balance', String(bal)));
    }

    var approvedRc = lookupResponseCode(store, 'APPROVED', auth);
    checks.push(check(true, 'All authorization checks passed', 'Response Codes', 'APPROVED', approvedRc.code));

    var effects = [
      { type: 'DEBIT', cardId: card.id, amount: amount, tokenRef: token.ref }
    ];

    return result({
      ok: true,
      reason: 'APPROVED',
      message: 'Transaction approved',
      decision: 'APPROVED',
      responseCode: approvedRc.code || '00',
      checks: checks,
      effects: effects
    });
  }

  /* ---------- lifecycle ---------- */
  function lifecycle(store, ctx) {
    store = store || {};
    ctx = ctx || {};
    var checks = [];
    var action = String(ctx.action || '');
    var initiator = String(ctx.initiator || 'OPERATOR').toUpperCase();
    var isOperator = initiator === 'OPERATOR';

    var token = findBy(store.tokens, 'ref', ctx.tokenRef);
    // L1 Token known
    if (!token || token.status === 'DELETED') {
      checks.push(check(false,
        'Token ' + (ctx.tokenRef || '') + ' was not found or is deleted',
        'Token Management', 'ref', ctx.tokenRef || ''));
      return result({ ok: false, reason: 'TOKEN_NOT_FOUND', message: 'Token was not found', checks: checks });
    }
    checks.push(check(true, 'Token ' + token.ref + ' is on file with status ' + token.status, 'Token Management', 'status', token.status));

    // L2 Transition allowed
    var from = token.status;
    var to = null;
    var actionNorm = action;
    if (/^suspend$/i.test(action)) {
      actionNorm = 'Suspend';
      to = 'SUSPENDED';
      if (from !== 'ACTIVE') {
        checks.push(check(false, 'Suspend is only allowed from ACTIVE (current ' + from + ')', 'Token Management', 'transition', from + '->SUSPENDED'));
        return result({ ok: false, reason: 'INVALID_TRANSITION', message: 'Invalid token status transition', checks: checks });
      }
    } else if (/^unsuspend$/i.test(action)) {
      actionNorm = 'Unsuspend';
      to = 'ACTIVE';
      if (from !== 'SUSPENDED') {
        checks.push(check(false, 'Unsuspend is only allowed from SUSPENDED (current ' + from + ')', 'Token Management', 'transition', from + '->ACTIVE'));
        return result({ ok: false, reason: 'INVALID_TRANSITION', message: 'Invalid token status transition', checks: checks });
      }
    } else if (/^activate$/i.test(action)) {
      actionNorm = 'Activate';
      to = 'ACTIVE';
      if (from !== 'PENDING') {
        checks.push(check(false, 'Activate is only allowed from PENDING (current ' + from + ')', 'Token Management', 'transition', from + '->ACTIVE'));
        return result({ ok: false, reason: 'INVALID_TRANSITION', message: 'Invalid token status transition', checks: checks });
      }
    } else if (/^delete$/i.test(action)) {
      actionNorm = 'Delete';
      to = 'DELETED';
      if (from === 'DELETED') {
        checks.push(check(false, 'Token is already deleted', 'Token Management', 'transition', 'DELETED'));
        return result({ ok: false, reason: 'INVALID_TRANSITION', message: 'Invalid token status transition', checks: checks });
      }
    } else {
      checks.push(check(false, 'Unknown lifecycle action ' + action, 'Token Management', 'action', action));
      return result({ ok: false, reason: 'INVALID_TRANSITION', message: 'Unknown lifecycle action', checks: checks });
    }
    checks.push(check(true,
      'Transition ' + actionNorm + ' from ' + from + ' to ' + to + ' is allowed',
      'Token Management', 'transition', from + '->' + to));

    // L3 Reason code (operator only)
    if (!isOperator) {
      checks.push(check(true, 'Skipped: reason code not required for ' + initiator, 'Reason Codes', 'code', 'n/a'));
    } else {
      var rc = findEnabledBy(store.reasonCodes, 'code', ctx.reasonCode);
      var actionsOk = rc && Array.isArray(rc.actions) && rc.actions.indexOf(actionNorm) >= 0;
      var schemeOk = rc && Array.isArray(rc.schemes) && rc.schemes.indexOf(token.scheme) >= 0;
      if (!rc || !actionsOk || !schemeOk) {
        checks.push(check(false,
          'Reason code ' + (ctx.reasonCode || '') + ' is invalid for action ' + actionNorm + ' / scheme ' + token.scheme,
          'Reason Codes', 'code', ctx.reasonCode || ''));
        return result({ ok: false, reason: 'REASON_CODE_INVALID', message: 'Reason code is invalid', checks: checks });
      }
      checks.push(check(true,
        'Reason code ' + rc.code + ' applies to ' + actionNorm + ' for ' + token.scheme,
        'Reason Codes', 'code', rc.code));
    }

    // L4 Reason text (operator only)
    if (!isOperator) {
      checks.push(check(true, 'Skipped: reason text not required for ' + initiator, 'Token Management', 'reasonText', 'n/a'));
    } else {
      var reasonText = String(ctx.reasonText || '').trim();
      if (reasonText.length < 5) {
        checks.push(check(false, 'Reason text must be at least 5 characters', 'Token Management', 'reasonText', reasonText));
        return result({ ok: false, reason: 'REASON_TEXT_MISSING', message: 'Reason text is required', checks: checks });
      }
      checks.push(check(true, 'Reason text is present', 'Token Management', 'reasonText', reasonText));
    }

    var suspendedBy = '';
    if (to === 'SUSPENDED') {
      suspendedBy = initiator === 'CARDHOLDER' ? 'CARDHOLDER' : (initiator === 'CARD' ? 'CARD' : 'OPERATOR');
    }

    var lastReason = isOperator
      ? String(ctx.reasonCode || '') + (ctx.reasonText ? ' — ' + String(ctx.reasonText).trim() : '')
      : (initiator === 'CARDHOLDER' ? 'Wallet removal' : actionNorm);

    var patch = {
      ref: token.ref,
      status: to,
      suspendedBy: suspendedBy,
      lastReason: lastReason
    };

    var eventName = to === 'SUSPENDED' ? 'TOKEN_SUSPENDED'
      : (to === 'DELETED' ? 'TOKEN_DELETED' : 'TOKEN_RESUMED');
    var effects = [{ type: 'UPDATE_TOKEN', tokenRef: token.ref, patch: patch }];
    var card = findBy(store.cards, 'id', token.cardId);
    var product = card ? findBy(store.products, 'code', card.product) : null;
    var requestor = findBy(store.tokenRequestors, 'id', token.requestorId);
    var tpl = findTemplate(store, eventName, 'SMS');
    var messageText = '';
    if (tpl) {
      messageText = fillTemplate(tpl.text, templateVars(store, card, product, requestor, token.deviceType, {
        device: token.deviceType || '',
        wallet: token.channel || (requestor && requestor.name) || ''
      }));
      effects.push({ type: 'MESSAGE', event: eventName, channel: 'SMS', text: messageText });
      checks.push(check(true, eventName + ' SMS template is enabled', 'Notification Templates', eventName + '/SMS', 'enabled'));
    } else {
      checks.push(check(true, eventName + ' SMS template is disabled; message skipped', 'Notification Templates', eventName + '/SMS', 'disabled'));
    }

    return result({
      ok: true,
      reason: 'LIFECYCLE_OK',
      message: 'Token status updated to ' + to,
      checks: checks,
      effects: effects,
      text: messageText,
      token: Object.assign({}, token, patch)
    });
  }

  /* ---------- cascade ---------- */
  function cascade(store, ctx) {
    store = store || {};
    ctx = ctx || {};
    var checks = [];
    var card = findEnabledBy(store.cards, 'id', ctx.cardId) || findBy(store.cards, 'id', ctx.cardId);
    if (!card) {
      checks.push(check(false, 'Card ' + (ctx.cardId || '') + ' was not found', 'Card', 'id', ctx.cardId || ''));
      return result({ ok: false, reason: 'CARD_NOT_FOUND', message: 'Card was not found', checks: checks, effects: [] });
    }

    var product = findBy(store.products, 'code', card.product);
    var scheme = product ? findBy(store.schemes, 'code', product.scheme) : null;
    var cascadeMode = (scheme && scheme.cascadeMode) || 'CARD_LEVEL';
    checks.push(check(true,
      'Scheme ' + ((scheme && scheme.code) || '') + ' cascade mode is ' + cascadeMode,
      'Scheme', 'cascadeMode', cascadeMode));

    var newStatus = String(ctx.newStatus || '');
    var rule = findBy(store.cascadeRules, 'cardStatus', newStatus);
    if (!rule || rule.disabled || !rule.effect || rule.effect === 'None') {
      checks.push(check(true,
        'Cascade skipped for card status ' + newStatus + (rule && rule.disabled ? ' (rule disabled)' : ' (no effect)'),
        'Card Status Cascade', 'cardStatus', newStatus));
      return result({
        ok: true,
        reason: 'CASCADE_SKIPPED',
        message: 'Cascade skipped',
        checks: checks,
        effects: [{ type: 'UPDATE_CARD', cardId: card.id, status: newStatus }],
        cascadeMode: cascadeMode
      });
    }

    var effect = String(rule.effect);
    checks.push(check(true,
      'Cascade rule for ' + newStatus + ' is ' + effect,
      'Card Status Cascade', 'effect', effect));

    var tokens = (Array.isArray(store.tokens) ? store.tokens : []).filter(function (t) {
      return t && t.cardId === card.id && t.status !== 'DELETED';
    });
    var effects = [{ type: 'UPDATE_CARD', cardId: card.id, status: newStatus }];
    var affected = 0;

    for (var i = 0; i < tokens.length; i++) {
      var t = tokens[i];
      var patch = null;
      if (effect === 'Suspend') {
        if (t.status === 'ACTIVE') {
          patch = { status: 'SUSPENDED', suspendedBy: 'CARD', lastReason: 'Card status ' + newStatus };
        }
      } else if (effect === 'Resume') {
        if (t.status === 'SUSPENDED' && t.suspendedBy === 'CARD') {
          patch = { status: 'ACTIVE', suspendedBy: '', lastReason: 'Card status ' + newStatus };
        }
      } else if (effect === 'Delete') {
        patch = { status: 'DELETED', suspendedBy: '', lastReason: 'Card status ' + newStatus };
      }
      if (patch) {
        affected += 1;
        effects.push({
          type: 'UPDATE_TOKEN',
          tokenRef: t.ref,
          patch: patch,
          cascadeMode: cascadeMode
        });
        checks.push(check(true,
          'Token ' + t.ref + ' will be set to ' + patch.status + ' (' + effect + ')',
          'Card Status Cascade', 'effect', effect));
      }
    }

    if (!affected) {
      checks.push(check(true, 'No tokens were affected by ' + effect, 'Card Status Cascade', 'effect', effect));
    }

    return result({
      ok: true,
      reason: 'CASCADE_OK',
      message: 'Card status cascade applied (' + effect + '); ' + affected + ' token(s) affected',
      checks: checks,
      effects: effects,
      cascadeMode: cascadeMode
    });
  }

  global.TknEngine = {
    checkEligibility: checkEligibility,
    decideIdv: decideIdv,
    stepUpMethods: stepUpMethods,
    issueOtp: issueOtp,
    verifyOtp: verifyOtp,
    createToken: createToken,
    authorize: authorize,
    lifecycle: lifecycle,
    cascade: cascade
  };
})(typeof window !== 'undefined' ? window : globalThis);
