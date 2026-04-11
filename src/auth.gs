// Auth helpers: Google login + localStorage-based user key

function getActiveEmail_() {
  try { return Session.getActiveUser().getEmail(); } catch (e) { return ''; }
}

/**
 * Ensure a user record exists for the given key.
 * If Google email is available, use that as userKey.
 * Otherwise fall back to the provided clientUserKey (UUID from localStorage).
 */
function ensureUser_(userKey, email, displayName) {
  if (!userKey) return null;
  var users = readRecords_(SHEETS.Users);
  var existing = users.filter(function(u) { return u.userKey === userKey; })[0];
  if (existing) return existing;
  var newUser = {
    userKey: userKey,
    email: email || '',
    displayName: displayName || userKey.slice(0, 8),
    recoveryCode: generateRecoveryCode_(),
    createdAt: new Date()
  };
  appendRow_(SHEETS.Users, newUser);
  return newUser;
}

function generateRecoveryCode_() {
  var chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  var code = '';
  for (var i = 0; i < 6; i++) {
    code += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  // Ensure uniqueness
  var users = readRecords_(SHEETS.Users);
  var used = users.map(function(u) { return u.recoveryCode; });
  if (used.indexOf(code) !== -1) return generateRecoveryCode_();
  return code;
}
