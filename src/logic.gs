// Business logic helpers (private, _ suffix)

var SCRIPT_OWNER_EMAIL = 'kalimistk@gmail.com';
var SCRIPT_OWNER_DISPLAY_NAME = '開発者';

function getActiveEmail_() {
  try { return Session.getActiveUser().getEmail(); } catch (e) { return ''; }
}

function findUserByKey_(userKey) {
  if (!userKey) return null;
  var rows = readRecords_(SHEETS.Users);
  for (var i = 0; i < rows.length; i++) {
    if (String(rows[i].userKey) === String(userKey)) return rows[i];
  }
  return null;
}

function getUserAccessSheet_() {
  var sh = getSheet_(SHEETS.UserAccess);
  ensureUserAccessDashboardSchema_(sh);
  return sh;
}

function getUserAccessByEmail_(email) {
  var target = String(email || '').trim().toLowerCase();
  var isOwner = target === SCRIPT_OWNER_EMAIL;
  var rows = readRecordsFromSheet_(getUserAccessSheet_());
  for (var i = 0; i < rows.length; i++) {
    var rowEmail = String(rows[i].email || '').trim().toLowerCase();
    if (rowEmail !== target) continue;
    var activeVal = normalizeUserAccessBoolean_(rows[i].active, true);
    var access = {
      email: target,
      role: String(rows[i].role || 'user').trim().toLowerCase(),
      managerEmail: String(rows[i].managerEmail || '').trim().toLowerCase(),
      active: activeVal !== 'false',
      displayName: String(rows[i].displayName || '').trim(),
      showInDashboard: normalizeUserAccessBoolean_(rows[i].showInDashboard, true) !== 'false'
    };
    if (isOwner) {
      access.role = 'admin';
      access.active = true;
      access.displayName = access.displayName || SCRIPT_OWNER_DISPLAY_NAME;
      access.showInDashboard = false;
    }
    return access;
  }
  if (isOwner) {
    return {
      email: target,
      role: 'admin',
      managerEmail: '',
      active: true,
      displayName: SCRIPT_OWNER_DISPLAY_NAME,
      showInDashboard: false
    };
  }
  return { email: target, role: 'user', managerEmail: '', active: false, displayName: '', showInDashboard: false };
}

function ensureScriptOwnerInUserAccess_() {
  var sh = getUserAccessSheet_();
  var rows = readRecordsFromSheet_(sh);
  var now = Utilities.formatDate(new Date(), 'Asia/Tokyo', 'yyyy-MM-dd HH:mm:ss');
  for (var i = 0; i < rows.length; i++) {
    if (String(rows[i].email || '').trim().toLowerCase() === SCRIPT_OWNER_EMAIL) {
      var rowNo = i + 2;
      sh.getRange(rowNo, 2).setValue('admin');
      sh.getRange(rowNo, 4).setValue('true');
      sh.getRange(rowNo, 5).setValue(now);
      sh.getRange(rowNo, 6).setValue(SCRIPT_OWNER_DISPLAY_NAME);
      sh.getRange(rowNo, 7).setValue('false');
      return;
    }
  }
  sh.appendRow([SCRIPT_OWNER_EMAIL, 'admin', '', 'true', now, SCRIPT_OWNER_DISPLAY_NAME, 'false']);
}

function getUserContextByKey_(clientUserKey) {
  var user = findUserByKey_(clientUserKey);
  if (!user) return { userKey: '', email: '', displayName: '', role: 'guest', active: false, isAdmin: false, isManager: false };
  var access = getUserAccessByEmail_(user.email || user.userKey);
  var role = access && access.active ? access.role : 'user';
  return {
    userKey: user.userKey,
    email: String(user.email || '').trim().toLowerCase(),
    displayName: access.displayName || user.displayName || '',
    role: role,
    active: access ? access.active : true,
    isAdmin: role === 'admin',
    isManager: role === 'admin' || role === 'manager'
  };
}

function getCurrentAuthInfo_(clientUserKey) {
  var ctx = getUserContextByKey_(clientUserKey);
  return {
    userKey: ctx.userKey,
    email: ctx.email,
    displayName: ctx.displayName,
    role: ctx.role,
    isAdmin: ctx.isAdmin,
    isManager: ctx.isManager
  };
}

function requireAdmin_(clientUserKey) {
  var ctx = getUserContextByKey_(clientUserKey);
  if (!ctx.isAdmin) throw new Error('管理者権限が必要です');
  return ctx;
}

function requireManager_(clientUserKey) {
  var ctx = getUserContextByKey_(clientUserKey);
  if (!ctx.isManager) throw new Error('管理者権限が必要です');
  return ctx;
}

function requireDashboardViewer_(clientUserKey) {
  var ctx = getUserContextByKey_(clientUserKey);
  var role = String(ctx.role || '').trim().toLowerCase();
  if (!ctx.userKey || !ctx.active || (role !== 'user' && role !== 'manager' && role !== 'admin')) {
    throw new Error('ログインが必要です');
  }
  return ctx;
}
